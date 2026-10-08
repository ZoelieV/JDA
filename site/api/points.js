// Points des personnages (PPC) et des armes (PPW) modifiés par les
// administrateurs, stockés dans Supabase (table "points", ligne "config") et
// appliqués par-dessus DB/characters.json et DB/weapons.json partout sur le
// site (cf. commun/cartes.js côté pages, _lib/personnages.js côté serveur).
//
// Contient aussi les personnages, armes et boss ajoutés depuis la page admin
// (config.ajouts), ajoutés aux JSON de la même façon.
//
// Personnages et armes masqués (config.masques : pas encore sortis dans le
// jeu) : retirés de partout sauf de la page admin. Boss : nom et résistances
// modifiables (config.boss). Armes : catégories (support, standard)
// modifiables (config.categoriesArmes).
//
// GET  : { characters: { id: [...] }, weapons: { id: [...] }, modes: {...},
//          ajouts: { characters: [...], weapons: [...], boss: [...] },
//          masques: { characters: [id...], weapons: [id...] },
//          boss: { id: { nom, res } }, categoriesArmes: { id: [...] },
//          theatre: [id...],    (personnages buffés par le théâtre du mois)
//          bonus_saison: [id...],  (bonus de saison : trophées en classé)
//          carnage_desactive: bool }  (boss du carnage plus disponibles)
//        Hors administrateurs : ajouts masqués et leurs données retirés.
// POST : administrateurs uniquement (cf. _lib/admin.js) :
//   { characters, weapons, modes, masques, theatre, bonus_saison }  remplace
//                                    les points, les masqués, les buffs
//                                    théâtre et le bonus de saison
//   { ajout: { genre, entree } }     ajoute un personnage / une arme (masqué) / un boss
//   { suppression: { genre, id } }   supprime un ajout (jamais une entrée des JSON)
//   { boss: { id: { nom, res } } }   modifie des boss
//   { categoriesArmes: { id: [...] } }  modifie les catégories d'armes
//   { carnage_desactive: true|false }   désactive / réactive les boss du
//                                    carnage (hors entraînement, cf. _lib/boss.js)
const { supabase } = require("./_lib/supabase");
const { parseCookies, verifySessionToken } = require("./_lib/session");
const { estAdmin, estModerateur } = require("./_lib/admin");
const { SEUIL_EQUILIBRAGE } = require("./_lib/draft");
const { getCatalogueComplet, MODES_POINTS, ELEMENTS, estAjout } = require("./_lib/personnages");

const TAILLE_PPC = 10; // C0..C6, niveau 95, niveau 100, théâtre
const TAILLE_PPW = 5;  // R1..R5

const GENRES = ["characters", "weapons", "boss"];
const TYPES_ARMES = ["sword", "claymore", "polearm", "bow", "catalyst"];
const CATEGORIES = ["dps", "subdps", "support"];
const RARETES = ["3", "4", "5"];
// Types de boss (libellés : TYPES_BOSS de admin_ppc/admin_ajout.js).
// Légendes locales : une fois par jour (reset quotidien) ou à l'infini.
const TYPES_BOSS = ["weekly_boss", "legende_locale_jour", "legende_locale_infinie", "world_boss", "carnage_boss"];
const NB_RESISTANCES = 7;
const CATEGORIES_ARMES = ["support", "standard"];

// Catégories connues, sans doublon, dans l'ordre de CATEGORIES_ARMES ; null
// si ce n'est pas une liste.
function validerCategoriesArme(brut) {
  return Array.isArray(brut) ? CATEGORIES_ARMES.filter(c => brut.includes(c)) : null;
}

function texte(valeur, max = 80) {
  const propre = typeof valeur === "string" ? valeur.trim() : "";
  return propre && propre.length <= max ? propre : null;
}

function choix(valeur, possibles) {
  return possibles.includes(String(valeur)) ? String(valeur) : null;
}

// Entrée au format des JSON de DB/, ou message d'erreur.
function validerEntree(genre, brut = {}) {
  const id = typeof brut.id === "string" && /^[a-z0-9_]{1,40}$/.test(brut.id) ? brut.id : null;
  const nom = texte(brut.nom);
  if (!id) return { erreur: "Id invalide (minuscules, chiffres et _ uniquement)" };
  if (!nom) return { erreur: "Nom manquant" };

  if (genre === "characters") {
    const entree = {
      id,
      ...(brut.standard === true ? { standard: true } : {}),
      nom,
      rarete: choix(brut.rarete, RARETES),
      element: choix(brut.element, ELEMENTS),
      arme: choix(brut.arme, TYPES_ARMES),
      categorie: choix(brut.categorie, CATEGORIES),
      image: `images/characters/${id}.webp`,
      PPC: Array(TAILLE_PPC).fill(0)
    };
    if (!entree.rarete || !entree.element || !entree.arme || !entree.categorie) return { erreur: "Rareté, élément, arme ou catégorie invalide" };
    return { entree };
  }

  if (genre === "weapons") {
    const entree = {
      id,
      nom,
      element: choix(brut.element, [...ELEMENTS, "all"]),
      type: choix(brut.type, TYPES_ARMES),
      image: `images/weapons/${id}.webp`,
      rarete: choix(brut.rarete, RARETES),
      categories: validerCategoriesArme(brut.categories) || [],
      PPW: Array(TAILLE_PPW).fill(0)
    };
    if (!entree.element || !entree.type || !entree.rarete) return { erreur: "Élément, type ou rareté invalide" };
    return { entree };
  }

  const res = Array.from({ length: NB_RESISTANCES }, (_, i) => Number(brut.res?.[i] ?? 0));
  const entree = {
    id,
    nom,
    type: choix(brut.type, TYPES_BOSS),
    res,
    image: `images/boss/${id}.webp`
  };
  if (!entree.type) return { erreur: "Type de boss invalide" };
  if (res.some(n => !Number.isFinite(n))) return { erreur: "Résistances invalides" };
  return { entree };
}

// Entrées des JSON de DB/ seulement (les listes du serveur contiennent aussi
// les ajouts déjà fusionnés, cf. _lib/personnages.js).
function listeJSON(genre) {
  return getCatalogueComplet(genre).filter(e => !estAjout(genre, e.id));
}

const GENRES_MASQUABLES = ["characters", "weapons"];

function lireMasques(config) {
  return Object.fromEntries(GENRES_MASQUABLES.map(genre => [
    genre,
    Array.isArray(config.masques?.[genre]) ? config.masques[genre] : []
  ]));
}

// Ids connus seulement, sans doublon, triés (masqués, buffs théâtre).
function nettoyerMasques(masques, ids) {
  return Array.from(new Set((Array.isArray(masques) ? masques : []).filter(id => ids.has(id)))).sort();
}

// Nom et 7 résistances d'un boss, ou null.
function validerModifBoss(brut = {}) {
  const nom = texte(brut.nom);
  const res = Array.from({ length: NB_RESISTANCES }, (_, i) => Number(brut.res?.[i] ?? 0));
  return nom && res.every(Number.isFinite) ? { nom, res } : null;
}

// Réponse du GET hors administrateurs : les ajouts masqués (absents des JSON
// publics de DB/) et leurs points ne sont pas envoyés du tout.
function versionPublique(config) {
  const masques = lireMasques(config);
  const ajouts = lireAjouts(config);
  const publique = { ...config, ajouts: { ...ajouts }, masques: {} };
  GENRES_MASQUABLES.forEach(genre => {
    const caches = new Set(masques[genre]);
    const idsAjouts = new Set(ajouts[genre].map(e => e.id));
    publique.ajouts[genre] = ajouts[genre].filter(e => !caches.has(e.id));
    publique.masques[genre] = masques[genre].filter(id => !idsAjouts.has(id));
    if (config[genre]) {
      publique[genre] = { ...config[genre] };
      caches.forEach(id => { delete publique[genre][id]; });
    }
    if (genre === "characters" && Array.isArray(config.theatre)) {
      publique.theatre = config.theatre.filter(id => !caches.has(id));
    }
    if (genre === "characters" && Array.isArray(config.bonus_saison)) {
      publique.bonus_saison = config.bonus_saison.filter(id => !caches.has(id));
    }
    if (genre === "weapons" && config.categoriesArmes) {
      publique.categoriesArmes = { ...config.categoriesArmes };
      caches.forEach(id => { delete publique.categoriesArmes[id]; });
    }
  });
  return publique;
}

function ajoutsVides() {
  return { characters: [], weapons: [], boss: [] };
}

function lireAjouts(config) {
  const ajouts = ajoutsVides();
  GENRES.forEach(genre => {
    if (Array.isArray(config.ajouts?.[genre])) ajouts[genre] = config.ajouts[genre];
  });
  return ajouts;
}

async function lireConfig() {
  const { data, error } = await supabase.from("points").select("data").eq("id", "config").maybeSingle();
  if (error) throw error;
  return data?.data || {};
}

// Garde seulement des nombres, pour des ids connus, à la bonne taille.
function nettoyer(valeurs, ids, taille) {
  const propre = {};
  Object.entries(valeurs || {}).forEach(([id, liste]) => {
    if (!ids.has(id) || !Array.isArray(liste)) return;
    propre[id] = Array.from({ length: taille }, (_, i) => {
      const n = Number(liste[i]);
      return Number.isFinite(n) ? n : 0;
    });
  });
  return propre;
}

module.exports = async (req, res) => {
  try {
    const user = await verifySessionToken(parseCookies(req).session);

    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      const config = await lireConfig();
      // Mini admins : tout voir (page Administration en lecture seule), rien modifier.
      // seuil_equilibrage : points d'écart par ban d'équilibrage (page Theorycraft).
      const donnees = user && await estModerateur(user.id) ? config : versionPublique(config);
      return res.status(200).json({ ...donnees, seuil_equilibrage: SEUIL_EQUILIBRAGE });
    }

    if (req.method === "POST") {
      if (!user) return res.status(401).json({ error: "Non connecté" });
      if (!estAdmin(user.id)) return res.status(403).json({ error: "Réservé aux administrateurs" });

      const corps = req.body || {};
      const ancienne = await lireConfig();
      const ajouts = lireAjouts(ancienne);
      let config;

      if (corps.ajout) {
        const genre = corps.ajout.genre;
        if (!GENRES.includes(genre)) return res.status(400).json({ error: "Genre inconnu" });
        const { entree, erreur } = validerEntree(genre, corps.ajout.entree);
        if (erreur) return res.status(400).json({ error: erreur });
        // Id libre dans le JSON et parmi les ajouts.
        // Personnages : pas non plus l'id d'un groupe (ex. "traveler", id de la draft).
        const pris = e => e.id === entree.id || (genre === "characters" && e.groupe === entree.id);
        if (listeJSON(genre).some(pris) || ajouts[genre].some(pris)) {
          return res.status(409).json({ error: `L'id "${entree.id}" existe déjà` });
        }
        ajouts[genre] = [...ajouts[genre], entree];
        config = { ...ancienne, ajouts };
        // Personnage / arme pas encore sorti : masqué jusqu'à ce qu'un admin
        // l'affiche.
        if (GENRES_MASQUABLES.includes(genre)) {
          const masques = lireMasques(ancienne);
          config.masques = { ...masques, [genre]: [...masques[genre], entree.id].sort() };
        }
      } else if (corps.suppression) {
        const { genre, id } = corps.suppression;
        if (!GENRES.includes(genre)) return res.status(400).json({ error: "Genre inconnu" });
        if (!ajouts[genre].some(e => e.id === id)) return res.status(404).json({ error: "Ajout introuvable" });
        ajouts[genre] = ajouts[genre].filter(e => e.id !== id);
        config = { ...ancienne, ajouts };
        if (genre !== "boss" && config[genre]) {
          config[genre] = { ...config[genre] };
          delete config[genre][id];
        }
        if (GENRES_MASQUABLES.includes(genre)) {
          const masques = lireMasques(ancienne);
          config.masques = { ...masques, [genre]: masques[genre].filter(m => m !== id) };
          if (genre === "characters" && Array.isArray(config.theatre)) {
            config.theatre = config.theatre.filter(t => t !== id);
          }
          if (genre === "characters" && Array.isArray(config.bonus_saison)) {
            config.bonus_saison = config.bonus_saison.filter(t => t !== id);
          }
          if (genre === "weapons" && config.categoriesArmes?.[id]) {
            config.categoriesArmes = { ...config.categoriesArmes };
            delete config.categoriesArmes[id];
          }
        } else if (config.boss?.[id]) {
          config.boss = { ...config.boss };
          delete config.boss[id];
        }
      } else if (corps.boss) {
        const ids = new Set([...listeJSON("boss"), ...ajouts.boss].map(e => e.id));
        const modifs = { ...(ancienne.boss || {}) };
        for (const [id, brut] of Object.entries(corps.boss)) {
          if (!ids.has(id)) return res.status(404).json({ error: `Boss "${id}" introuvable` });
          const modif = validerModifBoss(brut);
          if (!modif) return res.status(400).json({ error: `Nom ou résistances invalides (${id})` });
          modifs[id] = modif;
        }
        config = { ...ancienne, boss: modifs };
      } else if (typeof corps.carnage_desactive === "boolean") {
        config = { ...ancienne, carnage_desactive: corps.carnage_desactive };
      } else if (corps.categoriesArmes) {
        const ids = new Set([...listeJSON("weapons"), ...ajouts.weapons].map(e => e.id));
        const modifs = { ...(ancienne.categoriesArmes || {}) };
        for (const [id, brut] of Object.entries(corps.categoriesArmes)) {
          if (!ids.has(id)) return res.status(404).json({ error: `Arme "${id}" introuvable` });
          const categories = validerCategoriesArme(brut);
          if (!categories) return res.status(400).json({ error: `Catégories invalides (${id})` });
          modifs[id] = categories;
        }
        config = { ...ancienne, categoriesArmes: modifs };
      } else {
        const modes = {};
        Object.keys(MODES_POINTS).forEach(cle => {
          modes[cle] = corps.modes?.[cle] === "multiplication" ? "multiplication" : "addition";
        });
        const ids = genre => new Set([...listeJSON(genre), ...ajouts[genre]].map(e => e.id));
        const anciensMasques = lireMasques(ancienne);
        config = {
          ...ancienne,
          characters: nettoyer(corps.characters, ids("characters"), TAILLE_PPC),
          weapons: nettoyer(corps.weapons, ids("weapons"), TAILLE_PPW),
          modes,
          ajouts,
          masques: Object.fromEntries(GENRES_MASQUABLES.map(genre => [
            genre,
            nettoyerMasques(corps.masques ? corps.masques[genre] : anciensMasques[genre], ids(genre))
          ])),
          theatre: nettoyerMasques(corps.theatre ?? ancienne.theatre, ids("characters")),
          // Bonus de saison : trophées en classé (cf. _lib/trophees.js).
          bonus_saison: nettoyerMasques(corps.bonus_saison ?? ancienne.bonus_saison, ids("characters"))
        };
      }

      const { error } = await supabase.from("points").upsert({
        id: "config",
        data: config,
        updated_at: new Date().toISOString(),
        updated_by: user.id
      });
      if (error) throw error;

      return res.status(200).json(config);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur sur les points" });
  }
};
