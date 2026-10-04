// Administrateurs du site : IDs Discord listés dans la variable
// d'environnement Vercel ADMIN_DISCORD_IDS (séparés par des virgules).
// Mini admins : table mini_admins de Supabase (cf. sql/mini_admins.sql),
// page Administration en lecture seule, litiges et bans du classé.
const { supabase } = require("./supabase");

function getIdsAdmins() {
  return (process.env.ADMIN_DISCORD_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
}

function estAdmin(discordId) {
  return !!discordId && getIdsAdmins().includes(String(discordId));
}

// Liste des mini admins relue au plus toutes les 30 s.
const CACHE_MINI_ADMINS_MS = 30 * 1000;
let cacheMiniAdmins = { ids: new Set(), lu: 0 };

async function estMiniAdmin(discordId) {
  if (!discordId) return false;
  if (Date.now() - cacheMiniAdmins.lu > CACHE_MINI_ADMINS_MS) {
    const { data, error } = await supabase.from("mini_admins").select("discord_id");
    // Table absente (sql/mini_admins.sql pas lancé) : aucun mini admin.
    if (error) console.error("Erreur lecture mini_admins :", error);
    cacheMiniAdmins = { ids: new Set((data || []).map(m => String(m.discord_id))), lu: Date.now() };
  }
  return cacheMiniAdmins.ids.has(String(discordId));
}

// Administrateur ou mini admin : litiges, bans du classé, page
// Administration en lecture.
async function estModerateur(discordId) {
  return estAdmin(discordId) || await estMiniAdmin(discordId);
}

module.exports = { estAdmin, estMiniAdmin, estModerateur };
