// Signalements de matchs (table signalements, cf. sql/signalements.sql).
//
// Tout joueur connecté peut signaler un match terminé depuis la page
// Historique (raison obligatoire), sauf pendant un ban du classé : une fois
// par match, SIGNALEMENTS_JOUR_MAX par jour (reset à 4 h, cf. journee.js).
// Rien ne change pour les autres joueurs : le match reste valide tant qu'un
// administrateur ou mini admin ne l'a pas traité. Traitement (tous les
// signalements ouverts du match d'un coup) : sans suite, temps corrigés
// (match toujours valide, vainqueur et trophées recalculés) ou match
// invalidé (match_history.litige = "invalide" : plus compté nulle part) ;
// ban du classé possible pour chaque joueur dans tous les cas.
const { supabase } = require("./supabase");
const { debutJournee } = require("./journee");
const { banClasse, SANCTIONS, finSanction } = require("./sanctions");
const { parserTempsOuAbandon, determinerVainqueur } = require("./temps");
const { calculerTrophees } = require("./trophees");

const SIGNALEMENTS_JOUR_MAX = 10;
const COMMENTAIRE_SIGNALEMENT_MAX = 500;
const DECISIONS = ["sans_suite", "corrige", "invalide"];
// Matchs déjà hors de l'historique public ou invalidés : pas signalables.
const LITIGES_NON_SIGNALABLES = ["ouvert", "traite", "invalide"];
const ERREUR_TABLE = "Table des signalements absente : lancer sql/signalements.sql dans Supabase.";

function estSignalable(match) {
  return !!match && !match.entrainement && !LITIGES_NON_SIGNALABLES.includes(match.litige);
}

// Joueur connecté (page Historique) -> { banni, restants, signales: [ids
// des matchs déjà signalés] }.
async function etatSignalementsJoueur(discordId) {
  const [ban, { data, error }] = await Promise.all([
    banClasse(discordId),
    supabase.from("signalements").select("match_id, created_at").eq("discord_id", discordId)
  ]);
  if (error) {
    console.error("Erreur lecture signalements :", error);
    return { banni: !!ban, restants: 0, signales: [], erreur: ERREUR_TABLE };
  }
  const debut = debutJournee();
  const aujourdhui = (data || []).filter(s => Date.parse(s.created_at) >= debut).length;
  return {
    banni: !!ban,
    restants: Math.max(0, SIGNALEMENTS_JOUR_MAX - aujourdhui),
    signales: (data || []).map(s => s.match_id)
  };
}

// ---- POST ?id= { commentaire } : signalement d'un match ----
async function signalerMatch(req, res, user) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "Match manquant" });
  const commentaire = typeof req.body?.commentaire === "string" ? req.body.commentaire.trim() : "";
  if (!commentaire) return res.status(400).json({ error: "Explique la raison du signalement." });
  if (commentaire.length > COMMENTAIRE_SIGNALEMENT_MAX) {
    return res.status(400).json({ error: `Raison trop longue (${COMMENTAIRE_SIGNALEMENT_MAX} caractères au plus).` });
  }

  const etat = await etatSignalementsJoueur(user.id);
  if (etat.erreur) return res.status(500).json({ error: etat.erreur });
  if (etat.banni) return res.status(403).json({ error: "Tu ne peux pas signaler de match pendant ton ban du mode classé." });
  if (etat.signales.map(String).includes(String(id))) return res.status(409).json({ error: "Tu as déjà signalé ce match." });
  if (etat.restants <= 0) {
    return res.status(429).json({ error: `${SIGNALEMENTS_JOUR_MAX} signalements par jour au plus : réessaie après 4 h.` });
  }

  const { data: match, error } = await supabase.from("match_history").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!estSignalable(match)) return res.status(404).json({ error: "Ce match ne peut pas être signalé." });

  const { error: erreurAjout } = await supabase
    .from("signalements")
    .insert({ match_id: match.id, discord_id: user.id, commentaire });
  if (erreurAjout) {
    // Clé unique (match_id, discord_id) : double clic, autre onglet.
    if (erreurAjout.code === "23505") return res.status(409).json({ error: "Tu as déjà signalé ce match." });
    console.error("Erreur enregistrement signalement :", erreurAjout);
    return res.status(500).json({ error: ERREUR_TABLE });
  }
  return res.status(200).json({ ok: true, restants: etat.restants - 1 });
}

// Administrateurs : signalements ouverts -> { matchs (lignes de
// match_history, plus récemment signalées d'abord), parMatch (Map id du
// match -> signalements), erreur }.
async function chargerSignalementsOuverts() {
  const { data, error } = await supabase
    .from("signalements")
    .select("match_id, discord_id, commentaire, created_at")
    .eq("statut", "ouvert")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Erreur lecture signalements :", error);
    return { matchs: [], parMatch: new Map(), erreur: ERREUR_TABLE };
  }
  const parMatch = new Map();
  (data || []).forEach(s => {
    const cle = String(s.match_id);
    if (!parMatch.has(cle)) parMatch.set(cle, []);
    parMatch.get(cle).push(s);
  });
  if (!parMatch.size) return { matchs: [], parMatch, erreur: null };

  const { data: lignes, error: erreurMatchs } = await supabase
    .from("match_history")
    .select("*")
    .in("id", [...parMatch.keys()]);
  if (erreurMatchs) throw erreurMatchs;
  const ordre = [...parMatch.keys()];
  const matchs = (lignes || []).sort((a, b) => ordre.indexOf(String(a.id)) - ordre.indexOf(String(b.id)));
  return { matchs, parMatch, erreur: null };
}

// ---- PATCH ?id= { action: "signalement", decision, temps_j1, temps_j2,
// sanctions: { j1, j2 }, fin_saison } (administrateurs) : tous les
// signalements ouverts du match traités. ----
async function traiterSignalement(req, res, user) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "Match manquant" });
  const decision = req.body?.decision;
  if (!DECISIONS.includes(decision)) return res.status(400).json({ error: "Décision inconnue" });
  const choix = req.body?.sanctions || {};
  if (!["j1", "j2"].every(role => SANCTIONS.includes(choix[role] || "aucune"))) {
    return res.status(400).json({ error: "Sanction inconnue" });
  }

  const { data: match, error } = await supabase.from("match_history").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  const { data: ouverts, error: erreurOuverts } = await supabase
    .from("signalements")
    .select("id")
    .eq("match_id", id)
    .eq("statut", "ouvert");
  if (erreurOuverts) return res.status(500).json({ error: ERREUR_TABLE });
  if (!match || !ouverts?.length) return res.status(404).json({ error: "Signalement introuvable ou déjà traité" });

  // Tout vérifié avant d'écrire quoi que ce soit.
  let correction = null;
  if (decision === "corrige") {
    const tempsJ1 = parserTempsOuAbandon(req.body?.temps_j1);
    const tempsJ2 = parserTempsOuAbandon(req.body?.temps_j2);
    if (!tempsJ1 || !tempsJ2) return res.status(400).json({ error: "Format de temps invalide (attendu mm:ss ou abandon)" });
    const vainqueur = determinerVainqueur(tempsJ1, tempsJ2);
    correction = {
      ...(match.classe ? { trophees: calculerTrophees(tempsJ1, tempsJ2, vainqueur) } : {}),
      temps_j1_affiche: tempsJ1.affiche,
      temps_j1_secondes: tempsJ1.secondes,
      temps_j2_affiche: tempsJ2.affiche,
      temps_j2_secondes: tempsJ2.secondes,
      vainqueur
    };
  }
  let bans;
  try {
    bans = ["j1", "j2"]
      .filter(role => (choix[role] || "aucune") !== "aucune")
      .map(role => ({
        discord_id: match[`player${role === "j1" ? 1 : 2}_discord_id`],
        type: choix[role],
        fin: finSanction(choix[role], req.body?.fin_saison),
        match_id: match.id,
        admin: user.id
      }))
      .filter(ban => ban.discord_id);
  } catch (erreur) {
    if (erreur?.status) return res.status(erreur.status).json({ error: erreur.message });
    throw erreur;
  }

  if (correction || decision === "invalide") {
    const { error: erreurMaj } = await supabase
      .from("match_history")
      .update(correction || { litige: "invalide" })
      .eq("id", match.id);
    if (erreurMaj) throw erreurMaj;
  }
  if (bans.length) {
    const { error: erreurBans } = await supabase.from("sanctions").insert(bans);
    if (erreurBans) {
      console.error("Erreur enregistrement sanctions :", erreurBans);
      return res.status(500).json({ error: "Table des sanctions absente : lancer sql/anti_triche.sql dans Supabase." });
    }
  }
  const { error: erreurStatut } = await supabase
    .from("signalements")
    .update({ statut: decision, traite_par: user.id, traite_le: new Date().toISOString() })
    .eq("match_id", match.id)
    .eq("statut", "ouvert");
  if (erreurStatut) throw erreurStatut;
  return res.status(200).json({ ok: true });
}

module.exports = {
  COMMENTAIRE_SIGNALEMENT_MAX,
  estSignalable,
  etatSignalementsJoueur,
  signalerMatch,
  chargerSignalementsOuverts,
  traiterSignalement
};
