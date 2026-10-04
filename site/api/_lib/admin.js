// Administrateurs du site : IDs Discord listés dans la variable
// d'environnement Vercel ADMIN_DISCORD_IDS (séparés par des virgules).
// Mini admins : table mini_admins de Supabase (cf. sql/mini_admins.sql),
// page Administration en lecture seule, litiges et bans du classé.
// Shadowbans : table shadowbans (cf. sql/shadowbans.sql), pas d'accès à la
// page Theorycraft.
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

// Liste d'IDs Discord d'une table Supabase (colonne discord_id), relue au
// plus toutes les 30 s. Table absente (SQL pas lancé) : liste vide.
const CACHE_LISTES_MS = 30 * 1000;
const cacheListes = new Map();

async function estDansListe(table, discordId) {
  if (!discordId) return false;
  let cache = cacheListes.get(table);
  if (!cache || Date.now() - cache.lu > CACHE_LISTES_MS) {
    const { data, error } = await supabase.from(table).select("discord_id");
    if (error) console.error(`Erreur lecture ${table} :`, error);
    cache = { ids: new Set((data || []).map(ligne => String(ligne.discord_id))), lu: Date.now() };
    cacheListes.set(table, cache);
  }
  return cache.ids.has(String(discordId));
}

const estMiniAdmin = discordId => estDansListe("mini_admins", discordId);
const estShadowban = discordId => estDansListe("shadowbans", discordId);

// Administrateur ou mini admin : litiges, bans du classé, page
// Administration en lecture.
async function estModerateur(discordId) {
  return estAdmin(discordId) || await estMiniAdmin(discordId);
}

module.exports = { estAdmin, estMiniAdmin, estModerateur, estShadowban };
