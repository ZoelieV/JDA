// Alertes sur les temps et sanctions du mode classé (détails : notes privées
// de l'équipe, hors dépôt).
const { supabase } = require("./supabase");
const { DUREE_DEFI_SECONDES, estDefiEnnemis } = require("./boss");
const { seuilsTempsSuspects, dangerTemps } = require("../../commun/temps_suspects.js");
const { getTempsSuspects } = require("./personnages");

const SANCTIONS = ["aucune", "semaine", "saison", "definitif"];
const SEMAINE_MS = 7 * 24 * 60 * 60 * 1000;

// -> null si cohérent, sinon { duree_saisie, somme_temps } (secondes).
function detecterTriche(draft, maintenant = Date.now()) {
  if (!draft.debut_temps) return null;
  const defi = estDefiEnnemis(draft.boss_id);
  const somme = ["j1", "j2"].reduce((total, role) => {
    const temps = draft[`temps_${role}`];
    if (defi) return total + (temps && !temps.abandon ? DUREE_DEFI_SECONDES : 0);
    return total + (Number(temps?.secondes) || 0);
  }, 0);
  const ecoule = Math.floor((maintenant - draft.debut_temps) / 1000);
  return somme > ecoule ? { duree_saisie: ecoule, somme_temps: somme } : null;
}

// Seuils par boss (config.temps_suspects) -> { niveau, j1, j2 } ou null.
function detecterTempsSuspects(draft) {
  const seuils = seuilsTempsSuspects(draft.boss_id, getTempsSuspects());
  if (!seuils) return null;
  const ennemis = estDefiEnnemis(draft.boss_id);
  const suspicion = { niveau: 0, j1: null, j2: null };
  ["j1", "j2"].forEach(role => {
    const temps = draft[`temps_${role}`];
    if (temps?.abandon) return;
    const secondes = temps?.secondes;
    const niveau = dangerTemps(secondes, seuils, { ennemis });
    if (!niveau) return;
    suspicion[role] = { secondes, niveau, limite: seuils.suspect ?? seuils.triche, minimum: seuils.triche, ...(ennemis ? { ennemis: true } : {}) };
    suspicion.niveau = Math.max(suspicion.niveau, niveau);
  });
  return suspicion.niveau ? suspicion : null;
}

// Fin d'une sanction (null = définitive) ; erreur si date de saison invalide.
function finSanction(type, finSaison, maintenant = Date.now()) {
  if (type === "semaine") return new Date(maintenant + SEMAINE_MS).toISOString();
  if (type === "definitif") return null;
  const date = Date.parse(finSaison);
  if (!Number.isFinite(date) || date <= maintenant) throw { status: 400, message: "Date de fin de saison invalide (dans le futur)" };
  return new Date(date).toISOString();
}

// Ban du classé en cours pour ce joueur -> { type, fin } ou null.
async function banClasse(discordId, maintenant = Date.now()) {
  const { data, error } = await supabase
    .from("sanctions")
    .select("type, fin")
    .eq("discord_id", discordId)
    .neq("type", "aucune");
  if (error) {
    // Table absente (base pas à jour) : aucun ban.
    console.error("Erreur lecture sanctions :", error);
    return null;
  }
  const actifs = (data || []).filter(s => s.fin === null || Date.parse(s.fin) > maintenant);
  if (!actifs.length) return null;
  // La plus longue (définitive d'abord).
  return actifs.sort((a, b) => (b.fin === null) - (a.fin === null) || Date.parse(b.fin) - Date.parse(a.fin))[0];
}

function messageBan(ban) {
  if (ban.type === "site") return "Tu es banni du site.";
  if (ban.fin === null) return "Tu es banni définitivement du mode classé.";
  return `Tu es banni du mode classé jusqu'au ${new Date(ban.fin).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" })}.`;
}

module.exports = { SANCTIONS, detecterTriche, detecterTempsSuspects, finSanction, banClasse, messageBan };
