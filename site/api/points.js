// Points des personnages (PPC) et des armes (PPW) modifiés par les
// administrateurs, stockés dans Supabase (table "points", ligne "config") et
// appliqués par-dessus DB/characters.json et DB/weapons.json partout sur le
// site (cf. commun/cartes.js côté pages, _lib/personnages.js côté serveur).
//
// Contient aussi les personnages, armes et boss ajoutés depuis la page admin
// (config.ajouts), ajoutés aux JSON de la même façon.
//
// GET  : lecture publique -> { characters: { id: [...] }, weapons: { id: [...] }, modes: {...},
//                             ajouts: { characters: [...], weapons: [...], boss: [...] } }
// POST : administrateurs uniquement (cf. _lib/admin.js) :
//   { characters, weapons, modes }   remplace les points (ajouts conservés)
//   { ajout: { genre, entree } }     ajoute un personnage / une arme / un boss
//   { suppression: { genre, id } }   supprime un ajout (jamais une entrée des JSON)
const { supabase } = require("./_lib/supabase");
const { parseCookies, verifySessionToken } = require("./_lib/session");
const { estAdmin } = require("./_lib/admin");
const { getPersonnages, getArmes, MODES_POINTS, ELEMENTS, estAjout } = require("./_lib/personnages");
const bossJSON = require("../DB/boss.json");

const TAILLE_PPC = 10; // C0..C6, niveau 95, niveau 100, théâtre
const TAILLE_PPW = 5;  // R1..R5

const GENRES = ["characters", "weapons", "boss"];
const TYPES_ARMES = ["sword", "claymore", "polearm", "bow", "catalyst"];
const CATEGORIES = ["dps", "subdps", "support"];
const RARETES = ["3", "4", "5"];
const TYPES_BOSS = ["weekly_boss"];
const NB_RESISTANCES = 7;

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
  const liste = genre === "characters" ? getPersonnages() : genre === "weapons" ? getArmes() : bossJSON;
  return liste.filter(e => !estAjout(genre, e.id));
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
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(await lireConfig());
    }

    if (req.method === "POST") {
      const user = verifySessionToken(parseCookies(req).session);
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
      } else {
        const modes = {};
        Object.keys(MODES_POINTS).forEach(cle => {
          modes[cle] = corps.modes?.[cle] === "multiplication" ? "multiplication" : "addition";
        });
        const ids = genre => new Set([...listeJSON(genre), ...ajouts[genre]].map(e => e.id));
        config = {
          characters: nettoyer(corps.characters, ids("characters"), TAILLE_PPC),
          weapons: nettoyer(corps.weapons, ids("weapons"), TAILLE_PPW),
          modes,
          ajouts
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
