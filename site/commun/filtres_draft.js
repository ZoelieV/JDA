// Filtres et tris de la barre de la draft (matchmaking/match.js) : liste
// commune à la draft, à la Personnalisation (onglet "Filtres et tris en
// Draft", commun/personnalisation.js) et au serveur (api/auth/profile.js).
//
// Choix du joueur, dans son profil (parametres.filtres_draft) :
//   masques : ids des filtres / tris qu'il ne veut pas voir ;
//   figes   : ids de ceux qui restent figés en haut de l'écran sur
//             téléphone quand on fait défiler les persos.
// Pas encore choisi : tout affiché, figés par défaut (fige: true).
//
// logo : image (chemin depuis la racine du site) ou texte à la place.
const FILTRES_DRAFT = [
  { id: "vue", groupe: "filtres", logo: "/DB/images/others/Aether_Icon_Character.webp", nom: "Personnages / Armes",
    description: "N'affiche que les personnages ou que les armes (un seul à la fois, 2e clic pour revenir aux deux).", fige: true },
  { id: "elements", groupe: "filtres", logo: "/DB/images/others/pyro.webp", nom: "Éléments",
    description: "N'affiche que les persos des éléments choisis (plusieurs possibles), regroupés par élément dans l'ordre des clics.", fige: true },
  { id: "armes", groupe: "filtres", logo: "/DB/images/others/sword.webp", nom: "Types d'arme",
    description: "N'affiche que les persos et armes des types choisis (épée, claymore, lance, arc, catalyseur), regroupés par type.", fige: true },
  { id: "etoiles", groupe: "filtres", texte: "5★", nom: "Rareté",
    description: "N'affiche que les 5★, 4★ ou 3★ choisis.", fige: true },
  { id: "voeux", groupe: "filtres", logo: "/DB/images/others/Item_Intertwined_Fate.webp", nom: "Vœux",
    description: "Personnages limités (Intertwined Fate) ou standards (Acquaint Fate : les 4★ et les 5★ de la bannière standard).", fige: true },
  { id: "favoris", groupe: "filtres", logo: "/DB/images/others/favourite.webp", nom: "Favoris",
    description: "N'affiche que tes favoris (choisis dans Mon compte). Seulement quand tu joues le match.", fige: true },
  { id: "proprietaire", groupe: "filtres", texte: "J1", nom: "Joueurs",
    description: "Persos de J1, de J2, que les 2 joueurs ont (=) ou qu'un seul des 2 a (Δ). Pas pendant le choix de box et l'analyse.", fige: true },
  { id: "recherche", groupe: "filtres", texte: "Abc", nom: "Recherche",
    description: "Recherche par nom.", fige: false },
  { id: "clear", groupe: "filtres", logo: "/DB/images/others/remove_filters.webp", nom: "Réinitialiser",
    description: "Retire d'un coup tous les filtres, les tris et la recherche.", fige: false },
  { id: "tri_points", groupe: "tris", logo: "/DB/images/others/scale.webp", nom: "Points",
    description: "Trie par points (perso et arme signature).", fige: false },
  { id: "tri_constellation", groupe: "tris", logo: "/DB/images/others/stella_fortuna_5.webp", nom: "Constellation",
    description: "Trie par constellation (raffinement dans la vue Armes).", fige: false },
  { id: "tri_niveau", groupe: "tris", logo: "/DB/images/others/stella.webp", nom: "Niveau",
    description: "Trie par niveau (95 ou 100).", fige: false },
  { id: "tri_raffinement", groupe: "tris", texte: "R", nom: "Raffinement",
    description: "Trie par raffinement de l'arme signature.", fige: false },
  { id: "tri_rarete", groupe: "tris", texte: "★", nom: "Rareté",
    description: "Trie par rareté (les 5★ standards entre les 4★ et les 5★ limités).", fige: false },
  { id: "tri_element", groupe: "tris", logo: "/DB/images/others/omni_element.webp", nom: "Élément",
    description: "Regroupe par élément (par type d'arme dans la vue Armes).", fige: false },
  { id: "tri_bonus_saison", groupe: "tris", texte: "🌟", nom: "Bonus de saison",
    description: "Persos du bonus de saison d'abord (trophées en plus). Matchs classés seulement.", fige: false }
];

const IDS_FILTRES_DRAFT = FILTRES_DRAFT.map(filtre => filtre.id);

// parametres.filtres_draft -> { masques, figes } (listes triées d'ids
// connus) ; absent : valeurs par défaut.
function lireFiltresDraft(brut) {
  const liste = valeur => [...new Set((Array.isArray(valeur) ? valeur : []).filter(id => IDS_FILTRES_DRAFT.includes(id)))].sort();
  if (!brut || typeof brut !== "object") {
    return { masques: [], figes: FILTRES_DRAFT.filter(filtre => filtre.fige).map(filtre => filtre.id).sort() };
  }
  return { masques: liste(brut.masques), figes: liste(brut.figes) };
}

// Serveur (Node) : liste partagée (cf. api/auth/profile.js).
if (typeof module !== "undefined") module.exports = { FILTRES_DRAFT, lireFiltresDraft };
