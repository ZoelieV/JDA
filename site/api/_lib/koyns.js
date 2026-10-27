// Rikoyns : monnaie du site (cf. commun/koyns.js), tables koyns_mouvements et
// cosmetiques_possedes. Tables absentes (base pas à jour) :
// aucun gain, rien de possédé (erreurs journalisées).
//
// Gains :
// - KOYNS_PAR_MATCH à chaque joueur d'un match réel terminé : 1v1 (room
//   privée, matchmaking, classé), en équipe, Random world boss. Jamais en
//   entraînement, ni en litige, ni quand l'anti-triche a un soupçon (cf.
//   _lib/sanctions.js) ; repris si un administrateur invalide le match
//   ensuite (signalement) ; donnés si un litige est republié. Joueur (ou
//   équipe) qui a déclaré « Abandon » au boss : KOYNS_ABANDON seulement.
//   Match classé quitté pendant la draft (cf. abandonnerMatchClasse,
//   _lib/room.js) : rien, pour personne (pas de match joué).
// - Au plus MAX_GAMES_PAR_ADVERSAIRE games récompensées par journée (reset
//   à 4 h, cf. _lib/journee.js) contre les mêmes adversaires (anti-farm).
// - DEPART_MINI_ADMIN une fois pour les mini admins (en 2 mouvements :
//   les 30 d'origine, ref "depart", puis le complément, ref "depart_100",
//   que reçoivent aussi ceux qui avaient déjà les 30).
// - Bonus de connexion pendant un événement (config.bonus_connexion) et
//   dons des administrateurs (Rikoyns, cosmétiques exclusifs).
// - DEPART_ADMIN une fois pour les administrateurs (de quoi tout acheter :
//   ils passent par l'achat comme tout le monde, cf. acheterCosmetique).
const { supabase } = require("./supabase");
const { estAdmin, estMiniAdmin } = require("./admin");
const { debutJournee } = require("./journee");
const { getConfigKoyns } = require("./personnages");
const { prixCosmetique, FOND_IMPORTE, COSMETIQUES_GRATUITS, idCosmetique, cosmetiquesParametres } = require("../../commun/koyns.js");
const cosmetiques = require("../../DB/images/cosmetiques.json");
const { VARIANTES_PERSONNAGES, SKINS_PERSONNAGES } = require("../../commun/variantes.js");

const KOYNS_PAR_MATCH = 5;
const KOYNS_ABANDON = 1;
const MAX_GAMES_PAR_ADVERSAIRE = 3;
const DEPART_MINI_ADMIN = 100;
// Catalogue complet : ~6000 Rikoyns (429 cosmétiques au 2026-10-21), plus
// des imports de Mon image.
const DEPART_ADMIN = 10000;
const DEPARTS_MINI_ADMIN = [{ ref: "depart", montant: 30 }, { ref: "depart_100", montant: DEPART_MINI_ADMIN - 30 }];
const MAX_KOYNS_DON = 1000;

// Tous les cosmétiques existants (ids), gratuits compris. "fond:perso" :
// image importée par le joueur (gardée dans son navigateur), payée à chaque
// import (cf. acheterCosmetique).
const CATALOGUE = new Set([
  ...cosmetiques.fonds.map(fond => idCosmetique("fond", fond.id)),
  idCosmetique("fond", "perso"),
  ...cosmetiques.bannieres.map(chemin => idCosmetique("banniere", chemin)),
  ...cosmetiques.bannieres2.map(chemin => idCosmetique("banniere2", chemin)),
  ...Object.values(VARIANTES_PERSONNAGES).flatMap(v => Object.keys(v.options).map(option => idCosmetique(v.parametre, option))),
  ...SKINS_PERSONNAGES.map(id => idCosmetique("skin", id)),
  ...COSMETIQUES_GRATUITS
]);

const estCosmetique = id => typeof id === "string" && CATALOGUE.has(id);
const estExclusif = id => getConfigKoyns().exclusifs.has(id);

// ---- Lecture ----

// Solde d'un joueur (somme de ses mouvements). Administrateur, mini admin :
// Rikoyns de départ ajoutés à la première lecture (une seule fois, refs
// "depart_admin", "depart"...).
async function lireSolde(discordId) {
  if (estAdmin(discordId)) {
    await ajouterMouvement({ discord_id: discordId, montant: DEPART_ADMIN, raison: "depart", ref: "depart_admin" });
  } else if (await estMiniAdmin(discordId)) {
    for (const { ref, montant } of DEPARTS_MINI_ADMIN) {
      await ajouterMouvement({ discord_id: discordId, montant, raison: "depart", ref });
    }
  }
  const { data, error } = await supabase.from("koyns_mouvements").select("montant").eq("discord_id", discordId);
  if (error) {
    console.error("Erreur lecture koyns_mouvements :", error);
    return 0;
  }
  return (data || []).reduce((total, ligne) => total + ligne.montant, 0);
}

// Cosmétiques possédés (Set d'ids ; null = tout, plus utilisé : les
// administrateurs achètent aussi, cf. DEPART_ADMIN).
async function lirePossedes(discordId) {
  const { data, error } = await supabase.from("cosmetiques_possedes").select("cosmetique").eq("discord_id", discordId);
  if (error) {
    console.error("Erreur lecture cosmetiques_possedes :", error);
    return new Set();
  }
  // Imports de Mon image ("fond:perso#<date>", cf. acheterCosmetique) : le
  // fond "perso" est possédé.
  return new Set((data || []).map(ligne => ligne.cosmetique.split("#")[0]));
}

const possede = (possedes, id) => possedes === null || COSMETIQUES_GRATUITS.has(id) || possedes.has(id);

// État envoyé à la page de personnalisation.
async function etatKoyns(discordId) {
  const [solde, possedes] = await Promise.all([lireSolde(discordId), lirePossedes(discordId)]);
  return {
    solde,
    tout: possedes === null,
    possedes: possedes ? [...possedes] : [],
    exclusifs: [...getConfigKoyns().exclusifs]
  };
}

// Paramètres de personnalisation réduits aux cosmétiques possédés : les
// autres reviennent au choix par défaut (retirés), skins non possédés ôtés.
function filtrerParametresPossedes(parametres, possedes) {
  if (possedes === null) return parametres;
  const propres = { ...parametres };
  cosmetiquesParametres(parametres).filter(id => !possede(possedes, id)).forEach(id => {
    const [choix, ...reste] = id.split(":");
    const valeur = reste.join(":");
    if (choix === "skin") propres.skins = (propres.skins || []).filter(skin => skin !== valeur);
    else delete propres[choix];
  });
  if (Array.isArray(propres.skins) && !propres.skins.length) delete propres.skins;
  return propres;
}

// ---- Écriture ----

// Insertion d'un mouvement ; ref déjà utilisée par ce joueur : ignoré.
// -> true si ajouté.
async function ajouterMouvement(ligne) {
  const { data, error } = await supabase
    .from("koyns_mouvements")
    .upsert(ligne, { onConflict: "discord_id,ref", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("Erreur écriture koyns_mouvements :", error);
    return false;
  }
  return !!data?.length;
}

// Achat d'un cosmétique (prix selon son type, cf. prixCosmetique). -> { ok } ou
// { erreur, status }.
async function acheterCosmetique(discordId, id) {
  if (!estCosmetique(id) || COSMETIQUES_GRATUITS.has(id)) return { status: 400, erreur: "Cosmétique inconnu." };
  await lireSolde(discordId); // Rikoyns de départ (administrateur, mini admin), avant l'achat.
  if (estExclusif(id)) return { status: 403, erreur: "Cosmétique exclusif : il ne s'achète pas, il se gagne (classements, événements)." };
  // Mon image : payée à chaque import, enregistrée comme un achat à part
  // (même verrou du solde que les autres achats).
  const achete = id === FOND_IMPORTE ? `${id}#${Date.now()}` : id;
  const { data, error } = await supabase.rpc("acheter_cosmetique", { p_discord_id: discordId, p_cosmetique: achete, p_prix: prixCosmetique(id) });
  if (error) {
    console.error("Erreur achat de cosmétique :", error);
    return { status: 500, erreur: "Boutique indisponible pour l'instant." };
  }
  if (data === "solde") return { status: 409, erreur: "Pas assez de Rikoyns : joue des matchs pour en gagner." };
  return { ok: true };
}

// Gains d'une partie terminée. participants : [{ discordId, adversaires:
// [ids] }] ; ref : identifiant de la partie (ex. "match:42") ; refus :
// raison de ne rien donner ("suspicion"), ou null.
// -> { discordId: { montant, raison } } (raison : null, "plafond",
// "suspicion"), pour l'écran de fin.
// participants : [{ discordId, adversaires, abandon }] (abandon : a
// déclaré « Abandon » au boss -> KOYNS_ABANDON au lieu de KOYNS_PAR_MATCH).
async function crediterPartie(participants, ref, refus = null) {
  const resultat = {};
  const debut = new Date(debutJournee()).toISOString();
  for (const { discordId, adversaires, abandon } of participants) {
    if (!discordId) continue;
    if (refus) {
      resultat[discordId] = { montant: 0, raison: refus };
      continue;
    }
    const cle = [...new Set(adversaires.filter(Boolean).map(String))].sort().join(",") || "seul";
    const { count, error } = await supabase
      .from("koyns_mouvements")
      .select("id", { count: "exact", head: true })
      .eq("discord_id", discordId)
      .eq("raison", "match")
      .eq("adversaires", cle)
      .gte("cree_le", debut);
    if (error) {
      console.error("Erreur lecture koyns_mouvements :", error);
      resultat[discordId] = { montant: 0, raison: null };
      continue;
    }
    if (count >= MAX_GAMES_PAR_ADVERSAIRE) {
      resultat[discordId] = { montant: 0, raison: "plafond" };
      continue;
    }
    const montant = abandon ? KOYNS_ABANDON : KOYNS_PAR_MATCH;
    const ajoute = await ajouterMouvement({ discord_id: discordId, montant, raison: "match", ref, adversaires: cle });
    resultat[discordId] = { montant: ajoute ? montant : 0, raison: null };
  }
  return resultat;
}

// Match 1v1 (draft de room) terminé et archivé sous idMatch.
function crediterMatch(draft, idMatch, refus = null) {
  if (!idMatch || draft.entrainement) return Promise.resolve({});
  return crediterPartie([
    { discordId: draft.discord_j1, adversaires: [draft.discord_j2], abandon: !!draft.temps_j1?.abandon },
    { discordId: draft.discord_j2, adversaires: [draft.discord_j1], abandon: !!draft.temps_j2?.abandon }
  ], `match:${idMatch}`, refus);
}

// Match de match_history republié par un administrateur (litige vérifié) :
// gains donnés comme en fin de match (1v1 ou en équipe).
function crediterMatchArchive(match) {
  if (!match?.id || match.entrainement) return Promise.resolve({});
  const camps = match.equipes
    ? ["j1", "j2"].map(role => (match.equipes[role]?.membres || []).map(m => m.discord_id))
    : [[match.player1_discord_id], [match.player2_discord_id]];
  // Abandon : temps affiché "Abandon", sans secondes (cf. TEMPS_ABANDON).
  const abandon = ["j1", "j2"].map(role => match[`temps_${role}_affiche`] === "Abandon" && match[`temps_${role}_secondes`] == null);
  return crediterPartie(camps.flatMap((camp, i) => camp.map(id => ({ discordId: id, adversaires: camps[1 - i], abandon: abandon[i] }))), `match:${match.id}`);
}

// Gains d'une partie repris (match invalidé par un administrateur).
async function reprendrePartie(ref) {
  const { data, error } = await supabase
    .from("koyns_mouvements")
    .select("discord_id, montant")
    .eq("ref", ref)
    .eq("raison", "match");
  if (error) {
    console.error("Erreur lecture koyns_mouvements :", error);
    return;
  }
  for (const ligne of data || []) {
    await ajouterMouvement({ discord_id: ligne.discord_id, montant: -ligne.montant, raison: "reprise", ref: `reprise:${ref}` });
  }
}

// Don d'un administrateur : Rikoyns (positif ou négatif) et / ou cosmétique.
async function donner(discordId, { koyns = 0, cosmetique = null }, admin) {
  if (koyns) {
    await ajouterMouvement({ discord_id: discordId, montant: koyns, raison: "don", ref: `don:${admin}:${Date.now()}` });
  }
  if (cosmetique) {
    const { error } = await supabase
      .from("cosmetiques_possedes")
      .upsert({ discord_id: discordId, cosmetique, source: "don" }, { onConflict: "discord_id,cosmetique", ignoreDuplicates: true });
    if (error) throw error;
  }
}

// ---- Bonus de connexion d'événement (config.bonus_connexion : { debut,
// fin (dates ISO), koyns, cosmetique }) : une fois par journée pendant
// l'événement, à la première visite connectée (cf. api/auth/me.js). ----
const bonusDejaPris = new Set(); // "<joueur>|<journée>" (évite de réécrire)

function bonusConnexionActif(maintenant = Date.now()) {
  const bonus = getConfigKoyns().bonusConnexion;
  if (!bonus) return null;
  const debut = Date.parse(bonus.debut);
  const fin = Date.parse(bonus.fin);
  if (!(maintenant >= debut && maintenant < fin)) return null;
  return bonus;
}

// -> { koyns, cosmetique } gagnés à cette visite, ou null.
async function reclamerBonusConnexion(discordId) {
  const bonus = bonusConnexionActif();
  if (!bonus || (!bonus.koyns && !bonus.cosmetique)) return null;
  const jour = new Date(debutJournee()).toISOString().slice(0, 10);
  const cle = `${discordId}|${jour}`;
  if (bonusDejaPris.has(cle)) return null;
  bonusDejaPris.add(cle);
  const ajoute = await ajouterMouvement({ discord_id: discordId, montant: bonus.koyns || 0, raison: "connexion", ref: `connexion:${jour}` });
  if (!ajoute) return null;
  if (bonus.cosmetique) {
    await supabase
      .from("cosmetiques_possedes")
      .upsert({ discord_id: discordId, cosmetique: bonus.cosmetique, source: "evenement" }, { onConflict: "discord_id,cosmetique", ignoreDuplicates: true });
  }
  return { koyns: bonus.koyns || 0, cosmetique: bonus.cosmetique || null };
}

module.exports = {
  KOYNS_PAR_MATCH,
  KOYNS_ABANDON,
  MAX_GAMES_PAR_ADVERSAIRE,
  MAX_KOYNS_DON,
  estCosmetique,
  lirePossedes,
  etatKoyns,
  filtrerParametresPossedes,
  acheterCosmetique,
  crediterPartie,
  crediterMatch,
  crediterMatchArchive,
  reprendrePartie,
  donner,
  reclamerBonusConnexion
};
