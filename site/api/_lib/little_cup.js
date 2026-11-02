// Event Little Cup (cf. commun/little_cup.js) : qui peut y entrer.
const { supabase } = require("./supabase");
const { getLittleCup, getPersonnages, getArmes, pointsPersonnage } = require("./personnages");
const { estModerateur } = require("./admin");
const { calculerPoolJoueur, NB_PERSOS_MIN_BOX } = require("./draft");
const { filtrerDonneesLittleCup } = require("../../commun/little_cup.js");

// -> { status, message } si le joueur ne peut pas jouer, sinon null : event
// ouvert (ou équipe du site) et assez de persos autorisés dans sa full box.
// Points à jour : actualiserPoints avant.
async function erreurLittleCup(discordId) {
  const cup = getLittleCup();
  if (!cup.public && !await estModerateur(discordId)) return { status: 403, message: "Cet event n'est pas ouvert." };
  const { data } = await supabase.from("profiles").select("data").eq("discord_id", discordId).maybeSingle();
  const filtre = filtrerDonneesLittleCup(data?.data || {}, getPersonnages(), getArmes(), pointsPersonnage);
  const nb = calculerPoolJoueur(filtre, getPersonnages(), "full").length;
  if (nb < NB_PERSOS_MIN_BOX) {
    return { status: 409, message: `Pour ${cup.nom}, il faut au moins ${NB_PERSOS_MIN_BOX} persos autorisés dans ta full box (tu en as ${nb}).` };
  }
  return null;
}

module.exports = { erreurLittleCup };
