// Limites de fréquence par adresse IP (table limites_frequence, cf.
// sql/abandons_limites.sql). L'IP n'est jamais stockée en clair : seulement
// une empreinte HMAC (clé SESSION_SECRET), impossible à inverser sans la clé.
const crypto = require("crypto");
const { supabase } = require("./supabase");

// IP du client : Vercel la fournit dans x-real-ip / x-forwarded-for (en-têtes
// réécrits par Vercel, pas ceux envoyés par le client).
function ipClient(req) {
  const transmise = req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0];
  return String(transmise || req.socket?.remoteAddress || "inconnue").trim();
}

function empreinteIp(req) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update(ipClient(req)).digest("hex");
}

// Action "action" autorisée au plus une fois par delaiMs pour cette IP.
// -> 0 si autorisée (et notée), sinon le temps à attendre en ms.
// Table absente : pas de limite (erreur journalisée).
async function verifierFrequence(req, action, delaiMs) {
  const cle = `${action}:${empreinteIp(req)}`;
  const maintenant = Date.now();

  const { data, error } = await supabase
    .from("limites_frequence")
    .select("dernier")
    .eq("cle", cle)
    .maybeSingle();
  if (error) {
    console.error("Erreur lecture limites_frequence :", error);
    return 0;
  }

  const ecoule = data ? maintenant - Date.parse(data.dernier) : Infinity;
  if (ecoule < delaiMs) return delaiMs - ecoule;

  const { error: erreurEcriture } = await supabase
    .from("limites_frequence")
    .upsert({ cle, dernier: new Date(maintenant).toISOString() });
  if (erreurEcriture) console.error("Erreur écriture limites_frequence :", erreurEcriture);
  return 0;
}

module.exports = { verifierFrequence };
