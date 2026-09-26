// ---- Équilibrage ----
//
// Nombre de bans bonus accordés au joueur avec la box la plus faible,
// tous les SEUIL_EQUILIBRAGE points d'écart (palier fixe simple pour
// l'instant : floor(ecart / seuil), donc 399 pts d'écart = 1 ban bonus).
//
// Pensé pour rester modulable : si un système à paliers multiples ou non
// linéaires est voulu plus tard, il suffit de remplacer le corps de
// calculerBansBonus() par une lecture de table de paliers — rien d'autre
// dans ce fichier n'a besoin de changer.
const SEUIL_EQUILIBRAGE = 200;

function calculerBansBonus(ecart) {
  return Math.floor(Math.abs(ecart) / SEUIL_EQUILIBRAGE);
}

// ---- Séquence fixe de la draft (hors bans bonus) ----
//
// Décrite en "blocs" pour rester lisible, puis aplatie en actions
// individuelles pour être consommée une à la fois via sequence_index.
const BLOCS_SEQUENCE = [
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "pick", nombre: 1 },
  { joueur: "j2", type: "pick", nombre: 2 },
  { joueur: "j1", type: "pick", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "pick", nombre: 1 },
  { joueur: "j1", type: "pick", nombre: 2 },
  { joueur: "j2", type: "pick", nombre: 1 }
];

const SEQUENCE_FIXE = BLOCS_SEQUENCE.flatMap(bloc =>
  Array.from({ length: bloc.nombre }, () => ({ joueur: bloc.joueur, type: bloc.type }))
);

// ---- État initial d'une manche ----
//
// Déroulé : choix_box (box adverse cachée) -> analyse (les 2 box visibles,
// ready-check) -> bans_bonus (si écart) -> tirage j1/j2 + boss -> draft ->
// temps -> termine. Une revanche (etatRevanche) repart directement en
// "analyse" avec les mêmes box et bans d'équilibrage, rôles inversés.
//
// discord_j1 / discord_j2 : qui est "j1" et "j2". Avant le tirage
// (roles_tires = false) ce ne sont que des places provisoires (créateur de
// la room en j1, cf. _lib/room.js) ; le tirage les échange ou non au hasard
// (lancerTirage). En revanche, ils sont échangés sans tirage.
function etatInitialDraft() {
  return {
    phase: "choix_box", // choix_box -> analyse -> bans_bonus (si écart) -> draft -> temps -> termine
    discord_j1: null,
    discord_j2: null,
    roles_tires: false, // true une fois j1/j2 définitifs pour la manche
    boss_precedent_id: null, // boss de la manche précédente, exclu du tirage
    box_j1: null,
    box_j2: null,
    pret_j1: false,
    pret_j2: false,
    points_j1: null,
    points_j2: null,
    bans_bonus_total: 0,
    bans_bonus_faits: 0,
    bans_bonus_joueur: null, // "j1" | "j2" | null si pas d'écart suffisant
    bans_bonus_choix: [], // ids en cours de sélection, pas encore confirmés
    boss_id: null,
    pool_disponible: null, // liste d'ids (union), remplie une fois les 2 joueurs prêts
    pool_j1: null, // ids possédés par j1 (sa Full box) — restreint ses picks
    pool_j2: null, // ids possédés par j2 (sa Full box) — restreint ses picks
    actions: [], // { joueur, type: "ban" | "pick", perso_id, bonus: bool }
    sequence_index: 0,
    temps_j1: null, // { affiche: "mm:ss", secondes: number } une fois saisi
    temps_j2: null,
    vainqueur: null, // "j1" | "j2" | "egalite" une fois les 2 temps rentrés
    rejouer_j1: false, // ready-check pour la revanche, même principe que pret_j1/pret_j2
    rejouer_j2: false
  };
}

// ---- Points d'une box (uniquement personnages / PPC) ----
function calculerPointsBox(profilData, boxChoisie, personnages) {
  const collection = profilData?.characters || { full: {}, selections: {} };
  let total = 0;

  personnages.forEach(personnage => {
    const valeur = collection.full?.[personnage.id] ?? -1;
    if (valeur < 0) return;

    if (boxChoisie !== "full") {
      const inclus = collection.selections?.[boxChoisie]?.[personnage.id];
      if (!inclus) return;
    }

    total += Number(personnage.PPC?.[valeur] ?? 0);
  });

  return total;
}

// ---- Pool d'un joueur (tout ce qu'il possède, peu importe la box choisie
// pour l'équilibrage : on regarde sa Full box) ----
function calculerPoolJoueur(profilData, personnages) {
  const full = profilData?.characters?.full || {};
  return personnages
    .filter(p => (full[p.id] ?? -1) >= 0)
    .map(p => p.id);
}

// ---- Pool de personnages draftables (union des 2 joueurs) ----
//
// Seuls les personnages possédés par AU MOINS un des 2 joueurs sont
// proposables au ban/pick. Le reste du catalogue n'a simplement pas
// d'intérêt en draft puisque personne ne peut le jouer. Les PICKS restent
// ensuite individuellement restreints à pool_j1 / pool_j2 (cf. handleAction) :
// on ne peut jouer que ce qu'on possède, même si l'adversaire l'a banni.
function calculerPoolDisponible(poolJ1, poolJ2) {
  return Array.from(new Set([...poolJ1, ...poolJ2]));
}

// ---- Prochaine action attendue ----
//
// Retourne { joueur, type, bonus } ou null si rien n'est attendu dans la
// phase actuelle (draft terminée, ou bans bonus épuisés en attente de
// passage à la phase suivante).
function getProchaineAction(draft) {
  if (draft.phase === "bans_bonus") {
    if (draft.bans_bonus_faits < draft.bans_bonus_total) {
      return { joueur: draft.bans_bonus_joueur, type: "ban", bonus: true };
    }
    return null;
  }

  if (draft.phase === "draft") {
    const action = SEQUENCE_FIXE[draft.sequence_index];
    if (!action) return null;
    return { ...action, bonus: false };
  }

  return null;
}

// ---- Échange des rôles j1 <-> j2 ----
//
// Échange toutes les paires de champs *_j1 / *_j2 et tout ce qui désigne
// un rôle ("j1"/"j2"), pour que chaque donnée reste attachée au même
// joueur. Sert au tirage (si le hasard inverse les places provisoires) et
// à la revanche.
function echangerRoles(draft) {
  Object.keys(draft)
    .filter(cle => cle.endsWith("_j1"))
    .forEach(cleJ1 => {
      const cleJ2 = cleJ1.slice(0, -3) + "_j2";
      const tmp = draft[cleJ1];
      draft[cleJ1] = draft[cleJ2];
      draft[cleJ2] = tmp;
    });

  const inverser = role => (role === "j1" ? "j2" : role === "j2" ? "j1" : role);
  draft.bans_bonus_joueur = inverser(draft.bans_bonus_joueur);
  draft.vainqueur = inverser(draft.vainqueur);
  draft.actions = (draft.actions || []).map(a => ({ ...a, joueur: inverser(a.joueur) }));
}

// ---- Tirage : rôles j1/j2 (1re manche seulement) puis boss ----
//
// Appelé après l'analyse (si aucun ban bonus n'est dû) ou une fois les
// bans bonus confirmés. En revanche, roles_tires est déjà vrai : seul le
// boss est tiré, différent de celui de la manche précédente.
function lancerTirage(draft, tirerBossAleatoire) {
  if (!draft.roles_tires) {
    if (Math.random() < 0.5) echangerRoles(draft);
    draft.roles_tires = true;
  }

  const boss = tirerBossAleatoire(draft.boss_precedent_id || null);
  draft.boss_id = boss.id;
  draft.phase = "draft";
  draft.sequence_index = 0;
}

// ---- Revanche ----
//
// Mêmes box, points, pools et bans d'équilibrage (déjà confirmés) que la
// manche terminée ; rôles inversés ; retour direct en phase "analyse".
function etatRevanche(precedent) {
  const bansBonus = (precedent.actions || []).filter(a => a.bonus);
  const bannis = new Set(bansBonus.map(a => a.perso_id));

  const suivant = {
    ...etatInitialDraft(),
    phase: "analyse",
    discord_j1: precedent.discord_j1,
    discord_j2: precedent.discord_j2,
    roles_tires: true,
    boss_precedent_id: precedent.boss_id,
    box_j1: precedent.box_j1,
    box_j2: precedent.box_j2,
    points_j1: precedent.points_j1,
    points_j2: precedent.points_j2,
    pool_j1: precedent.pool_j1,
    pool_j2: precedent.pool_j2,
    pool_disponible: calculerPoolDisponible(precedent.pool_j1 || [], precedent.pool_j2 || [])
      .filter(id => !bannis.has(id)),
    bans_bonus_total: precedent.bans_bonus_total,
    bans_bonus_faits: precedent.bans_bonus_faits,
    bans_bonus_joueur: precedent.bans_bonus_joueur,
    actions: bansBonus
  };

  echangerRoles(suivant);
  return suivant;
}

// ---- Vue d'un joueur ----
//
// Pendant le choix des box, la box de l'adversaire n'est pas envoyée
// (seul son statut "prêt" l'est) : elle ne se découvre qu'en analyse.
function vuePourJoueur(draft, joueur) {
  if (draft.phase !== "choix_box") return draft;
  const autre = joueur === "j1" ? "j2" : "j1";
  return { ...draft, [`box_${autre}`]: null };
}

// ---- Équipe (picks) d'un joueur, reconstruite depuis l'historique ----
function getEquipeJoueur(draft, joueur) {
  return draft.actions
    .filter(a => a.type === "pick" && a.joueur === joueur)
    .map(a => a.perso_id);
}

module.exports = {
  SEUIL_EQUILIBRAGE,
  SEQUENCE_FIXE,
  calculerBansBonus,
  etatInitialDraft,
  calculerPointsBox,
  calculerPoolJoueur,
  calculerPoolDisponible,
  getProchaineAction,
  echangerRoles,
  lancerTirage,
  etatRevanche,
  vuePourJoueur,
  getEquipeJoueur
};