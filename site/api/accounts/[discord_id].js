const { createClient } = require("@supabase/supabase-js");
const { parseCookies, verifySessionToken } = require("../_lib/session");
const { estModerateur } = require("../_lib/admin");
const { getPersonnages, actualiserPoints, migrerCollectionPersos, codeTheatre } = require("../_lib/personnages");
const { nettoyerProfil } = require("../auth/profile");
const {
  MAX_BOXES_FICTIVES,
  estIdFictif,
  nouvelIdFictif,
  nomFictifValide,
  lireBoxesFictives,
  ecrireBoxesFictives
} = require("../_lib/boxes_fictives");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Box opti (persos et armes) : privées. Envoyées entières à leur
// propriétaire seulement ; aux autres, uniquement une box jouée dans la
// room donnée (?room=), une fois les box révélées (après le choix des box :
// pools calculés), pour les joueurs comme pour les spectateurs.
const BOX_OPTI = ["opti1", "opti2", "opti3", "opti4", "opti5"];

// Box opti de ce joueur révélées dans cette room.
async function boxOptiRevelees(roomId, discordId) {
  if (!roomId) return [];
  const { data: room } = await supabase.from("rooms").select("draft").eq("room_id", roomId).maybeSingle();
  const draft = room?.draft;
  if (!draft || draft.phase === "choix_box") return [];

  // Entraînement : box choisies à la création (déjà révélées).
  if (draft.entrainement) {
    return Object.values(draft.entrainement.boxes || {})
      .filter(source => source?.proprietaire === discordId && BOX_OPTI.includes(source.box))
      .map(source => source.box);
  }
  return ["j1", "j2"]
    .filter(role => draft[`discord_${role}`] === discordId && Array.isArray(draft[`pool_${role}`]) && BOX_OPTI.includes(draft[`box_${role}`]))
    .map(role => draft[`box_${role}`]);
}

function masquerBoxOpti(data, visibles) {
  if (!data || typeof data !== "object") return data;
  const copie = { ...data };
  ["characters", "weapons"].forEach(vue => {
    const selections = copie[vue]?.selections;
    if (!selections || typeof selections !== "object") return;
    const filtrees = { ...selections };
    BOX_OPTI.filter(box => !visibles.includes(box)).forEach(box => { delete filtrees[box]; });
    copie[vue] = { ...copie[vue], selections: filtrees };
  });
  return copie;
}

// ---- Box fictives (cf. _lib/boxes_fictives.js) ----
// Administrateurs et mini admins seulement :
//   GET    /api/accounts/boxes_fictives          liste { id, nom, theatre, nb_persos, ... }
//   POST   /api/accounts/boxes_fictives          { nom } -> { id }
//   GET    /api/accounts/<id fictif>             comme un profil (data = la box)
//   PUT    /api/accounts/<id fictif>             { nom?, data? }
// Théâtre : palier calculé sur la full box (cf. palierTheatre,
// _lib/personnages.js), comme pour les vrais comptes.
//   DELETE /api/accounts/<id fictif>
// GET d'une box fictive aussi permis à tous avec ?room= d'un entraînement
// qui la joue (joueur qui a rejoint, spectateurs).
const LISTE_FICTIVES = "boxes_fictives";

// Personnages possédés (Voyageur compté une fois), comme Tous les comptes.
function nbPersosFictive(data) {
  const full = migrerCollectionPersos(data?.characters)?.full || {};
  return new Set(getPersonnages().filter(p => (full[p.id] ?? -1) >= 0).map(p => p.groupe || p.id)).size;
}

// Données d'une box fictive : full box seulement (persos, armes) et son
// palier de théâtre calculé (cf. nettoyerProfil).
function nettoyerDonneesFictive(brut) {
  const propre = nettoyerProfil(brut && typeof brut === "object" && !Array.isArray(brut) ? brut : {});
  return { theatre: propre.theatre, characters: propre.characters, weapons: propre.weapons };
}

async function boxJoueeDansRoom(roomId, id) {
  if (!roomId) return false;
  const { data: room } = await supabase.from("rooms").select("draft").eq("room_id", roomId).maybeSingle();
  return Object.values(room?.draft?.entrainement?.boxes || {}).some(source => source?.proprietaire === id);
}

async function gererBoxesFictives(req, res, url, cible, user) {
  const moderateur = !!user && await estModerateur(user.id);

  if (cible === LISTE_FICTIVES) {
    if (!moderateur) return res.status(403).json({ error: "Réservé aux administrateurs" });
    if (req.method === "GET") {
      const [boxes] = await Promise.all([lireBoxesFictives(), actualiserPoints()]);
      return res.status(200).json(Object.entries(boxes)
        .map(([id, box]) => ({ id, nom: box.nom, theatre: codeTheatre(box.data), nb_persos: nbPersosFictive(box.data), createur: box.createur, modifie_le: box.modifie_le }))
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" })));
    }
    if (req.method === "POST") {
      const nom = nomFictifValide(req.body?.nom);
      if (!nom) return res.status(400).json({ error: "Donne un nom à la box." });
      const boxes = await lireBoxesFictives();
      if (Object.keys(boxes).length >= MAX_BOXES_FICTIVES) {
        return res.status(409).json({ error: `${MAX_BOXES_FICTIVES} box fictives au maximum : supprimes-en une d'abord.` });
      }
      if (Object.values(boxes).some(box => box.nom.toLowerCase() === nom.toLowerCase())) {
        return res.status(409).json({ error: `Une box fictive s'appelle déjà « ${nom} ».` });
      }
      const id = nouvelIdFictif();
      const maintenant = new Date().toISOString();
      boxes[id] = {
        nom,
        data: nettoyerDonneesFictive({}),
        createur: user.global_name || user.username || user.id,
        cree_le: maintenant,
        modifie_le: maintenant
      };
      await ecrireBoxesFictives(boxes);
      return res.status(200).json({ id });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const boxes = await lireBoxesFictives();
  const box = boxes[cible];
  if (!box) return res.status(404).json({ error: "Box fictive introuvable" });

  if (req.method === "GET") {
    if (!moderateur && !await boxJoueeDansRoom(url.searchParams.get("room"), cible)) {
      return res.status(403).json({ error: "Réservé aux administrateurs" });
    }
    return res.status(200).json({ discord_id: cible, discord_global_name: box.nom, discord_username: box.nom, discord_avatar_url: null, fictive: true, data: box.data });
  }

  if (!moderateur) return res.status(403).json({ error: "Réservé aux administrateurs" });

  if (req.method === "PUT") {
    const corps = req.body || {};
    if (corps.nom !== undefined) {
      const nom = nomFictifValide(corps.nom);
      if (!nom) return res.status(400).json({ error: "Donne un nom à la box." });
      if (Object.entries(boxes).some(([id, autre]) => id !== cible && autre.nom.toLowerCase() === nom.toLowerCase())) {
        return res.status(409).json({ error: `Une box fictive s'appelle déjà « ${nom} ».` });
      }
      box.nom = nom;
    }
    if (corps.data !== undefined) box.data = nettoyerDonneesFictive(corps.data);
    box.modifie_le = new Date().toISOString();
    await ecrireBoxesFictives(boxes);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    delete boxes[cible];
    await ecrireBoxesFictives(boxes);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, PUT, DELETE");
  return res.status(405).json({ error: "Méthode non autorisée" });
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const parts = url.pathname.split("/");
    const discordId = parts[parts.length - 1];

    if (discordId === LISTE_FICTIVES || estIdFictif(discordId)) {
      res.setHeader("Cache-Control", "no-store");
      return await gererBoxesFictives(req, res, url, discordId, await verifySessionToken(parseCookies(req).session));
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("discord_id, discord_username, discord_global_name, discord_avatar_url, data")
      .eq("discord_id", discordId)
      .single();

    if (error) {
      console.error(error);
      return res.status(404).json({ error: "Profil introuvable" });
    }

    const user = await verifySessionToken(parseCookies(req).session);
    if (user?.id !== data.discord_id) {
      data.data = masquerBoxOpti(data.data, await boxOptiRevelees(url.searchParams.get("room"), data.discord_id));
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};
