// Points des personnages (PPC) et des armes (PPW) modifiés par les
// administrateurs, stockés dans Supabase (table "points", ligne "config") et
// appliqués par-dessus DB/characters.json et DB/weapons.json partout sur le
// site (cf. commun/cartes.js côté pages, _lib/personnages.js côté serveur).
//
// GET  : lecture publique -> { characters: { id: [...] }, weapons: { id: [...] }, modes: {...} }
// POST : administrateurs uniquement (cf. _lib/admin.js), remplace la config.
const { supabase } = require("./_lib/supabase");
const { parseCookies, verifySessionToken } = require("./_lib/session");
const { estAdmin } = require("./_lib/admin");
const { getPersonnages, getArmes, MODES_POINTS } = require("./_lib/personnages");

const TAILLE_PPC = 10; // C0..C6, niveau 95, niveau 100, théâtre
const TAILLE_PPW = 5;  // R1..R5

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
      const modes = {};
      Object.keys(MODES_POINTS).forEach(cle => {
        modes[cle] = corps.modes?.[cle] === "multiplication" ? "multiplication" : "addition";
      });
      const config = {
        characters: nettoyer(corps.characters, new Set(getPersonnages().map(p => p.id)), TAILLE_PPC),
        weapons: nettoyer(corps.weapons, new Set(getArmes().map(a => a.id)), TAILLE_PPW),
        modes
      };

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
