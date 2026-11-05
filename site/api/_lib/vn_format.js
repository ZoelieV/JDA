// Validation d'une histoire de visual novel envoyée par l'éditeur (format :
// cf. visual_novel.js). Ce qui rendrait l'histoire illisible est refusé ; ce
// qui n'est pas encore écrit (panneau sans suite, choix sans destination) est
// accepté et signalé par des avertissements, pour pouvoir enregistrer en cours
// de route. Seuls les champs connus sont gardés.
const { lirePoliceVn } = require("../../commun/vn_polices.js");

const MAX = { chapitres: 50, sousChapitres: 60, panneaux: 3000, persos: 12, options: 8, texte: 2000, nom: 60, titre: 80, option: 300 };

const ID = /^[a-z0-9_-]{1,40}$/;
// Images du site, ou importées (vn/...) ; jamais d'adresse externe.
const IMAGE = /^(?:bg_web|characters|namecards|vn)\/(?:[^/\\?#"<>]+\/)*[^/\\?#"<>]+\.(?:webp|png|jpg)$/;

const estImage = valeur => typeof valeur === "string" && valeur.length <= 200 && IMAGE.test(valeur) && !valeur.includes("..");
const texteDe = (valeur, max) => (typeof valeur === "string" ? valeur.slice(0, max) : "");
const borne = (valeur, min, max, defaut) => {
  const n = Number(valeur);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 10) / 10 : defaut;
};

class ErreurFormat extends Error {}
function exiger(condition, message) {
  if (!condition) throw new ErreurFormat(message);
}

function lireEnsuite(brut, lieu, idsOption) {
  if (brut?.type === "fin") {
    exiger(ID.test(brut.id), `${lieu} : fin invalide.`);
    return { type: "fin", id: brut.id, nom: texteDe(brut.nom, MAX.nom).trim() || "Fin" };
  }
  if (brut?.type === "choix") {
    const options = Array.isArray(brut.options) ? brut.options : [];
    exiger(options.length <= MAX.options, `${lieu} : ${MAX.options} réponses au plus.`);
    return {
      type: "choix",
      options: options.map(option => {
        exiger(ID.test(option?.id) && !idsOption.has(option.id), `${lieu} : réponse invalide.`);
        idsOption.add(option.id);
        return { id: option.id, texte: texteDe(option.texte, MAX.option), vers: typeof option.vers === "string" ? option.vers : null };
      })
    };
  }
  return typeof brut?.vers === "string" && brut.vers ? { type: "suite", vers: brut.vers } : { type: "suite" };
}

function lirePanneau(brut, lieu) {
  exiger(ID.test(brut?.id), `${lieu} : identifiant invalide.`);
  const persos = Array.isArray(brut.persos) ? brut.persos : [];
  exiger(persos.length <= MAX.persos, `${lieu} : ${MAX.persos} personnages au plus.`);
  exiger(brut.fond == null || brut.fond === "" || estImage(brut.fond), `${lieu} : fond invalide.`);
  return {
    id: brut.id,
    fond: brut.fond || null,
    nom: texteDe(brut.nom, MAX.nom),
    texte: texteDe(brut.texte, MAX.texte),
    persos: persos.map(perso => {
      exiger(estImage(perso?.image), `${lieu} : image de personnage invalide.`);
      return {
        image: perso.image,
        x: borne(perso.x, -30, 130, 50),
        y: borne(perso.y, -100, 100, 30),
        hauteur: borne(perso.hauteur, 5, 250, 42),
        miroir: perso.miroir === true
      };
    }),
    police: lirePoliceVn(brut.police),
    ensuite: lireEnsuite(brut.ensuite, lieu, new Set())
  };
}

function lireChapitre(brut, numero, idsVus) {
  exiger(ID.test(brut?.id) && !idsVus.has(brut.id), `Chapitre ${numero} : identifiant invalide.`);
  idsVus.add(brut.id);
  const titre = texteDe(brut.titre, MAX.titre).trim() || `Chapitre ${numero}`;
  exiger(brut.namecard == null || brut.namecard === "" || estImage(brut.namecard), `${titre} : namecard invalide.`);
  const brutsSc = Array.isArray(brut.sous_chapitres) ? brut.sous_chapitres : [];
  exiger(brutsSc.length >= 1, `${titre} : il faut au moins un sous-chapitre.`);
  exiger(brutsSc.length <= MAX.sousChapitres, `${titre} : ${MAX.sousChapitres} sous-chapitres au plus.`);

  const idsSc = new Set();
  const idsPanneaux = new Set();
  const sousChapitres = brutsSc.map((sc, i) => {
    const titreSc = texteDe(sc?.titre, MAX.titre).trim() || `Sous-chapitre ${i + 1}`;
    exiger(ID.test(sc?.id) && !idsSc.has(sc.id), `${titre}, ${titreSc} : identifiant invalide.`);
    idsSc.add(sc.id);
    const panneaux = Array.isArray(sc.panneaux) ? sc.panneaux : [];
    exiger(panneaux.length >= 1, `${titre}, ${titreSc} : il faut au moins un panneau.`);
    return {
      id: sc.id,
      titre: titreSc,
      panneaux: panneaux.map((p, n) => {
        const panneau = lirePanneau(p, `${titre}, ${titreSc}, panneau ${n + 1}`);
        exiger(!idsPanneaux.has(panneau.id), `${titre}, ${titreSc}, panneau ${n + 1} : identifiant en double.`);
        idsPanneaux.add(panneau.id);
        return panneau;
      })
    };
  });
  return { id: brut.id, titre, namecard: brut.namecard || null, sous_chapitres: sousChapitres };
}

// -> { histoire } ou { erreur }
function lireHistoireVn(brut, id) {
  try {
    const chapitres = Array.isArray(brut?.chapitres) ? brut.chapitres : [];
    exiger(chapitres.length >= 1, "Il faut au moins un chapitre.");
    exiger(chapitres.length <= MAX.chapitres, `${MAX.chapitres} chapitres au plus.`);
    exiger(brut.namecard == null || brut.namecard === "" || estImage(brut.namecard), "Namecard de l'event invalide.");
    const idsVus = new Set();
    const histoire = {
      id,
      nom: texteDe(brut.nom, MAX.titre).trim() || "Visual novel",
      namecard: brut.namecard || null,
      chapitres: chapitres.map((c, i) => lireChapitre(c, i + 1, idsVus))
    };
    const total = histoire.chapitres.flatMap(c => c.sous_chapitres).flatMap(sc => sc.panneaux).length;
    exiger(total <= MAX.panneaux, `${MAX.panneaux} panneaux au plus (${total} ici).`);
    // Les fins sont comptées chapitre par chapitre : un id par fin.
    histoire.chapitres.forEach(c => {
      const fins = c.sous_chapitres.flatMap(sc => sc.panneaux).map(p => p.ensuite).filter(e => e.type === "fin").map(e => e.id);
      exiger(new Set(fins).size === fins.length, `${c.titre} : deux fins ont le même identifiant.`);
    });
    return { histoire };
  } catch (erreur) {
    if (erreur instanceof ErreurFormat) return { erreur: erreur.message };
    throw erreur;
  }
}

// Ce qui manque encore pour qu'un joueur puisse lire l'histoire jusqu'au bout.
function avertissementsVn(histoire) {
  const avertissements = [];
  histoire.chapitres.forEach(chapitre => {
    const liste = chapitre.sous_chapitres.flatMap(sc => sc.panneaux.map((panneau, n) => ({ panneau, lieu: `${chapitre.titre}, ${sc.titre}, panneau ${n + 1}` })));
    const index = new Map(liste.map((e, i) => [e.panneau.id, { ...e, suivant: liste[i + 1]?.panneau.id ?? null }]));
    const cibles = id => {
      const { panneau, suivant } = index.get(id);
      const { ensuite } = panneau;
      if (ensuite.type === "fin") return [];
      if (ensuite.type === "choix") return ensuite.options.map(o => o.vers).filter(v => index.has(v));
      const cible = ensuite.vers || suivant;
      return index.has(cible) ? [cible] : [];
    };
    liste.forEach(({ panneau, lieu }) => {
      const { ensuite } = panneau;
      if (ensuite.type === "choix") {
        if (!ensuite.options.length) avertissements.push(`${lieu} : choix sans réponse.`);
        ensuite.options.forEach((o, i) => {
          if (!o.texte.trim()) avertissements.push(`${lieu} : réponse ${i + 1} sans texte.`);
          if (!index.has(o.vers)) avertissements.push(`${lieu} : réponse ${i + 1} sans destination.`);
        });
      } else if (ensuite.type === "suite" && !index.has(ensuite.vers || index.get(panneau.id).suivant)) {
        avertissements.push(`${lieu} : pas de suite.`);
      }
    });
    if (!liste.some(e => e.panneau.ensuite.type === "fin")) avertissements.push(`${chapitre.titre} : aucune fin, le chapitre ne peut pas être terminé.`);
    // Panneaux qu'aucun chemin n'atteint depuis le début du chapitre.
    const vus = new Set();
    const pile = [liste[0].panneau.id];
    while (pile.length) {
      const id = pile.pop();
      if (vus.has(id)) continue;
      vus.add(id);
      pile.push(...cibles(id));
    }
    liste.filter(e => !vus.has(e.panneau.id)).forEach(e => avertissements.push(`${e.lieu} : jamais atteint.`));
  });
  return avertissements;
}

module.exports = { lireHistoireVn, avertissementsVn };
