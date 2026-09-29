// Administrateurs du site : IDs Discord listés dans la variable
// d'environnement Vercel ADMIN_DISCORD_IDS (séparés par des virgules).
function getIdsAdmins() {
  return (process.env.ADMIN_DISCORD_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
}

function estAdmin(discordId) {
  return !!discordId && getIdsAdmins().includes(String(discordId));
}

module.exports = { estAdmin };
