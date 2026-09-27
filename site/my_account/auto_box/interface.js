// Fenêtre "Détection automatique de la box" (bêta) de la page Mon compte.
//
// Dépôt (ou choix) d'une capture Hoyolab -> analyse dans le navigateur
// (detection.js + Tesseract.js) -> les personnages sûrs sont prêts à être
// importés, les incertains (et toujours Kokomi) sont affichés avec leurs
// cases (- / +, stella) pour correction avant d'appliquer à la Full Box.
//
// Utilise les fonctions de my_account.js (creerCarteItem, creerCoinBasDroite,
// afficherCollection, mettreAJourTotalBox, afficherToast).

const AUTO_BOX_TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const AUTO_BOX_MODELE_URL = "/my_account/auto_box/modele_constellations.json";
const AUTO_BOX_NB_WORKERS = 3;
const AUTO_BOX_TOUJOURS_VERIFIER = ["kokomi"];

let autoBoxModele = null;

function chargerScriptTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = AUTO_BOX_TESSERACT_URL;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Impossible de charger le moteur de lecture de texte (connexion ?)."));
    document.head.appendChild(script);
  });
}

async function chargerModeleConstellations() {
  if (autoBoxModele) return autoBoxModele;
  const reponse = await fetch(AUTO_BOX_MODELE_URL);
  if (!reponse.ok) throw new Error("Impossible de charger le modèle de détection.");
  autoBoxModele = await reponse.json();
  return autoBoxModele;
}

// Fichier image -> { width, height, data } (pixels RGBA).
async function lireImage(fichier) {
  const bitmap = await createImageBitmap(fichier);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function versCanvas(image, hauteurMax = null) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  if (!hauteurMax || image.height <= hauteurMax) return canvas;

  const reduit = document.createElement("canvas");
  reduit.height = hauteurMax;
  reduit.width = Math.round(image.width * hauteurMax / image.height);
  reduit.getContext("2d").drawImage(canvas, 0, 0, reduit.width, reduit.height);
  return reduit;
}

// Pool de workers Tesseract : OCR de plusieurs cases en parallèle.
async function creerOcr() {
  await chargerScriptTesseract();
  const workers = await Promise.all(
    Array.from({ length: AUTO_BOX_NB_WORKERS }, () => window.Tesseract.createWorker("eng"))
  );
  const libres = [...workers];
  const attente = [];

  async function ocr(image) {
    while (libres.length === 0) await new Promise(resolve => attente.push(resolve));
    const worker = libres.pop();
    try {
      const { data } = await worker.recognize(versCanvas(image));
      return data.words
        .map(mot => ({ texte: mot.text.trim(), confiance: mot.confidence }))
        .filter(mot => mot.texte && mot.confiance > 0);
    } finally {
      libres.push(worker);
      attente.shift()?.();
    }
  }

  ocr.terminer = () => Promise.all(workers.map(worker => worker.terminate()));
  return ocr;
}

function initialiserAutoBox(profil, personnages, armes) {
  const modal = document.getElementById("modal-auto-box");
  const zoneDepot = document.getElementById("zone-depot");
  const inputFichier = document.getElementById("auto-box-fichier");
  const etat = document.getElementById("auto-box-etat");
  const resultat = document.getElementById("auto-box-resultat");
  const resume = document.getElementById("auto-box-resume");
  const listeIncertains = document.getElementById("auto-box-incertains");
  const boutonAppliquer = document.getElementById("auto-box-appliquer");
  const boutonRecommencer = document.getElementById("auto-box-recommencer");

  const persosParId = new Map(personnages.map(p => [p.id, p]));
  const persosTries = [...personnages].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  // Analyse en cours : { sures, incertaines } (les incertaines sont
  // modifiables dans la fenêtre avant application).
  let analyse = null;
  let enCours = false;

  function afficherEtat(message, erreur = false) {
    etat.textContent = message;
    etat.classList.toggle("erreur", erreur);
    etat.classList.toggle("cache", !message);
  }

  function reinitialiser() {
    analyse = null;
    inputFichier.value = "";
    afficherEtat("");
    resultat.classList.add("cache");
    listeIncertains.innerHTML = "";
    boutonAppliquer.disabled = true;
    boutonRecommencer.classList.add("cache");
    zoneDepot.classList.remove("cache");
  }

  function ouvrir() {
    reinitialiser();
    modal.classList.add("active");
  }

  function fermer() {
    if (enCours) return;
    modal.classList.remove("active");
  }

  // ---- Affichage des personnages incertains ----

  function creerLigne(entree, index) {
    const ligne = document.createElement("div");
    ligne.className = "auto-box-ligne";
    ligne.dataset.index = index;

    // Case telle qu'elle apparaît sur la capture, pour comparer.
    if (entree.caseImage) {
      const vignette = versCanvas(entree.caseImage, 90);
      vignette.className = "auto-box-vignette";
      ligne.appendChild(vignette);
    }

    const zoneCarte = document.createElement("div");
    zoneCarte.className = "auto-box-carte";
    if (entree.personnage) {
      const niveau = entree.niveau === 95 || entree.niveau === 100 ? entree.niveau : null;
      zoneCarte.appendChild(creerCarteItem(
        entree.personnage, entree.constellation, "full", entree.constellation >= 0, "characters",
        null, false, false, niveau,
        creerCoinBasDroite(entree.personnage, "characters", personnages, armes, profil)
      ));
    }

    // Choix du personnage (nom non reconnu ou mal reconnu).
    const choix = document.createElement("select");
    choix.className = "auto-box-choix";
    choix.innerHTML = `<option value="">Ignorer cette case</option>` +
      persosTries.map(p => `<option value="${p.id}">${p.nom}</option>`).join("");
    choix.value = entree.personnage ? entree.personnage.id : "";
    zoneCarte.appendChild(choix);
    ligne.appendChild(zoneCarte);

    const raisons = document.createElement("ul");
    raisons.className = "auto-box-raisons";
    entree.raisons.forEach(raison => {
      const li = document.createElement("li");
      li.textContent = raison;
      raisons.appendChild(li);
    });
    ligne.appendChild(raisons);

    return ligne;
  }

  function rendreIncertains() {
    listeIncertains.innerHTML = "";
    analyse.incertaines.forEach((entree, index) => listeIncertains.appendChild(creerLigne(entree, index)));
  }

  function rendreResultat() {
    // Cases réellement lues sur la capture (hors Kokomi ajoutée d'office).
    const nbSures = analyse.sures.length;
    const nbLues = nbSures + analyse.incertaines.filter(e => e.caseImage).length;
    resume.textContent = `${nbLues} personnages détectés, dont ${nbSures} sans doute. ` +
      "Vérifie les personnages ci-dessous, puis applique à ta Full Box.";
    rendreIncertains();
    resultat.classList.remove("cache");
    zoneDepot.classList.add("cache");
    boutonRecommencer.classList.remove("cache");
    boutonAppliquer.disabled = false;
  }

  // Les personnages toujours à vérifier (Kokomi) sont ajoutés aux
  // incertains ; s'ils n'ont pas été détectés, avec leur valeur actuelle.
  function preparerAnalyse(brut) {
    const collection = profil.characters;
    const incertaines = [...brut.incertaines];
    const sures = [];

    brut.sures.forEach(entree => {
      if (AUTO_BOX_TOUJOURS_VERIFIER.includes(entree.personnage.id)) {
        entree.raisons = [AutoBox.PROBLEMES_CONNUS[entree.personnage.id]];
        incertaines.push(entree);
      } else {
        sures.push(entree);
      }
    });

    AUTO_BOX_TOUJOURS_VERIFIER.forEach(id => {
      const personnage = persosParId.get(id);
      const dejaLa = incertaines.some(e => e.personnage && e.personnage.id === id);
      if (!personnage || dejaLa) return;
      incertaines.push({
        personnage,
        constellation: collection.full[id] ?? -1,
        niveau: collection.niveaux?.[id] ?? null,
        raisons: [`Non détecté : ${AutoBox.PROBLEMES_CONNUS[id] || "à vérifier manuellement."}`]
      });
    });

    return { sures, incertaines };
  }

  async function analyserFichier(fichier) {
    if (enCours) return;
    if (!fichier || !fichier.type.startsWith("image/")) {
      afficherEtat("Ce fichier n'est pas une image.", true);
      return;
    }

    enCours = true;
    modal.classList.add("occupe");
    let ocr = null;
    try {
      afficherEtat("Chargement de la détection…");
      const [image, modele] = await Promise.all([lireImage(fichier), chargerModeleConstellations()]);
      ocr = await creerOcr();

      afficherEtat("Lecture des personnages…");
      const brut = await AutoBox.analyserImage(image, {
        modele,
        personnages,
        ocr,
        progression: (faites, total) => afficherEtat(`Lecture des personnages : ${faites} / ${total}`)
      });

      analyse = preparerAnalyse(brut);
      afficherEtat("");
      rendreResultat();
    } catch (erreur) {
      console.error(erreur);
      afficherEtat(erreur.message || "Erreur pendant la détection.", true);
    } finally {
      await ocr?.terminer();
      enCours = false;
      modal.classList.remove("occupe");
    }
  }

  // ---- Modifications dans la fenêtre ----

  function entreeDe(element) {
    const ligne = element.closest(".auto-box-ligne");
    return ligne ? analyse.incertaines[Number(ligne.dataset.index)] : null;
  }

  listeIncertains.addEventListener("click", event => {
    const bouton = event.target.closest(".moins-btn, .plus-btn");
    const entree = bouton && entreeDe(bouton);
    if (!entree) return;
    const max = 6;
    if (bouton.classList.contains("plus-btn")) {
      entree.constellation = entree.constellation === max ? -1 : entree.constellation + 1;
    } else {
      entree.constellation = entree.constellation === -1 ? max : entree.constellation - 1;
    }
    rendreIncertains();
  });

  listeIncertains.addEventListener("change", event => {
    const entree = entreeDe(event.target);
    if (!entree) return;

    if (event.target.classList.contains("niveau-select")) {
      entree.niveau = event.target.value ? Number(event.target.value) : null;
    } else if (event.target.classList.contains("auto-box-choix")) {
      entree.personnage = persosParId.get(event.target.value) || null;
    }
    rendreIncertains();
  });

  // ---- Application à la Full Box ----

  function appliquer() {
    const collection = profil.characters;
    collection.niveaux ??= {};
    let nb = 0;

    [...analyse.sures, ...analyse.incertaines].forEach(entree => {
      if (!entree.personnage) return;
      const id = entree.personnage.id;
      collection.full[id] = entree.constellation;
      nb++;

      if (entree.constellation < 0) {
        delete collection.niveaux[id];
        Object.keys(collection.selections).forEach(box => delete collection.selections[box][id]);
      } else if (entree.niveau === 95 || entree.niveau === 100) {
        collection.niveaux[id] = entree.niveau;
      } else if (entree.niveau !== null && entree.niveau !== undefined) {
        delete collection.niveaux[id];
      }
    });

    afficherCollection(personnages, armes, profil);
    mettreAJourTotalBox(personnages, armes, profil);
    modal.classList.remove("active");
    afficherToast(`${nb} personnages importés : vérifie puis clique sur Enregistrer`);
  }

  // ---- Dépôt / choix du fichier ----

  zoneDepot.addEventListener("dragover", event => {
    event.preventDefault();
    zoneDepot.classList.add("survol");
  });
  zoneDepot.addEventListener("dragleave", () => zoneDepot.classList.remove("survol"));
  zoneDepot.addEventListener("drop", event => {
    event.preventDefault();
    zoneDepot.classList.remove("survol");
    analyserFichier(event.dataTransfer.files[0]);
  });
  inputFichier.addEventListener("change", () => analyserFichier(inputFichier.files[0]));

  document.getElementById("btn-auto-box").addEventListener("click", ouvrir);
  document.getElementById("fermer-auto-box").addEventListener("click", fermer);
  document.getElementById("auto-box-annuler").addEventListener("click", fermer);
  boutonRecommencer.addEventListener("click", reinitialiser);
  boutonAppliquer.addEventListener("click", appliquer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
}
