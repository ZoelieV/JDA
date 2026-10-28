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
// - Tirage (TIRAGE_PRIX par tirage, cf. tirerCosmetique) : une namecard,
//   une bannière ou un fond d'écran pas encore possédé, au hasard ; ou, 1
//   fois sur TIRAGE_CHANCE_FOCUS (garanti au TIRAGE_GARANTIE-ième tirage
//   sans focus), un cosmétique focus (config.cosmetiques_tirage : obtenables
//   seulement par tirage, pas en vente).
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
const TIRAGE_PRIX = 10;
const TIRAGE_CHANCE_FOCUS = 0.1;
const TIRAGE_GARANTIE = 10;

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
const estTirage = id => getConfigKoyns().tirage.includes(id);
// Cosmétiques cachés (cosmetiques.json, "caches") : ni en vente ni dans le
// tirage normal ; donnés par les administrateurs (dons, récompenses, focus).
const CACHES = new Set(cosmetiques.caches || []);

// Gains possibles d'un tirage hors focus : namecards, bannières et fonds
// payants (ni gratuits, ni exclusifs, ni focus, ni Mon image).
function poolTirage() {
  const { exclusifs, tirage } = getConfigKoyns();
  return [
    ...cosmetiques.fonds.map(fond => idCosmetique("fond", fond.id)),
    ...cosmetiques.bannieres.map(chemin => idCosmetique("banniere", chemin)),
    ...cosmetiques.bannieres2.map(chemin => idCosmetique("banniere2", chemin))
  ].filter(id => !COSMETIQUES_GRATUITS.has(id) && !exclusifs.has(id) && !tirage.includes(id) && !CACHES.has(id));
}
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

// Tirages faits depuis le dernier focus gagné (garantie ; même calcul que
// tirer_cosmetique).
async function lireCompteurTirage(discordId) {
  const { data: focus } = await supabase.from("cosmetiques_possedes").select("obtenu_le")
    .eq("discord_id", discordId).eq("source", "tirage_focus").order("obtenu_le", { ascending: false }).limit(1);
  let requete = supabase.from("koyns_mouvements").select("id", { count: "exact", head: true })
    .eq("discord_id", discordId).eq("raison", "tirage");
  if (focus?.[0]) requete = requete.gt("cree_le", focus[0].obtenu_le);
  const { count, error } = await requete;
  if (error) console.error("Erreur lecture koyns_mouvements :", error);
  return count || 0;
}

// État envoyé à la page de personnalisation.
async function etatKoyns(discordId) {
  const [solde, possedes, compteur] = await Promise.all([lireSolde(discordId), lirePossedes(discordId), lireCompteurTirage(discordId)]);
  return {
    solde,
    tout: possedes === null,
    possedes: possedes ? [...possedes] : [],
    exclusifs: [...getConfigKoyns().exclusifs],
    tirage: {
      prix: TIRAGE_PRIX,
      chance: TIRAGE_CHANCE_FOCUS,
      garantie: TIRAGE_GARANTIE,
      focus: getConfigKoyns().tirage,
      compteur
    }
  };
}

// Un tirage. -> { cosmetique, focus, compteur } ou { erreur, status }.
async function tirerCosmetique(discordId) {
  await lireSolde(discordId); // Rikoyns de départ (administrateur, mini admin), avant le tirage.
  const { data, error } = await supabase.rpc("tirer_cosmetique", {
    p_discord_id: discordId,
    p_prix: TIRAGE_PRIX,
    p_normaux: poolTirage(),
    p_focus: getConfigKoyns().tirage.filter(estCosmetique),
    p_chance: TIRAGE_CHANCE_FOCUS,
    p_garantie: TIRAGE_GARANTIE
  });
  if (error) {
    console.error("Erreur tirage de cosmétique :", error);
    return { status: 500, erreur: "Tirage indisponible pour l'instant." };
  }
  if (data?.statut === "solde") return { status: 409, erreur: `Il faut ${TIRAGE_PRIX} Rikoyns pour un tirage : joue des matchs pour en gagner.` };
  if (data?.statut === "vide") return { status: 409, erreur: "Tu as déjà tous les cosmétiques du tirage !" };
  return { cosmetique: data.cosmetique, focus: !!data.focus, compteur: data.compteur };
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
  if (estTirage(id)) return { status: 403, erreur: "Cosmétique focus du tirage : il ne s'obtient que par tirage." };
  if (CACHES.has(id)) return { status: 403, erreur: "Ce cosmétique ne s'achète pas." };
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

// Don d'un administrateur : Rikoyns (positif ou négatif) et / ou
// cosmétiques (un ou plusieurs).
async function donner(discordId, { koyns = 0, cosmetiques = [] }, admin) {
  if (koyns) {
    await ajouterMouvement({ discord_id: discordId, montant: koyns, raison: "don", ref: `don:${admin}:${Date.now()}` });
  }
  if (cosmetiques.length) {
    const { error } = await supabase
      .from("cosmetiques_possedes")
      .upsert(cosmetiques.map(cosmetique => ({ discord_id: discordId, cosmetique, source: "don" })), { onConflict: "discord_id,cosmetique", ignoreDuplicates: true });
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

// ---- Notifications (fenêtre des récompenses, cf. commun/compte.js) ----
// Rikoyns et cosmétiques reçus depuis la dernière visite (date "depuis"
// gardée par le navigateur, NOUVEAUTES_MAX_MS au plus en arrière) : gains
// positifs seulement (pas les achats, ni les reprises).
const NOUVEAUTES_MAX_MS = 7 * 24 * 3600 * 1000;
const RAISONS_NOTIFIEES = ["match", "don", "connexion", "depart", "tournoi"];

// Aperçu d'un cosmétique reçu : { id, type, image } (image : sous DB/).
function apercuCosmetique(id) {
  const [choix, ...reste] = String(id).split("#")[0].split(":");
  const valeur = reste.join(":");
  if (choix === "fond") {
    const fond = cosmetiques.fonds.find(f => f.id === valeur);
    return { id, type: "Fond d'écran", image: fond ? `images/${fond.miniature || fond.image}` : null };
  }
  if (choix === "banniere") return { id, type: "Namecard", image: `images/${valeur}` };
  if (choix === "banniere2") return { id, type: "Bannière", image: `images/${valeur}` };
  if (choix === "skin") return { id, type: "Skin", image: `images/characters/${valeur}_skin.webp` };
  return { id, type: "Cosmétique", image: null };
}

// -> { koyns: { raison: { total, nb } }, cosmetiques: [aperçu] }, ou null
// si rien de nouveau.
async function lireNouveautes(discordId, depuis) {
  const date = Math.max(Date.parse(depuis) || 0, Date.now() - NOUVEAUTES_MAX_MS);
  const debut = new Date(date).toISOString();
  const [mouvements, recus] = await Promise.all([
    // Victoire de tournoi : mouvement à 0 (cf. noterVictoireTournoi).
    supabase.from("koyns_mouvements").select("montant, raison, ref")
      .eq("discord_id", discordId).gt("cree_le", debut).gte("montant", 0).in("raison", RAISONS_NOTIFIEES),
    supabase.from("cosmetiques_possedes").select("cosmetique")
      .eq("discord_id", discordId).gt("obtenu_le", debut).not("source", "in", "(achat,tirage,tirage_focus)")
  ]);
  if (mouvements.error) console.error("Erreur lecture koyns_mouvements :", mouvements.error);
  if (recus.error) console.error("Erreur lecture cosmetiques_possedes :", recus.error);
  const koyns = {};
  const idsTournois = [];
  (mouvements.data || []).forEach(({ montant, raison, ref }) => {
    if (raison === "tournoi") {
      idsTournois.push(String(ref).replace(/^tournoi:/, ""));
      return;
    }
    if (montant <= 0) return;
    koyns[raison] ??= { total: 0, nb: 0 };
    koyns[raison].total += montant;
    koyns[raison].nb += 1;
  });
  // Tournois gagnés : nom et récompense annoncée (table points).
  let tournois = [];
  if (idsTournois.length) {
    const { data } = await supabase.from("points").select("data").in("id", idsTournois.map(id => `tournoi:${id}`));
    tournois = (data || []).map(ligne => ({ id: ligne.data.id, nom: ligne.data.nom, recompense: ligne.data.recompense || null }));
  }
  const cosmetiquesRecus = (recus.data || []).map(ligne => apercuCosmetique(ligne.cosmetique));
  if (!Object.keys(koyns).length && !cosmetiquesRecus.length && !tournois.length) return null;
  return { koyns, cosmetiques: cosmetiquesRecus, tournois };
}

// Victoire d'un tournoi : mouvement à 0 Rikoyn (une fois par joueur et par
// tournoi), pour la fenêtre des récompenses (cf. lireNouveautes).
async function noterVictoireTournoi(discordIds, tournoiId) {
  for (const discordId of discordIds) {
    await ajouterMouvement({ discord_id: discordId, montant: 0, raison: "tournoi", ref: `tournoi:${tournoiId}` });
  }
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
  reclamerBonusConnexion,
  lireNouveautes,
  tirerCosmetique,
  noterVictoireTournoi
};
