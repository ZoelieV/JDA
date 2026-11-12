// Limites de fréquence par adresse IP ou par compte (table
// limites_frequence). L'IP ou l'ID Discord
// n'est jamais stocké en clair : seulement une empreinte HMAC (clé
// SESSION_SECRET), impossible à inverser sans la clé.
const crypto = require("crypto");
const { supabase } = require("./supabase");

// IP du client : Vercel la fournit dans x-real-ip / x-forwarded-for (en-têtes
// réécrits par Vercel, pas ceux envoyés par le client).
function ipClient(req) {
  const transmise = req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0];
  return String(transmise || req.socket?.remoteAddress || "inconnue").trim();
}

function empreinte(texte) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update(texte).digest("hex");
}

// Action "action" autorisée au plus une fois par delaiMs pour cette IP.
// -> 0 si autorisée (et notée), sinon le temps à attendre en ms.
// Table absente : pas de limite (erreur journalisée).
function verifierFrequence(req, action, delaiMs) {
  return verifierCle(`${action}:${empreinte(ipClient(req))}`, delaiMs);
}

// Même chose pour un compte (ID Discord de la session), quelle que soit
// son IP.
function verifierFrequenceCompte(discordId, action, delaiMs) {
  return verifierCle(`${action}:compte:${empreinte(String(discordId))}`, delaiMs);
}

// Vérification et écriture en une seule opération côté base (deux requêtes
// simultanées ne passent plus ensemble) :
// 1. ligne existante assez ancienne : mise à jour conditionnelle ;
// 2. pas de ligne : insertion (clé unique, une seule requête la crée) ;
// 3. sinon l'action est trop récente : temps restant.
async function verifierCle(cle, delaiMs) {
  const maintenant = Date.now();
  const dernier = new Date(maintenant).toISOString();

  const { data: maj, error } = await supabase
    .from("limites_frequence")
    .update({ dernier })
    .eq("cle", cle)
    .lte("dernier", new Date(maintenant - delaiMs).toISOString())
    .select("cle");
  if (error) {
    console.error("Erreur écriture limites_frequence :", error);
    return 0;
  }
  if (maj?.length) return 0;

  const { data: creee, error: erreurCreation } = await supabase
    .from("limites_frequence")
    .upsert({ cle, dernier }, { onConflict: "cle", ignoreDuplicates: true })
    .select("cle");
  if (erreurCreation) {
    console.error("Erreur écriture limites_frequence :", erreurCreation);
    return 0;
  }
  if (creee?.length) return 0;

  const { data, error: erreurLecture } = await supabase
    .from("limites_frequence")
    .select("dernier")
    .eq("cle", cle)
    .maybeSingle();
  if (erreurLecture) {
    console.error("Erreur lecture limites_frequence :", erreurLecture);
    return 0;
  }
  return data ? Math.max(1, delaiMs - (maintenant - Date.parse(data.dernier))) : 0;
}

// Temps à attendre (ms) avant que "action" soit de nouveau permise pour ce
// compte, sans rien noter (affichage) ; 0 si permise ou table absente.
async function attenteCompte(discordId, action, delaiMs) {
  const cle = `${action}:compte:${empreinte(String(discordId))}`;
  const { data, error } = await supabase.from("limites_frequence").select("dernier").eq("cle", cle).maybeSingle();
  if (error) {
    console.error("Erreur lecture limites_frequence :", error);
    return 0;
  }
  return data ? Math.max(0, delaiMs - (Date.now() - Date.parse(data.dernier))) : 0;
}

module.exports = { attenteCompte, verifierFrequence, verifierFrequenceCompte };
