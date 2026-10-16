// Feedbacks des joueurs (table feedbacks, cf. sql/feedbacks.sql), routes de
// api/matches.js (?feedback=..., pour rester sous la limite de fonctions de
// Vercel).
//
// Envoi (accueil, bouton Feedback) : joueur connecté seulement, texte de
// TEXTE_MAX caractères au plus, sans lien (cf. contientLien), un par jour
// et par compte, reset à 4 h heure de Paris (cf. _lib/journee.js ; table
// limites_frequence, cf. _lib/limites.js, et dernier feedback de la table en
// secours). Lecture : administrateurs et mini
// admins (page Administration) ; statut et suppression : administrateurs.
//
// Sécurité : le texte n'est jamais interprété (affiché échappé dans la page
// admin) ; caractères de contrôle et invisibles retirés, liens refusés
// (adresses, domaines, IP, y compris écrits en pleine chasse) ; envoi
// refusé depuis un autre site (en-tête Origin).
const { supabase } = require("./supabase");
const { attenteCompte, verifierFrequenceCompte } = require("./limites");
const { debutJournee } = require("./journee");

const TEXTE_MAX = 1000;
// Corps reçu au-delà : refusé avant tout traitement.
const BRUT_MAX = 5000;
const ACTION_LIMITE = "feedback";
const STATUTS = ["nouveau", "pris_en_compte", "termine"];
const NB_FEEDBACKS_MAX = 200;
const ERREUR_TABLE = "Table des feedbacks absente : lancer sql/feedbacks.sql dans Supabase.";

// ---- Texte ----

// Caractères invisibles ou de mise en forme (zéro largeur, sens d'écriture)
// et caractères de contrôle, sauf retour à la ligne et tabulation.
const INVISIBLES = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;
const CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// Texte reçu -> texte nettoyé : forme normale NFKC (pleine chasse, lettres
// stylisées ramenées aux caractères simples), invisibles retirés, fins de
// ligne unifiées, 2 lignes vides de suite au plus.
function nettoyerTexte(brut) {
  return brut
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLES, "")
    .replace(CONTROLES, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Extensions de domaine courantes (dont celles des raccourcisseurs et
// invitations Discord) : "exemple.com", "discord.gg", "bit.ly"...
const TLD = "com|net|org|fr|be|ch|ca|lu|eu|de|uk|us|ru|cn|jp|kr|io|gg|ly|co|me|tv|gl|to|sh|cc|ws|gd|xyz|info|biz|app|dev|site|online|link|live|shop|store|click|top|icu|vip|lol|fun|page|art|one|cloud|pro|tk|ml|ga|cf|gq|pw|su|in|nu|is|im|ai|so|st|la|li|zip|mov";
const MOTIFS_LIEN = [
  // Schéma d'adresse (https://, ftp://, discord://...) ou pseudo-schéma.
  /[a-z][a-z0-9+.-]*:\/\//i,
  /\b(?:javascript|data|vbscript|mailto|file|blob)\s*:/i,
  /\bwww\d{0,3}\s*\./i,
  // Domaine connu ("exemple.com", "discord.gg").
  new RegExp(`\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLD})\\b`, "i"),
  // Domaine sans ambiguïté écrit avec des espaces ("exemple . com") : pas les
  // extensions qui sont aussi des mots ("fini. La draft").
  /\b[a-z0-9-]+\s*\.\s*(?:com|net|org|gg|xyz|io)\b/i,
  // Domaine quelconque suivi d'un chemin ("site.abc/page").
  /\b[a-z0-9-]+\.[a-z]{2,}\/\S/i,
  // Adresse IP.
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  // Points déguisés : "exemple[.]com", "exemple(dot)com".
  /[[(]\s*(?:\.|dot|point)\s*[\])]/i
];

function contientLien(texte) {
  // Variantes du point (。 ｡ ․ ‧ ・) ramenées au point.
  const simple = texte.replace(/[。｡․‧・﹒]/g, ".");
  return MOTIFS_LIEN.some(motif => motif.test(simple));
}

// Texte d'un feedback -> { texte } ou { erreur }.
function validerTexte(brut) {
  if (typeof brut !== "string") return { erreur: "Écris ton feedback." };
  if (brut.length > BRUT_MAX) return { erreur: `Feedback trop long (${TEXTE_MAX} caractères au plus).` };
  const texte = nettoyerTexte(brut);
  if (!texte) return { erreur: "Écris ton feedback." };
  if (Array.from(texte).length > TEXTE_MAX) return { erreur: `Feedback trop long (${TEXTE_MAX} caractères au plus).` };
  if (contientLien(texte)) return { erreur: "Les liens ne sont pas autorisés dans un feedback." };
  return { texte };
}

// Requête venue d'une page d'un autre site (en-tête Origin d'un autre
// hôte) : refusée.
function origineEtrangere(req) {
  const origine = req.headers?.origin;
  if (!origine) return false;
  try {
    return new URL(origine).host !== req.headers.host;
  } catch {
    return true;
  }
}

// ---- Délai ----

// Journée en cours (reset à 4 h, heure de Paris) : { debut, prochain }
// (prochain reset ; 23 ou 25 h plus tard au changement d'heure).
function journee(maintenant = Date.now()) {
  const debut = debutJournee(maintenant);
  return { debut, prochain: debutJournee(debut + 30 * 60 * 60 * 1000) };
}

// Temps à attendre (ms) avant le prochain feedback de ce joueur : jusqu'au
// prochain reset s'il en a déjà envoyé un depuis le dernier (limite de
// fréquence ou dernier feedback enregistré), sinon 0.
async function attenteFeedback(discordId) {
  const maintenant = Date.now();
  const { debut, prochain } = journee(maintenant);
  const [attenteLimite, { data, error }] = await Promise.all([
    attenteCompte(discordId, ACTION_LIMITE, maintenant - debut),
    supabase.from("feedbacks").select("created_at").eq("discord_id", discordId).order("created_at", { ascending: false }).limit(1)
  ]);
  const attenteJour = prochain - maintenant;
  if (error) {
    console.error("Erreur lecture feedbacks :", error);
    return { attente: attenteLimite > 0 ? attenteJour : 0, erreur: ERREUR_TABLE };
  }
  const dernier = data?.[0] ? Date.parse(data[0].created_at) : null;
  const dejaEnvoye = attenteLimite > 0 || (dernier !== null && dernier >= debut);
  return { attente: dejaEnvoye ? attenteJour : 0, erreur: null };
}

function texteAttente(ms) {
  const heures = Math.floor(ms / 3600000);
  const minutes = Math.ceil((ms % 3600000) / 60000);
  if (heures === 0) return `${minutes} min`;
  if (minutes === 60) return `${heures + 1} h`;
  return minutes === 0 ? `${heures} h` : `${heures} h ${String(minutes).padStart(2, "0")}`;
}

// ---- GET ?feedback=etat : peut-on envoyer un feedback ? ----
async function etatFeedback(res, user) {
  if (!user) return res.status(200).json({ connecte: false, max: TEXTE_MAX });
  const { attente } = await attenteFeedback(user.id);
  return res.status(200).json({ connecte: true, max: TEXTE_MAX, attente });
}

// ---- POST ?feedback=1 { texte } : envoi (joueur connecté) ----
async function envoyerFeedback(req, res, user) {
  if (origineEtrangere(req)) return res.status(403).json({ error: "Requête refusée." });
  const { texte, erreur } = validerTexte(req.body?.texte);
  if (erreur) return res.status(400).json({ error: erreur });

  const { attente, erreur: erreurTable } = await attenteFeedback(user.id);
  if (erreurTable) return res.status(500).json({ error: erreurTable });
  if (attente > 0) {
    return res.status(429).json({ error: `Un feedback par jour : réessaie après 4 h (dans ${texteAttente(attente)}).`, attente });
  }
  // Noté avant l'écriture : deux envois simultanés ne passent pas tous les 2.
  const maintenant = Date.now();
  const { debut, prochain } = journee(maintenant);
  if (await verifierFrequenceCompte(user.id, ACTION_LIMITE, maintenant - debut) > 0) {
    return res.status(429).json({ error: `Un feedback par jour : réessaie après 4 h (dans ${texteAttente(prochain - maintenant)}).`, attente: prochain - maintenant });
  }

  const { data: profil } = await supabase
    .from("profiles")
    .select("discord_username, discord_global_name")
    .eq("discord_id", user.id)
    .maybeSingle();
  const nom = profil?.discord_global_name || profil?.discord_username || user.global_name || user.username || null;
  const { error } = await supabase.from("feedbacks").insert({ discord_id: user.id, nom, texte });
  if (error) {
    console.error("Erreur enregistrement feedback :", error);
    return res.status(500).json({ error: ERREUR_TABLE });
  }
  return res.status(200).json({ ok: true, attente: journee().prochain - Date.now() });
}

// ---- GET ?feedback=liste (administrateurs et mini admins) ----
// chargerJoueurs : profils par ID Discord (api/matches.js) pour le pseudo et
// la photo actuels.
async function listerFeedbacks(res, chargerJoueurs) {
  const { data, error } = await supabase
    .from("feedbacks")
    .select("id, discord_id, nom, texte, statut, traite_par, traite_le, created_at")
    .order("created_at", { ascending: false })
    .limit(NB_FEEDBACKS_MAX);
  if (error) {
    console.error("Erreur lecture feedbacks :", error);
    return res.status(200).json({ feedbacks: [], erreur: ERREUR_TABLE });
  }
  const joueurs = await chargerJoueurs([...new Set((data || []).flatMap(f => [f.discord_id, f.traite_par]).filter(Boolean))]);
  const nom = (id, secours = null) => {
    const profil = joueurs.get(id);
    return profil?.discord_global_name || profil?.discord_username || secours || "Joueur inconnu";
  };
  return res.status(200).json({
    feedbacks: (data || []).map(f => ({
      id: f.id,
      discord_id: f.discord_id,
      nom: nom(f.discord_id, f.nom),
      avatar: joueurs.get(f.discord_id)?.discord_avatar_url || null,
      texte: f.texte,
      statut: STATUTS.includes(f.statut) ? f.statut : "nouveau",
      traite_par: f.traite_par ? nom(f.traite_par) : null,
      traite_le: f.traite_le,
      date: f.created_at
    })),
    erreur: null
  });
}

// ---- PATCH { action: "feedback", id, statut } ou { action:
// "feedback_supprimer", id } (administrateurs) ----
async function modifierFeedback(req, res, user) {
  const id = Number(req.body?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Feedback manquant" });

  if (req.body.action === "feedback_supprimer") {
    const { data, error } = await supabase.from("feedbacks").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: "Feedback introuvable" });
    return res.status(200).json({ ok: true });
  }

  const statut = req.body?.statut;
  if (!STATUTS.includes(statut)) return res.status(400).json({ error: "Statut inconnu" });
  const traite = statut === "nouveau" ? { traite_par: null, traite_le: null } : { traite_par: user.id, traite_le: new Date().toISOString() };
  const { data, error } = await supabase.from("feedbacks").update({ statut, ...traite }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) return res.status(404).json({ error: "Feedback introuvable" });
  return res.status(200).json({ ok: true });
}

module.exports = {
  TEXTE_MAX,
  contientLien,
  validerTexte,
  etatFeedback,
  envoyerFeedback,
  listerFeedbacks,
  modifierFeedback
};
