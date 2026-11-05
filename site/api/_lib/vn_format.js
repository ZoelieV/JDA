// Validation d'une histoire de visual novel envoyée par l'éditeur (format :
// cf. visual_novel.js). Ce qui rendrait l'histoire illisible est refusé ; ce
// qui n'est pas encore écrit (panneau sans suite, choix sans destination) est
// accepté et signalé par des avertissements, pour pouvoir enregistrer en cours
// de route. Seuls les champs connus sont gardés.
const { lirePoliceVn } = require("../../commun/vn_polices.js");

const MAX = {
  chapitres: 50, sousChapitres: 60, panneaux: 3000, persos: 12, options: 8, texte: 2000, nom: 60, titre: 80, option: 300,
  effets: 8, resultats: 10, reponses: 10, valeurs: 20, valeur: 100, message: 500, consigne: 200,
  objets: 200, etats: 100, sons: 200, description: 300, limiteObjet: 999, valeurEtat: 20, dureeTimer: 3600
};

const ID = /^[a-z0-9_-]{1,40}$/;
// Images du site, ou importées (vn/...) ; jamais d'adresse externe.
const IMAGE = /^(?:bg_web|characters|namecards|vn)\/(?:[^/\\?#"<>]+\/)*[^/\\?#"<>]+\.(?:webp|png|jpg)$/;

// Sons importés seulement (cf. vn_edition.js).
const SON = /^vn\/[a-f0-9]{24}\.(?:mp3|ogg)$/;
const estSon = valeur => typeof valeur === "string" && SON.test(valeur);
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

const liste = valeur => (Array.isArray(valeur) ? valeur : []);
const lireVers = valeur => (typeof valeur === "string" && valeur ? valeur : null);
const entier = (valeur, min, max, defaut) => {
  const n = Number(valeur);
  return Number.isFinite(n) ? Math.trunc(Math.min(max, Math.max(min, n))) : defaut;
};

// Effets : les objets et états inconnus sont signalés par avertissementsVn.
function lireEffets(brut, lieu) {
  const effets = liste(brut);
  exiger(effets.length <= MAX.effets, `${lieu} : ${MAX.effets} effets au plus.`);
  return effets.map(effet => {
    exiger(ID.test(effet?.id), `${lieu} : effet invalide.`);
    if (effet.genre === "objet") return { genre: "objet", id: effet.id, quantite: entier(effet.quantite, -MAX.limiteObjet, MAX.limiteObjet, 1) };
    exiger(effet.genre === "etat", `${lieu} : effet invalide.`);
    return { genre: "etat", id: effet.id, actif: effet.actif !== false };
  });
}

const lireConsequence = (brut, lieu) => ({
  vers: lireVers(brut?.vers),
  effets: lireEffets(brut?.effets, lieu),
  message: texteDe(brut?.message, MAX.message)
});

const borneDe = valeur => (valeur == null || valeur === "" ? null : entier(valeur, -100, 200, null));

function lireDe(brut, lieu) {
  const resultats = liste(brut?.resultats);
  exiger(resultats.length <= MAX.resultats, `${lieu} : ${MAX.resultats} résultats de dé au plus.`);
  return { resultats: resultats.map(r => ({ min: borneDe(r?.min), max: borneDe(r?.max), ...lireConsequence(r, lieu) })) };
}

function lireOption(brut, lieu, idsOption) {
  exiger(ID.test(brut?.id) && !idsOption.has(brut.id), `${lieu} : réponse invalide.`);
  idsOption.add(brut.id);
  exiger(brut.objet == null || brut.objet === "" || ID.test(brut.objet), `${lieu} : objet requis invalide.`);
  exiger(brut.etat == null || brut.etat === "" || ID.test(brut.etat), `${lieu} : condition d'état invalide.`);
  return {
    id: brut.id,
    texte: texteDe(brut.texte, MAX.option),
    ...lireConsequence(brut, lieu),
    objet: brut.objet || null,
    consomme: brut.consomme === true,
    etat: brut.etat || null,
    sans_etat: !!brut.etat && brut.sans_etat === true,
    ...(brut.de ? { de: lireDe(brut.de, lieu) } : {})
  };
}

function lireTexteLibre(brut, lieu, idsOption) {
  const reponses = liste(brut.reponses);
  exiger(reponses.length <= MAX.reponses, `${lieu} : ${MAX.reponses} réponses attendues au plus.`);
  return {
    type: "texte",
    consigne: texteDe(brut.consigne, MAX.consigne),
    reponses: reponses.map(reponse => {
      exiger(ID.test(reponse?.id) && !idsOption.has(reponse.id), `${lieu} : réponse invalide.`);
      idsOption.add(reponse.id);
      const valeurs = liste(reponse.valeurs);
      exiger(valeurs.length <= MAX.valeurs, `${lieu} : ${MAX.valeurs} écritures par réponse au plus.`);
      return {
        id: reponse.id,
        valeurs: valeurs.map(v => texteDe(v, MAX.valeur).trim()).filter(Boolean),
        exact: reponse.exact === true,
        ...lireConsequence(reponse, lieu)
      };
    }),
    defaut: lireConsequence(brut.defaut, lieu)
  };
}

function lireEnsuite(brut, lieu, idsOption) {
  if (brut?.type === "fin" || brut?.type === "game_over") {
    exiger(ID.test(brut.id), `${lieu} : fin invalide.`);
    const commun = { type: brut.type, id: brut.id, nom: texteDe(brut.nom, MAX.nom).trim() || (brut.type === "fin" ? "Fin" : "Game over") };
    return brut.type === "fin" ? commun : { ...commun, est_fin: brut.est_fin === true, message: texteDe(brut.message, MAX.message).trim() };
  }
  if (brut?.type === "choix") {
    const options = liste(brut.options);
    exiger(options.length <= MAX.options, `${lieu} : ${MAX.options} réponses au plus.`);
    return { type: "choix", options: options.map(option => lireOption(option, lieu, idsOption)) };
  }
  if (brut?.type === "texte") return lireTexteLibre(brut, lieu, idsOption);
  return typeof brut?.vers === "string" && brut.vers ? { type: "suite", vers: brut.vers } : { type: "suite" };
}

function lireSon(valeur, erreur) {
  if (valeur == null || valeur === "") return null;
  exiger(estSon(valeur), erreur);
  return valeur;
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
    effets: lireEffets(brut.effets, lieu),
    sauvegarde: brut.sauvegarde === true,
    timer: brut.timer ? { duree: entier(brut.timer.duree, 1, MAX.dureeTimer, 30), ...lireConsequence(brut.timer, lieu) } : null,
    musique: brut.musique === "stop" ? "stop" : lireSon(brut.musique, `${lieu} : musique invalide.`),
    son: lireSon(brut.son, `${lieu} : son invalide.`),
    ensuite: lireEnsuite(brut.ensuite, lieu, new Set())
  };
}

// Objets, états et sons de l'histoire.
function lireObjets(brut) {
  const objets = liste(brut);
  exiger(objets.length <= MAX.objets, `${MAX.objets} objets au plus.`);
  const ids = new Set();
  return objets.map((objet, i) => {
    exiger(ID.test(objet?.id) && !ids.has(objet.id), `Objet ${i + 1} : identifiant invalide.`);
    ids.add(objet.id);
    exiger(objet.image == null || objet.image === "" || estImage(objet.image), `Objet ${i + 1} : image invalide.`);
    return {
      id: objet.id,
      nom: texteDe(objet.nom, MAX.nom).trim() || "Objet",
      description: texteDe(objet.description, MAX.description),
      image: objet.image || null,
      limite: entier(objet.limite, 1, MAX.limiteObjet, 1)
    };
  });
}

function lireEtats(brut) {
  const etats = liste(brut);
  exiger(etats.length <= MAX.etats, `${MAX.etats} états au plus.`);
  const ids = new Set();
  return etats.map((etat, i) => {
    exiger(ID.test(etat?.id) && !ids.has(etat.id), `État ${i + 1} : identifiant invalide.`);
    ids.add(etat.id);
    return {
      id: etat.id,
      nom: texteDe(etat.nom, MAX.nom).trim() || "État",
      description: texteDe(etat.description, MAX.description),
      valeur: entier(etat.valeur, -MAX.valeurEtat, MAX.valeurEtat, 0),
      fin_chapitre: etat.fin_chapitre === true
    };
  });
}

function lireSons(brut) {
  const sons = liste(brut);
  exiger(sons.length <= MAX.sons, `${MAX.sons} sons au plus.`);
  return sons.filter(son => estSon(son?.chemin)).map(son => ({ chemin: son.chemin, nom: texteDe(son.nom, MAX.nom).trim() || "Son" }));
}

// Date de sortie d'un chapitre : ISO, ou null pour "dès qu'il est public".
function lireSortie(valeur, titre) {
  if (valeur == null || valeur === "") return null;
  const date = typeof valeur === "string" && valeur.length <= 40 ? new Date(valeur) : null;
  exiger(date && Number.isFinite(date.getTime()), `${titre} : date de sortie invalide.`);
  return date.toISOString();
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
  return { id: brut.id, titre, namecard: brut.namecard || null, public: brut.public === true, sortie: lireSortie(brut.sortie, titre), sous_chapitres: sousChapitres };
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
      public: brut.public === true,
      objets: lireObjets(brut.objets),
      etats: lireEtats(brut.etats),
      sons: lireSons(brut.sons),
      chapitres: chapitres.map((c, i) => lireChapitre(c, i + 1, idsVus))
    };
    const total = histoire.chapitres.flatMap(c => c.sous_chapitres).flatMap(sc => sc.panneaux).length;
    exiger(total <= MAX.panneaux, `${MAX.panneaux} panneaux au plus (${total} ici).`);
    // Les fins sont comptées chapitre par chapitre : un id par fin.
    histoire.chapitres.forEach(c => {
      const fins = c.sous_chapitres.flatMap(sc => sc.panneaux).map(p => p.ensuite).filter(e => e.type === "fin" || e.type === "game_over").map(e => e.id);
      exiger(new Set(fins).size === fins.length, `${c.titre} : deux fins ont le même identifiant.`);
    });
    return { histoire };
  } catch (erreur) {
    if (erreur instanceof ErreurFormat) return { erreur: erreur.message };
    throw erreur;
  }
}

// Scores de dé que le joueur peut obtenir, selon les états de l'histoire, et
// plages qui en laissent un sans résultat.
function scoresSansResultat(histoire, de) {
  const valeurs = histoire.etats.map(e => e.valeur);
  const min = 1 + valeurs.filter(v => v < 0).reduce((a, b) => a + b, 0);
  const max = 20 + valeurs.filter(v => v > 0).reduce((a, b) => a + b, 0);
  const manquants = [];
  for (let score = min; score <= max; score++) {
    if (!de.resultats.some(r => (r.min == null || score >= r.min) && (r.max == null || score <= r.max))) manquants.push(score);
  }
  return manquants;
}

// Toutes les suites possibles d'un panneau : [{ vers, effets, nom }].
function consequencesDe({ ensuite, timer }) {
  const consequences = [];
  if (timer) consequences.push({ ...timer, nom: "timer", facultative: true });
  if (ensuite.type === "choix") {
    ensuite.options.forEach((o, i) => {
      if (o.de) o.de.resultats.forEach((r, n) => consequences.push({ ...r, nom: `réponse ${i + 1}, résultat de dé ${n + 1}` }));
      else consequences.push({ ...o, nom: `réponse ${i + 1}` });
    });
  } else if (ensuite.type === "texte") {
    ensuite.reponses.forEach((r, i) => consequences.push({ ...r, nom: `réponse attendue ${i + 1}` }));
    consequences.push({ ...ensuite.defaut, nom: "mauvaise réponse", facultative: true });
  }
  return consequences;
}

// Ce qui manque encore pour qu'un joueur puisse lire l'histoire jusqu'au bout.
function avertissementsVn(histoire) {
  const avertissements = [];
  if (histoire.public && !histoire.chapitres.some(c => c.public)) avertissements.push("L'event est visible par tout le monde, mais aucun chapitre ne l'est : les joueurs ne verront rien.");
  const objets = new Set(histoire.objets.map(o => o.id));
  const etats = new Set(histoire.etats.map(e => e.id));
  const effetsConnus = (effets, lieu) => effets.forEach(effet => {
    if (!(effet.genre === "objet" ? objets : etats).has(effet.id)) avertissements.push(`${lieu} : effet sur ${effet.genre === "objet" ? "un objet" : "un état"} supprimé.`);
  });
  histoire.chapitres.forEach(chapitre => {
    const liste = chapitre.sous_chapitres.flatMap(sc => sc.panneaux.map((panneau, n) => ({ panneau, lieu: `${chapitre.titre}, ${sc.titre}, panneau ${n + 1}` })));
    const index = new Map(liste.map((e, i) => [e.panneau.id, { ...e, suivant: liste[i + 1]?.panneau.id ?? null }]));
    const cibles = id => {
      const { panneau, suivant } = index.get(id);
      const { ensuite } = panneau;
      const destinations = consequencesDe(panneau).map(c => c.vers).filter(v => index.has(v));
      if (ensuite.type === "suite") {
        const cible = ensuite.vers || suivant;
        if (index.has(cible)) destinations.push(cible);
      }
      return destinations;
    };
    liste.forEach(({ panneau, lieu }) => {
      const { ensuite } = panneau;
      effetsConnus(panneau.effets, lieu);
      consequencesDe(panneau).forEach(c => {
        effetsConnus(c.effets, `${lieu}, ${c.nom}`);
        if (!c.facultative && !index.has(c.vers)) avertissements.push(`${lieu} : ${c.nom} sans destination.`);
      });
      if (ensuite.type === "choix") {
        if (!ensuite.options.length) avertissements.push(`${lieu} : choix sans réponse.`);
        if (ensuite.options.length && ensuite.options.every(o => o.objet || o.etat)) avertissements.push(`${lieu} : toutes les réponses ont une condition (objet ou état), le joueur peut rester bloqué.`);
        ensuite.options.forEach((o, i) => {
          if (!o.texte.trim()) avertissements.push(`${lieu} : réponse ${i + 1} sans texte.`);
          if (o.objet && !objets.has(o.objet)) avertissements.push(`${lieu} : réponse ${i + 1} demande un objet supprimé.`);
          if (o.etat && !etats.has(o.etat)) avertissements.push(`${lieu} : réponse ${i + 1} dépend d'un état supprimé.`);
          if (o.de) {
            const manquants = scoresSansResultat(histoire, o.de);
            if (manquants.length) avertissements.push(`${lieu} : réponse ${i + 1}, aucun résultat pour le score ${manquants[0]}${manquants.length > 1 ? ` et ${manquants.length - 1} autre(s)` : ""}.`);
          }
        });
      } else if (ensuite.type === "texte") {
        if (!ensuite.reponses.length) avertissements.push(`${lieu} : texte libre sans réponse attendue.`);
        ensuite.reponses.forEach((r, i) => {
          if (!r.valeurs.length) avertissements.push(`${lieu} : réponse attendue ${i + 1} sans texte.`);
        });
      } else if (ensuite.type === "suite" && !index.has(ensuite.vers || index.get(panneau.id).suivant)) {
        avertissements.push(`${lieu} : pas de suite.`);
      }
    });
    if (!liste.some(e => e.panneau.ensuite.type === "fin" || e.panneau.ensuite.est_fin)) avertissements.push(`${chapitre.titre} : aucune fin, le chapitre ne peut pas être terminé.`);
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
