// Box fictives : faux profils créés par les administrateurs et mini admins
// depuis la page Administration (bouton "Box fictives"), remplis comme une
// full box sur Mon compte (my_account?box_fictive=<id>), et choisissables
// uniquement en entraînement, uniquement par les administrateurs et mini
// admins (côté "Ta box" et / ou "Box adverse", cf. validerBoxEntrainement
// dans api/rooms/index.js).
//
// Stockées dans la table points, ligne "boxes_fictives" (pas de table à
// créer) : { boxes: { <id>: { nom, data, createur, cree_le, modifie_le } } }.
// data a le format des données d'un profil (characters, weapons, theatre),
// full box seulement. Id "fictif_<hex>" : jamais un ID Discord (chiffres).
const crypto = require("crypto");
const { supabase } = require("./supabase");

const PREFIXE_FICTIF = "fictif_";
const LIGNE = "boxes_fictives";
const LONGUEUR_NOM_FICTIF = 40;
const MAX_BOXES_FICTIVES = 50;

const estIdFictif = id => typeof id === "string" && id.startsWith(PREFIXE_FICTIF);

function nouvelIdFictif() {
  return PREFIXE_FICTIF + crypto.randomBytes(4).toString("hex");
}

// Nom nettoyé, ou null s'il est vide.
function nomFictifValide(brut) {
  const nom = typeof brut === "string" ? brut.trim().slice(0, LONGUEUR_NOM_FICTIF) : "";
  return nom || null;
}

// -> { <id>: { nom, data, createur, cree_le, modifie_le } }
async function lireBoxesFictives() {
  const { data, error } = await supabase.from("points").select("data").eq("id", LIGNE).maybeSingle();
  if (error) throw error;
  return data?.data?.boxes || {};
}

async function ecrireBoxesFictives(boxes) {
  const { error } = await supabase.from("points").upsert({
    id: LIGNE,
    data: { boxes },
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

async function lireBoxFictive(id) {
  if (!estIdFictif(id)) return null;
  return (await lireBoxesFictives())[id] || null;
}

// Données de profil d'un propriétaire de box : profil Discord ou box
// fictive (null si introuvable).
async function lireDonneesProprietaire(id) {
  if (estIdFictif(id)) return (await lireBoxFictive(id))?.data || null;
  const { data } = await supabase.from("profiles").select("data").eq("discord_id", id).maybeSingle();
  return data?.data || null;
}

module.exports = {
  PREFIXE_FICTIF,
  LONGUEUR_NOM_FICTIF,
  MAX_BOXES_FICTIVES,
  estIdFictif,
  nouvelIdFictif,
  nomFictifValide,
  lireBoxesFictives,
  ecrireBoxesFictives,
  lireBoxFictive,
  lireDonneesProprietaire
};
