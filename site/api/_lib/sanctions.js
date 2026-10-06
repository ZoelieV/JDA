// Anti-triche et sanctions du mode classé.
//
// Détection : les 2 joueurs jouent l'un après l'autre (chacun chronomètre
// l'autre), donc le temps réel écoulé depuis l'affichage de la saisie des
// temps (draft.debut_temps) est au moins la somme des 2 temps. Somme des
// temps supérieure au temps écoulé = impossible : match classé invalidé et
// transmis aux administrateurs (litige avec triche = true).
//
// Sanctions (table sanctions, cf. sql/anti_triche.sql), choisies par un
// administrateur pour chaque joueur du dossier : ban du classé d'une
// semaine, jusqu'à la fin de la saison (date donnée par l'administrateur)
// ou définitif ; ou aucune conséquence (explication valable).
const { supabase } = require("./supabase");

const SANCTIONS = ["aucune", "semaine", "saison", "definitif"];
const SEMAINE_MS = 7 * 24 * 60 * 60 * 1000;

// -> null si cohérent, sinon { duree_saisie, somme_temps } (secondes).
function detecterTriche(draft, maintenant = Date.now()) {
  if (!draft.debut_temps) return null;
  const somme = ["j1", "j2"].reduce((total, role) => total + (Number(draft[`temps_${role}`]?.secondes) || 0), 0);
  const ecoule = Math.floor((maintenant - draft.debut_temps) / 1000);
  return somme > ecoule ? { duree_saisie: ecoule, somme_temps: somme } : null;
}

// Temps suspects (boss hebdomadaires, en secondes) : en dessous de "limite"
// (meilleurs temps connus d'un joueur expérimenté) -> danger 1 ; en dessous
// de "minimum" (meilleurs temps connus avec persos premium) -> danger 2. Le
// match classé est alors transmis aux administrateurs (preuve vidéo), comme
// une triche détectée. À ajuster si des équipes font régulièrement mieux.
const TEMPS_SUSPECTS = {
  signora_boss: { minimum: 37, limite: 37 },
  raiden_boss: { minimum: 6, limite: 8 },
  scara_boss: { minimum: 100, limite: 101 },
  apep_boss: { minimum: 42, limite: 55 },
  narwhal_boss: { minimum: 16, limite: 40 },
  arle_boss: { minimum: 25, limite: 27 },
  erode_boss: { minimum: 14, limite: 22 },
  dottoreI_boss: { minimum: 21, limite: 38 },
  dottoreII_boss: { minimum: 47, limite: 53 },
  chess_boss: { minimum: 39, limite: 41 }
};

// -> null si aucun temps suspect, sinon { niveau (1 | 2, le plus haut),
// j1, j2 : { secondes, niveau, limite, minimum } | null }.
function detecterTempsSuspects(draft) {
  const seuils = TEMPS_SUSPECTS[draft.boss_id];
  if (!seuils) return null;
  const suspicion = { niveau: 0, j1: null, j2: null };
  ["j1", "j2"].forEach(role => {
    const secondes = draft[`temps_${role}`]?.secondes;
    if (typeof secondes !== "number" || secondes >= seuils.limite) return;
    const niveau = secondes < seuils.minimum ? 2 : 1;
    suspicion[role] = { secondes, niveau, ...seuils };
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
    // Table absente (sql/anti_triche.sql pas lancé) : aucun ban.
    console.error("Erreur lecture sanctions :", error);
    return null;
  }
  const actifs = (data || []).filter(s => s.fin === null || Date.parse(s.fin) > maintenant);
  if (!actifs.length) return null;
  // La plus longue (définitive d'abord).
  return actifs.sort((a, b) => (b.fin === null) - (a.fin === null) || Date.parse(b.fin) - Date.parse(a.fin))[0];
}

function messageBan(ban) {
  if (ban.fin === null) return "Tu es banni définitivement du mode classé.";
  return `Tu es banni du mode classé jusqu'au ${new Date(ban.fin).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" })}.`;
}

module.exports = { SANCTIONS, TEMPS_SUSPECTS, detecterTriche, detecterTempsSuspects, finSanction, banClasse, messageBan };
