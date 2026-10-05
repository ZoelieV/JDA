const { createClient } = require("@supabase/supabase-js");
const { parseCookies, verifySessionToken } = require("../_lib/session");

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

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const parts = url.pathname.split("/");
    const discordId = parts[parts.length - 1];

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
