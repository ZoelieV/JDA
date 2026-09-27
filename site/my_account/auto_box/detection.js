// Détection automatique de box (bêta) : capture de la liste des personnages
// Hoyolab (en français) -> constellation + niveau de chaque personnage.
//
// Portage navigateur du pipeline Python de auto_box/ (mêmes étapes, mêmes
// réglages) :
//   1. grille : repérage des cases par balayage vertical de l'encadrement gris
//      #1f1f1f (box_character_finder.py) ;
//   2. découpe de chaque case : zone constellation + zone nom/niveau
//      (image_splitter.py) ;
//   3. constellation : petit CNN (poids exportés par
//      auto_box/exporter_modele_web.py dans modele_constellations.json) ;
//   4. nom + niveau : OCR Tesseract (normal + inversé, on garde la variante la
//      plus confiante) (text_decoder.py, level_parsing.py) ;
//   5. nom OCR -> personnage de characters.json par correspondance approchée
//      (name_matching.py, équivalent de rapidfuzz token_sort_ratio).
//
// Tout tourne dans le navigateur : l'image n'est envoyée à aucun serveur.
// Les fonctions de calcul travaillent sur des images { width, height, data }
// (data RGBA, comme ImageData) et sont exportées pour les tests sous Node.
(function (racine) {
  "use strict";

  // ---- Réglages (repris de auto_box/) ----
  const CONFIG = {
    // Grille (box_character_finder.py)
    PROBE_WIDTH: 6,
    MIN_MATCHING_PIXELS_PER_ROW: 1,
    MAX_HOLE_SIZE: 5,
    MIN_RUN_LENGTH_RATIO: 0.05,
    HEADER_RATIO: 0.26,
    FOOTER_RATIO: 0.30,
    TARGET_GRAY_RGB: [31, 31, 31],
    COLOR_TOLERANCE: 10.95,
    LEFT_CELL_X: [0.04, 0.4825],
    RIGHT_CELL_X: [0.515, 0.955],
    LEFT_VECTOR_X_RATIO: 0.257,
    RIGHT_VECTOR_X_RATIO: 0.73,
    // Découpe d'une case (image_splitter.py)
    SPLIT_X_RATIO: 0.5,
    SPLIT_Y_RATIO: 0.5,
    LEFT_QUARTER_WIDTH_RATIO: 0.20,
    LEFT_QUARTER_HEIGHT_RATIO: 0.25,
    // OCR / seuils (auto_box_config.py)
    OCR_LUMINOSITY_THRESHOLD: 100,
    CNN_CONFIDENCE_THRESHOLD: 0.60,
    NAME_MATCH_MIN_SCORE: 55,
    NAME_MATCH_EXACT_SCORE: 95,
    // Ajout web : une correspondance approchée est acceptée sans être
    // signalée si elle est nette (score >= ce seuil) et sans ambiguïté
    // (écart avec le 2e candidat >= NAME_MATCH_MARGIN).
    NAME_MATCH_SURE_SCORE: 80,
    NAME_MATCH_MARGIN: 15
  };

  // Personnages connus pour être mal détectés : toujours à vérifier.
  const PROBLEMES_CONNUS = {
    kokomi: "Sangonomiya Kokomi est mal détectée : vérifie-la manuellement."
  };

  // Noms affichés par Hoyolab (FR) différents de characters.json.
  const ALIAS = {
    nomade: "wanderer",
    manekina: "manekin",
    voyageur: "traveler",
    voyageuse: "traveler",
    traveler: "traveler"
  };

  // Personnages qui peuvent apparaître 2 fois (variantes masculine /
  // féminine) : on garde la meilleure constellation, sans alerte.
  const DOUBLONS_NORMAUX = new Set(["manekin"]);

  // Le Voyageur (Voyageur / Voyageuse, Traveler) : ignoré seulement s'il
  // n'est pas dans la liste des personnages (sinon reconnu via ALIAS).
  const MOTIF_VOYAGEUR = /voyag|traveler/;

  // Python round() : arrondi au pair le plus proche sur les .5.
  function arrondiPython(x) {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  }

  const borner = (v, min, max) => Math.max(min, Math.min(max, v));

  // ============================================================
  // Images
  // ============================================================

  function recadrer(image, x0, y0, x1, y1) {
    x0 = borner(x0, 0, image.width); x1 = borner(x1, x0, image.width);
    y0 = borner(y0, 0, image.height); y1 = borner(y1, y0, image.height);
    const width = x1 - x0;
    const height = y1 - y0;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const debut = ((y0 + y) * image.width + x0) * 4;
      data.set(image.data.subarray(debut, debut + width * 4), y * width * 4);
    }
    return { width, height, data };
  }

  // Niveaux de gris, même formule que PIL convert("L").
  function niveauxDeGris(image) {
    const gris = new Uint8Array(image.width * image.height);
    for (let i = 0, p = 0; i < gris.length; i++, p += 4) {
      gris[i] = (image.data[p] * 19595 + image.data[p + 1] * 38470 + image.data[p + 2] * 7471 + 0x8000) >> 16;
    }
    return { width: image.width, height: image.height, gris };
  }

  // Redimensionnement bilinéaire avec anticrénelage, comme PIL resize(BILINEAR)
  // (passe horizontale puis verticale, arrondi 8 bits entre les deux).
  function coefficientsPIL(tailleEntree, tailleSortie) {
    const echelle = tailleEntree / tailleSortie;
    const echelleFiltre = Math.max(echelle, 1);
    const support = echelleFiltre;
    const coefs = [];
    for (let i = 0; i < tailleSortie; i++) {
      const centre = (i + 0.5) * echelle;
      const min = Math.max(Math.trunc(centre - support + 0.5), 0);
      const max = Math.min(Math.trunc(centre + support + 0.5), tailleEntree);
      const poids = [];
      let total = 0;
      for (let x = min; x < max; x++) {
        const d = Math.abs((x - centre + 0.5) / echelleFiltre);
        const w = d < 1 ? 1 - d : 0;
        poids.push(w);
        total += w;
      }
      coefs.push({ min, poids: poids.map(w => (total ? w / total : 0)) });
    }
    return coefs;
  }

  function redimensionnerGris({ width, height, gris }, largeur, hauteur) {
    const horizontal = coefficientsPIL(width, largeur);
    const vertical = coefficientsPIL(height, hauteur);
    const temp = new Uint8Array(largeur * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < largeur; x++) {
        const { min, poids } = horizontal[x];
        let s = 0;
        for (let k = 0; k < poids.length; k++) s += gris[y * width + min + k] * poids[k];
        temp[y * largeur + x] = borner(Math.round(s), 0, 255);
      }
    }
    const sortie = new Uint8Array(largeur * hauteur);
    for (let y = 0; y < hauteur; y++) {
      const { min, poids } = vertical[y];
      for (let x = 0; x < largeur; x++) {
        let s = 0;
        for (let k = 0; k < poids.length; k++) s += temp[(min + k) * largeur + x] * poids[k];
        sortie[y * largeur + x] = borner(Math.round(s), 0, 255);
      }
    }
    return { width: largeur, height: hauteur, gris: sortie };
  }

  // Binarisation pour l'OCR : blanc si luminosité >= seuil, noir sinon
  // (inverse : l'inverse). Renvoie une image RGBA.
  function binariser(image, seuil, inverse) {
    const { gris } = niveauxDeGris(image);
    const data = new Uint8ClampedArray(image.width * image.height * 4);
    for (let i = 0; i < gris.length; i++) {
      let v = gris[i] >= seuil ? 255 : 0;
      if (inverse) v = 255 - v;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    return { width: image.width, height: image.height, data };
  }

  // ============================================================
  // 1. Grille (box_character_finder.py)
  // ============================================================

  function masqueColonne(image, xCentre, y0, y1) {
    const moitie = Math.floor(CONFIG.PROBE_WIDTH / 2);
    const x0 = borner(xCentre - moitie, 0, image.width - 1);
    const x1 = borner(xCentre + moitie + 1, x0 + 1, image.width);
    const [cr, cg, cb] = CONFIG.TARGET_GRAY_RGB;
    const tol = CONFIG.COLOR_TOLERANCE;
    const masque = new Uint8Array(y1 - y0);

    for (let y = y0; y < y1; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) {
        const p = (y * image.width + x) * 4;
        if (Math.abs(image.data[p] - cr) <= tol &&
            Math.abs(image.data[p + 1] - cg) <= tol &&
            Math.abs(image.data[p + 2] - cb) <= tol) n++;
      }
      masque[y - y0] = n >= CONFIG.MIN_MATCHING_PIXELS_PER_ROW ? 1 : 0;
    }
    return masque;
  }

  function reboucherTrous(masque, tailleMax) {
    const m = masque.slice();
    let i = 0;
    while (i < m.length) {
      if (m[i]) { i++; continue; }
      let j = i;
      while (j < m.length && !m[j]) j++;
      if (i > 0 && m[i - 1] && j < m.length && m[j] && j - i <= tailleMax) m.fill(1, i, j);
      i = j;
    }
    return m;
  }

  function extraireRuns(masque, decalage, longueurMin) {
    const runs = [];
    let debut = -1;
    for (let i = 0; i <= masque.length; i++) {
      const actif = i < masque.length && masque[i];
      if (actif && debut < 0) debut = i;
      if (!actif && debut >= 0) {
        if (i - debut >= longueurMin) runs.push({ debut: decalage + debut, fin: decalage + i - 1 });
        debut = -1;
      }
    }
    return runs;
  }

  function detecterCases(image) {
    const { width, height } = image;
    const hautY = arrondiPython(width * CONFIG.HEADER_RATIO);
    const basY = height - arrondiPython(width * CONFIG.FOOTER_RATIO);
    if (basY <= hautY) {
      throw new Error("Image trop petite ou mal cadrée : impossible de trouver la liste des personnages.");
    }

    const longueurMin = Math.max(1, arrondiPython(width * CONFIG.MIN_RUN_LENGTH_RATIO));
    const colonnes = [
      { cote: "gauche", sonde: CONFIG.LEFT_VECTOR_X_RATIO, x: CONFIG.LEFT_CELL_X },
      { cote: "droite", sonde: CONFIG.RIGHT_VECTOR_X_RATIO, x: CONFIG.RIGHT_CELL_X }
    ];

    const cases = [];
    colonnes.forEach(({ cote, sonde, x }) => {
      const masque = reboucherTrous(
        masqueColonne(image, arrondiPython(width * sonde), hautY, basY),
        CONFIG.MAX_HOLE_SIZE
      );
      extraireRuns(masque, hautY, longueurMin).forEach((run, index) => {
        cases.push({
          colonne: cote,
          index: index + 1,
          x0: arrondiPython(width * x[0]),
          x1: arrondiPython(width * x[1]),
          y0: run.debut,
          y1: run.fin + 1
        });
      });
    });
    return cases;
  }

  // ============================================================
  // 2. Découpe d'une case (image_splitter.py)
  // ============================================================

  function decouperCase(caseImage) {
    const { width: w, height: h } = caseImage;
    const splitX = arrondiPython(w * CONFIG.SPLIT_X_RATIO);
    const splitY = arrondiPython(h * CONFIG.SPLIT_Y_RATIO);
    const quartL = arrondiPython(splitX * CONFIG.LEFT_QUARTER_WIDTH_RATIO);
    const quartH = arrondiPython(h * CONFIG.LEFT_QUARTER_HEIGHT_RATIO);
    return {
      constellation: recadrer(caseImage, splitX - quartL, 0, splitX, quartH),
      nomNiveau: recadrer(caseImage, splitX, 0, w, splitY)
    };
  }

  // ============================================================
  // 3. CNN des constellations (mini_cnn/model.py, BatchNorm fusionnées)
  // ============================================================

  function convolutionRelu(entree, canauxE, h, w, couche) {
    const [canauxS] = couche.forme;
    const { poids, biais } = couche;
    const sortie = new Float32Array(canauxS * h * w);
    for (let co = 0; co < canauxS; co++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let s = biais[co];
          for (let ci = 0; ci < canauxE; ci++) {
            const baseP = (co * canauxE + ci) * 9;
            const baseE = ci * h * w;
            for (let ky = 0; ky < 3; ky++) {
              const yy = y + ky - 1;
              if (yy < 0 || yy >= h) continue;
              for (let kx = 0; kx < 3; kx++) {
                const xx = x + kx - 1;
                if (xx < 0 || xx >= w) continue;
                s += entree[baseE + yy * w + xx] * poids[baseP + ky * 3 + kx];
              }
            }
          }
          sortie[(co * h + y) * w + x] = s > 0 ? s : 0;
        }
      }
    }
    return sortie;
  }

  function maxPool2(entree, canaux, h, w) {
    const h2 = Math.floor(h / 2);
    const w2 = Math.floor(w / 2);
    const sortie = new Float32Array(canaux * h2 * w2);
    for (let c = 0; c < canaux; c++) {
      for (let y = 0; y < h2; y++) {
        for (let x = 0; x < w2; x++) {
          const b = c * h * w + 2 * y * w + 2 * x;
          sortie[(c * h2 + y) * w2 + x] = Math.max(entree[b], entree[b + 1], entree[b + w], entree[b + w + 1]);
        }
      }
    }
    return { sortie, h: h2, w: w2 };
  }

  function predireConstellation(modele, imageConstellation) {
    const { largeur, hauteur } = modele.taille_entree;
    const reduit = redimensionnerGris(niveauxDeGris(imageConstellation), largeur, hauteur);

    let h = hauteur;
    let w = largeur;
    let canaux = 1;
    let x = Float32Array.from(reduit.gris, v => (v / 255 - 0.5) / 0.5);

    modele.convolutions.forEach((couche, i) => {
      x = convolutionRelu(x, canaux, h, w, couche);
      canaux = couche.forme[0];
      if (i < modele.convolutions.length - 1) {
        ({ sortie: x, h, w } = maxPool2(x, canaux, h, w));
      }
    });

    // Moyenne globale puis couche linéaire.
    const moyennes = new Float32Array(canaux);
    for (let c = 0; c < canaux; c++) {
      let s = 0;
      for (let i = 0; i < h * w; i++) s += x[c * h * w + i];
      moyennes[c] = s / (h * w);
    }
    const [nbClasses] = modele.lineaire.forme;
    const logits = [];
    for (let k = 0; k < nbClasses; k++) {
      let s = modele.lineaire.biais[k];
      for (let c = 0; c < canaux; c++) s += moyennes[c] * modele.lineaire.poids[k * canaux + c];
      logits.push(s);
    }
    const max = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - max));
    const total = exps.reduce((a, b) => a + b, 0);
    const probas = exps.map(e => e / total);
    const meilleur = probas.indexOf(Math.max(...probas));
    return { constellation: modele.classes[meilleur], confiance: probas[meilleur] };
  }

  // ============================================================
  // 4. Niveau + nom (level_parsing.py)
  // ============================================================

  // Lu sur la ligne entière (et non mot par mot) : l'OCR sépare parfois
  // "Niv" et "90" en deux mots. Variantes : "Lv." (Hoyolab en anglais) et
  // lectures OCR fréquentes du mot ("Iv", "I'v", "Tv", "1v"...). Chiffres
  // parfois lus comme des lettres : G -> 9, O -> 0 ("Niv.G0" = 90).
  const MOTIF_NIVEAU = /(?:^|\s)(?:niv|n1v|liv|lv|l'v|i'v|iv|tv|1v)[.,:]?\s*([0-9GgOo]{1,3})?/i;

  function texteLigne(mots) {
    return mots.map(mot => mot.texte).join(" ");
  }

  function lireNiveau(mots) {
    const m = MOTIF_NIVEAU.exec(texteLigne(mots));
    if (!m || !m[1]) return null;
    const niveau = Number(m[1].replace(/[Gg]/g, "9").replace(/[Oo]/g, "0"));
    return niveau >= 1 && niveau <= 100 ? niveau : null;
  }

  // Nom = tout ce qui précède le niveau.
  function lireNom(mots) {
    const ligne = texteLigne(mots);
    const m = MOTIF_NIVEAU.exec(ligne);
    return (m ? ligne.slice(0, m.index) : ligne).replace(/\s+/g, " ").trim();
  }

  // ============================================================
  // 5. Correspondance des noms (name_matching.py, rapidfuzz)
  // ============================================================

  function normaliserNom(texte) {
    return texte.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().trim();
  }

  // rapidfuzz fuzz.ratio : similarité Indel normalisée, sur 100.
  function ratio(a, b) {
    if (!a.length && !b.length) return 100;
    let precedent = new Uint16Array(b.length + 1);
    let courant = new Uint16Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        courant[j] = a[i - 1] === b[j - 1]
          ? precedent[j - 1] + 1
          : Math.max(precedent[j], courant[j - 1]);
      }
      [precedent, courant] = [courant, precedent];
    }
    const lcs = precedent[b.length];
    return (200 * lcs) / (a.length + b.length);
  }

  // rapidfuzz fuzz.token_sort_ratio : mots triés puis ratio.
  const trierMots = texte => texte.split(/\s+/).filter(Boolean).sort().join(" ");
  const tokenSortRatio = (a, b) => ratio(trierMots(a), trierMots(b));

  // Ajout web : forme canonique qui confond les lettres que l'OCR mélange
  // (g/q, l/i/1/|, 0/o), appliquée aux deux côtés de la comparaison :
  // "lansan" = "Iansan", "Qigi" = "Qiqi", "Keging" = "Keqing".
  function canoniser(texte) {
    return trierMots(normaliserNom(texte)
      .replace(/g/g, "q")
      .replace(/[l1|]/g, "i")
      .replace(/0/g, "o")
      .replace(/[^a-z' ]/g, " "));
  }

  function creerCorrespondance(personnages) {
    const parId = new Map(personnages.map(p => [p.id, p]));
    const choix = personnages.map(p => ({ cle: canoniser(p.nom), personnage: p }));
    Object.entries(ALIAS).forEach(([nom, id]) => {
      if (parId.has(id)) choix.push({ cle: canoniser(nom), personnage: parId.get(id) });
    });

    // -> { personnage | null, score, second } (second : meilleur score d'un
    // AUTRE personnage, pour juger de l'ambiguïté).
    return function trouver(nomOcr) {
      const requete = canoniser(nomOcr);
      if (!requete) return { personnage: null, score: 0, second: 0 };
      const scores = new Map();
      choix.forEach(({ cle, personnage }) => {
        const score = ratio(requete, cle);
        if (score > (scores.get(personnage) ?? -1)) scores.set(personnage, score);
      });
      const classes = [...scores.entries()].sort((a, b) => b[1] - a[1]);
      const [personnage, score] = classes[0];
      const second = classes[1] ? classes[1][1] : 0;
      if (score < CONFIG.NAME_MATCH_MIN_SCORE) return { personnage: null, score, second };
      return { personnage, score, second };
    };
  }

  function estVoyageur(nomOcr) {
    return MOTIF_VOYAGEUR.test(normaliserNom(nomOcr));
  }

  // ============================================================
  // Pipeline complet
  // ============================================================

  // ocr(imageRGBA) -> Promise<[{ texte, confiance }]> (Tesseract).
  async function analyserImage(image, { modele, personnages, ocr, progression = () => {} }) {
    const cases = detecterCases(image);
    if (cases.length === 0) {
      throw new Error("Aucune case de personnage trouvée. Vérifie qu'il s'agit bien de la liste des personnages Hoyolab, en entier.");
    }

    const trouver = creerCorrespondance(personnages);
    const entrees = [];
    let faites = 0;

    // OCR en parallèle (limité par le nombre de workers Tesseract).
    await Promise.all(cases.map(async c => {
      const caseImage = recadrer(image, c.x0, c.y0, c.x1, c.y1);
      const zones = decouperCase(caseImage);
      const { constellation, confiance } = predireConstellation(modele, zones.constellation);

      const seuil = CONFIG.OCR_LUMINOSITY_THRESHOLD;
      const [normal, inverse] = await Promise.all([
        ocr(binariser(zones.nomNiveau, seuil, false)),
        ocr(binariser(zones.nomNiveau, seuil, true))
      ]);
      const total = mots => mots.reduce((s, m) => s + m.confiance, 0);
      const mots = total(normal) >= total(inverse) ? normal : inverse;

      const niveau = lireNiveau(mots);
      const nomLu = lireNom(mots);
      const voyageur = estVoyageur(nomLu) && !personnages.some(p => p.id === "traveler");
      const { personnage, score, second } = voyageur ? { personnage: null, score: 0, second: 0 } : trouver(nomLu);

      entrees.push({ case: c, caseImage, nomLu, voyageur, personnage, score, second, constellation, confiance, niveau });
      progression(++faites, cases.length);
    }));

    // Ordre de la capture : colonne de gauche puis de droite, de haut en bas.
    entrees.sort((a, b) => (a.case.colonne === b.case.colonne ? a.case.index - b.case.index : a.case.colonne === "gauche" ? -1 : 1));
    return finaliser(entrees);
  }

  // Raisons de douter de chaque case + résultat final.
  function finaliser(entrees) {
    // Variantes d'un même personnage (Manekin / Manekina) : seule la case à
    // la meilleure constellation est gardée.
    DOUBLONS_NORMAUX.forEach(id => {
      const variantes = entrees.filter(e => e.personnage && e.personnage.id === id);
      variantes.sort((a, b) => b.constellation - a.constellation).slice(1).forEach(e => {
        e.fusionnee = true;
      });
    });

    const occurrences = {};
    entrees.forEach(e => {
      if (e.personnage && !e.fusionnee) occurrences[e.personnage.id] = (occurrences[e.personnage.id] || 0) + 1;
    });

    entrees.forEach(e => {
      const raisons = [];
      // Voyageur (absent de la liste) et variantes fusionnées : ignorés.
      e.ignoree = e.voyageur || !!e.fusionnee;
      const approche = e.personnage && e.score < CONFIG.NAME_MATCH_EXACT_SCORE;
      const approcheSure = approche &&
        e.score >= CONFIG.NAME_MATCH_SURE_SCORE &&
        e.score - e.second >= CONFIG.NAME_MATCH_MARGIN;
      if (!e.personnage && !e.ignoree) {
        raisons.push(e.nomLu ? `nom non reconnu (« ${e.nomLu} »)` : "nom illisible");
      } else if (approche && !approcheSure) {
        raisons.push(`nom approché (« ${e.nomLu} » → ${e.personnage.nom})`);
      }
      if (e.confiance < CONFIG.CNN_CONFIDENCE_THRESHOLD) {
        raisons.push(`constellation incertaine (${Math.round(e.confiance * 100)} %)`);
      }
      if (e.personnage && occurrences[e.personnage.id] > 1) {
        raisons.push("personnage détecté plusieurs fois");
      }
      if (e.personnage && PROBLEMES_CONNUS[e.personnage.id]) {
        raisons.push(PROBLEMES_CONNUS[e.personnage.id]);
      }
      e.raisons = raisons;
    });

    return {
      entrees,
      incertaines: entrees.filter(e => !e.ignoree && e.raisons.length > 0),
      sures: entrees.filter(e => !e.ignoree && e.raisons.length === 0),
      problemesConnus: PROBLEMES_CONNUS
    };
  }

  const AutoBox = {
    CONFIG,
    PROBLEMES_CONNUS,
    recadrer,
    niveauxDeGris,
    redimensionnerGris,
    binariser,
    detecterCases,
    decouperCase,
    predireConstellation,
    lireNiveau,
    lireNom,
    normaliserNom,
    tokenSortRatio,
    creerCorrespondance,
    analyserImage,
    finaliser
  };

  if (typeof module !== "undefined" && module.exports) module.exports = AutoBox;
  else racine.AutoBox = AutoBox;
})(typeof window !== "undefined" ? window : globalThis);
