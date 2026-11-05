// Règles du visual novel sans accès à la base : état d'une partie (inventaire,
// états, timer, dés), effets, lancers et comparaison du texte libre.
//
// État d'une partie (colonne vn_parties.jeu) :
//   inventaire: { id d'objet: quantité }, etats: [id d'état], musique: chemin ou null,
//   point: { panneau, inventaire, etats, musique }       dernier point de sauvegarde
//   instantanes: { id de sous-chapitre: état à son entrée, pour le refaire }
//   timer: { fin (ms), panneau (celui qui l'a lancé) } ou null
//   des: { "panneau:option": { base, sc } }  dés déjà lancés, gardés tant que leur
//     sous-chapitre n'est pas fini : revenir dessus redonne le même résultat
//   lancer: dernier lancer, réaffiché si la page est rechargée
//   sortie: { inventaire, etats } de la dernière partie terminée, pour le
//     chapitre suivant
//   essais: { debut (ms), nombre } réponses en texte libre de la dernière minute
const crypto = require("crypto");

const LONGUEUR_REPONSE = 100;
// Pour ne pas pouvoir essayer toutes les réponses à la chaîne.
const ESSAIS_PAR_MINUTE = 10;

function lireJeu(brut) {
  return {
    inventaire: brut?.inventaire || {},
    etats: brut?.etats || [],
    musique: brut?.musique || null,
    point: brut?.point || null,
    instantanes: brut?.instantanes || {},
    timer: brut?.timer || null,
    des: brut?.des || {},
    lancer: brut?.lancer || null,
    sortie: brut?.sortie || null,
    essais: brut?.essais || null
  };
}

// L'état qu'un retour en arrière remet en place.
const instantane = jeu => ({ inventaire: { ...jeu.inventaire }, etats: [...jeu.etats], musique: jeu.musique });

function restaurer(jeu, copie) {
  jeu.inventaire = { ...copie.inventaire };
  jeu.etats = [...copie.etats];
  jeu.musique = copie.musique || null;
}

// Applique des effets sur l'état et renvoie ce qu'il faut annoncer au joueur.
// Objets et états retirés de l'histoire depuis : ignorés.
function appliquerEffets(histoire, jeu, effets) {
  const annonces = [];
  (effets || []).forEach(effet => {
    if (effet.genre === "objet") {
      const objet = (histoire.objets || []).find(o => o.id === effet.id);
      if (!objet) return;
      const avant = jeu.inventaire[objet.id] || 0;
      const apres = Math.max(0, Math.min(objet.limite || Infinity, avant + effet.quantite));
      if (apres === avant) return;
      if (apres) jeu.inventaire[objet.id] = apres;
      else delete jeu.inventaire[objet.id];
      annonces.push(`${apres > avant ? "+" : "−"}${Math.abs(apres - avant)} ${objet.nom}`);
    } else if (effet.genre === "etat") {
      const etat = (histoire.etats || []).find(e => e.id === effet.id);
      if (!etat || jeu.etats.includes(etat.id) === effet.actif) return;
      jeu.etats = effet.actif ? [...jeu.etats, etat.id] : jeu.etats.filter(id => id !== etat.id);
      annonces.push(effet.actif ? `${etat.nom} (${signe(etat.valeur)} aux dés)` : `${etat.nom} : terminé`);
    }
  });
  return annonces;
}

const signe = valeur => (valeur >= 0 ? `+${valeur}` : `−${Math.abs(valeur)}`);

// Ce que le joueur voit de son état : seulement ce qu'il possède.
function jeuPublic(histoire, jeu) {
  return {
    inventaire: (histoire.objets || [])
      .filter(o => jeu.inventaire[o.id])
      .map(o => ({ nom: o.nom, description: o.description || "", image: o.image || null, quantite: jeu.inventaire[o.id] })),
    etats: (histoire.etats || [])
      .filter(e => jeu.etats.includes(e.id))
      .map(e => ({ nom: e.nom, valeur: e.valeur, description: e.description || "" }))
  };
}

// État transmis au chapitre suivant : les états cochés "fin du chapitre" s'arrêtent là.
function sortieDe(histoire, jeu) {
  const limites = new Set((histoire.etats || []).filter(e => e.fin_chapitre).map(e => e.id));
  return { inventaire: { ...jeu.inventaire }, etats: jeu.etats.filter(id => !limites.has(id)) };
}

// ---- Dés ----
// Score final : le dé (1 à 20) et les états actifs. Plages ouvertes si min ou
// max est absent (« 20 et plus », « 5 et moins »).
function lancerDe(histoire, jeu, de, cle, scFini, scId) {
  const garde = jeu.des[cle];
  const base = !scFini && garde ? garde.base : crypto.randomInt(1, 21);
  const modificateurs = (histoire.etats || [])
    .filter(e => jeu.etats.includes(e.id) && e.valeur)
    .map(e => ({ nom: e.nom, valeur: e.valeur }));
  const total = modificateurs.reduce((somme, m) => somme + m.valeur, base);
  const resultat = de.resultats.find(r => (r.min == null || total >= r.min) && (r.max == null || total <= r.max)) || null;
  return { base, modificateurs, total, resultat, garder: scFini ? null : { base, sc: scId } };
}

// ---- Texte libre ----
// Compte un essai. false : trop d'essais dans la dernière minute.
function compterEssai(jeu, maintenant) {
  if (!jeu.essais || maintenant - jeu.essais.debut >= 60000) jeu.essais = { debut: maintenant, nombre: 0 };
  if (jeu.essais.nombre >= ESSAIS_PAR_MINUTE) return false;
  jeu.essais.nombre++;
  return true;
}

// Sans accents, sans casse, sans ponctuation.
function normaliserTexte(texte) {
  return String(texte ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Lettres à changer, ajouter, retirer ou intervertir pour passer de a à b.
function distanceTexte(a, b) {
  const lignes = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    lignes[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      lignes[i][j] = Math.min(lignes[i - 1][j] + 1, lignes[i][j - 1] + 1, lignes[i - 1][j - 1] + cout);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) lignes[i][j] = Math.min(lignes[i][j], lignes[i - 2][j - 2] + 1);
    }
  }
  return lignes[a.length][b.length];
}

// Fautes tolérées : aucune sur les mots très courts, où une lettre change tout.
const fautesTolerees = longueur => (longueur <= 3 ? 0 : longueur <= 7 ? 1 : 2);

// Réponse qui correspond à la saisie, ou null. L'écriture stricte passe avant
// tout le reste, puis l'égalité sans accents ni casse, puis la plus proche.
// Une réponse "exact" n'accepte que son écriture stricte.
function trouverReponse(reponses, saisie) {
  const stricte = String(saisie ?? "").normalize("NFC").trim();
  const normale = normaliserTexte(saisie);
  const valeurs = reponses.flatMap(reponse => reponse.valeurs.map(valeur => ({ reponse, valeur })));
  const egale = valeurs.find(({ valeur }) => valeur.normalize("NFC").trim() === stricte);
  if (egale) return egale.reponse;
  if (!normale) return null;
  const souples = valeurs
    .filter(({ reponse }) => !reponse.exact)
    .map(({ reponse, valeur }) => ({ reponse, normale: normaliserTexte(valeur) }))
    .filter(v => v.normale);
  let meilleure = null;
  let ecart = Infinity;
  for (const valeur of souples) {
    const distance = distanceTexte(normale, valeur.normale);
    if (distance < ecart && distance <= fautesTolerees(valeur.normale.length)) {
      meilleure = valeur.reponse;
      ecart = distance;
    }
  }
  return meilleure;
}

module.exports = { LONGUEUR_REPONSE, lireJeu, instantane, restaurer, appliquerEffets, jeuPublic, sortieDe, lancerDe, compterEssai, normaliserTexte, distanceTexte, trouverReponse };
