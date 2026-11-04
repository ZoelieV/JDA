// Personnages à variantes : le Voyageur (Aether / Lumine) et Manekin
// (Manekin / Manekina). Un seul personnage dans characters.json ; le nom,
// l'image et l'icône affichés dépendent du choix du joueur, enregistré dans
// profil.parametres (menu du compte, page Mon compte).

const VARIANTES_PERSONNAGES = {
  traveler: {
    parametre: "voyageur",
    defaut: "aether",
    options: {
      aether: {
        nom: "Aether",
        image: "images/characters/traveler.webp",
        side: "images/characters/side_char/aether_side.webp"
      },
      lumine: {
        nom: "Lumine",
        image: "images/characters/Lumine_Icon.webp",
        side: "images/characters/side_char/lumine_side.webp"
      }
    }
  },
  manekin: {
    parametre: "manekin",
    defaut: "manekin",
    options: {
      manekin: {
        nom: "Manekin",
        image: "images/characters/manekin.webp",
        side: "images/characters/side_char/Manekin_Side_Icon.webp"
      },
      manekina: {
        nom: "Manekina",
        image: "images/characters/Manekina_Icon.webp",
        side: "images/characters/side_char/Manekina_Side_Icon.webp"
      }
    }
  }
};

// Skins : personnages dont le joueur peut choisir le skin (Personnalisation,
// profil.parametres.skins = liste d'ids). Images par id, dans
// DB/images/characters/ : "<id>_skin.webp" (portrait), "side_char/<id>_skin_side.webp"
// (icône de profil), "Item/<id>_skin_item.webp" (choix dans Personnalisation).
// Liste aussi utilisée par le serveur pour valider le profil
// (api/auth/profile.js).
//
// Skins ajoutés depuis la page admin (config.skins_ajoutes, cf. api/points.js,
// admin_ppc/admin_skins.js) : plusieurs possibles par personnage, id
// "<perso>__<nom>" ; un seul skin actif par personnage. Images dans Supabase
// Storage, servies sous /DB/images/skins_ajoutes/ (réécriture de vercel.json).
// Voyageur : un skin par apparence (perso "traveler_aether" ou
// "traveler_lumine"), affiché quand le joueur a choisi cette apparence.
const SKINS_PERSONNAGES = [
  "ayaya", "barbara", "bennett", "charlotte", "citlali", "diluc", "fischl", "ganyu",
  "hutao", "jean", "kaeya", "keqing", "kirara", "klee", "lisa", "neuvillette",
  "nilou", "ningguang", "shenhe", "xiangling", "xingqiu", "yaoyao", "yelan"
];

const REGEX_SKIN_AJOUTE = /^[a-z0-9_]+?__[a-z0-9_]+$/;
const estSkinAjoute = id => typeof id === "string" && REGEX_SKIN_AJOUTE.test(id);
const estSkin = id => SKINS_PERSONNAGES.includes(id) || estSkinAjoute(id);
const persoDuSkin = id => String(id).split("__")[0];
const PERSOS_SKIN_VOYAGEUR = { traveler_aether: "Aether", traveler_lumine: "Lumine" };

// Skins ajoutés connus de la page (lus dans /api/points : pas de requête ici).
let SKINS_AJOUTES = [];
function definirSkinsAjoutes(liste) {
  SKINS_AJOUTES = Array.isArray(liste) ? liste : [];
}

// Nom affiché : "Hu Tao", ou "Hu Tao (Noël)" pour un skin ajouté (nom tiré de
// l'id si le skin n'est pas chargé, masqué par exemple).
function nomSkin(id, nomPerso) {
  if (!estSkinAjoute(id)) return nomPerso;
  nomPerso = PERSOS_SKIN_VOYAGEUR[persoDuSkin(id)] || nomPerso;
  const nom = SKINS_AJOUTES.find(skin => skin.id === id)?.nom
    || id.split("__")[1].replace(/_/g, " ").replace(/^./, lettre => lettre.toUpperCase());
  return `${nomPerso} (${nom})`;
}

function imagesSkin(id) {
  if (estSkinAjoute(id)) {
    return {
      image: `images/skins_ajoutes/${id}/image.webp`,
      side: `images/skins_ajoutes/${id}/side.webp`,
      item: `images/skins_ajoutes/${id}/item.webp`
    };
  }
  return {
    image: `images/characters/${id}_skin.webp`,
    side: `images/characters/side_char/${id}_skin_side.webp`,
    item: `images/characters/Item/${id}_skin_item.webp`
  };
}

// Skin actif d'un personnage (id du skin), ou null. Skin masqué en test
// (parametres.skins_test, envoyé à l'administrateur lui-même seulement, cf.
// api/_lib/skins.js) : passe avant son skin habituel.
function skinActif(id, parametres) {
  const chercher = liste => (Array.isArray(liste) ? liste.find(skin => estSkin(skin) && persoDuSkin(skin) === id) : null) || null;
  return chercher(parametres?.skins_test) || chercher(parametres?.skins);
}

// Personnage tel que le joueur l'a choisi (copie ; les autres sont
// renvoyés tels quels) : variante (Voyageur, Manekin) ou skin.
// Voyageur par élément ("traveler_pyro"...) : même variante, élément ajouté
// au nom ("Aether Pyro").
function appliquerVariante(personnage, parametres) {
  const variante = VARIANTES_PERSONNAGES[personnage.groupe || personnage.id];
  if (!variante) {
    const skin = skinActif(personnage.id, parametres);
    if (!skin) return personnage;
    const { image, side } = imagesSkin(skin);
    return { ...personnage, image, side };
  }
  const cle = variante.options[parametres?.[variante.parametre]] ? parametres[variante.parametre] : variante.defaut;
  const choix = variante.options[cle];
  const nom = personnage.groupe ? `${choix.nom} ${NOMS_ELEMENTS[personnage.element] || ""}`.trim() : choix.nom;
  // Voyageur : skin de l'apparence choisie (cf. PERSOS_SKIN_VOYAGEUR).
  const skin = variante.parametre === "voyageur" ? skinActif(`traveler_${cle}`, parametres) : null;
  if (skin) {
    const { image, side } = imagesSkin(skin);
    return { ...personnage, ...choix, nom, image, side };
  }
  return { ...personnage, ...choix, nom };
}

function appliquerVariantes(personnages, parametres) {
  return personnages.map(personnage => appliquerVariante(personnage, parametres));
}

// Logo "Personnages" des vues et tris (Mon compte, draft, admin) : tête
// du Voyageur choisi par le joueur (profil.parametres.voyageur). Chemin
// depuis DB/.
const ICONES_VUE_PERSONNAGES = {
  aether: "images/others/Aether_Icon_Character.webp",
  lumine: "images/others/Lumine_Icon_Character.webp"
};

function getIconeVuePersonnages(parametres) {
  return ICONES_VUE_PERSONNAGES[parametres?.voyageur] || ICONES_VUE_PERSONNAGES.aether;
}

// Chemin (depuis DB/) de l'icône de profil d'un personnage.
function getIconeLaterale(personnage) {
  return personnage.side || `images/characters/side_char/${personnage.id}_side.webp`;
}

// ---- Groupes : un personnage par élément dans les comptes (Voyageur) ----
// "traveler_pyro"..., champ "groupe" : constellations et points propres à
// chaque élément, niveau commun (niveaux[groupe]). En draft, un seul
// personnage (id = le groupe) dont on choisit l'élément au pick.

const NOMS_ELEMENTS = {
  pyro: "Pyro", hydro: "Hydro", electro: "Electro", cryo: "Cryo",
  anemo: "Anemo", geo: "Geo", dendro: "Dendro"
};

// Manekin : élément choisi au pick parmi tous (non suivi dans les comptes).
const ELEMENTS_LIBRES = { manekin: Object.keys(NOMS_ELEMENTS) };

// Clé du niveau (commun aux éléments d'un groupe).
function cleNiveau(personnage) {
  return personnage.groupe || personnage.id;
}

// Ancien format : un seul "traveler". Sa constellation et ses sélections
// passent au Voyageur Anemo ; son niveau reste sous "traveler" (commun).
// Modifie la collection en place.
function migrerCollectionPersos(collection) {
  if (!collection?.full || collection.full.traveler === undefined) return collection;

  if (collection.full.traveler_anemo === undefined) collection.full.traveler_anemo = collection.full.traveler;
  delete collection.full.traveler;

  Object.values(collection.selections || {}).forEach(selection => {
    if (selection.traveler) {
      selection.traveler_anemo = true;
      delete selection.traveler;
    }
  });
  return collection;
}

// Catalogue de la draft : chaque groupe réduit à un seul personnage.
function regrouperPourDraft(personnages) {
  const vus = new Set();
  return personnages.flatMap(personnage => {
    if (!personnage.groupe) return [personnage];
    if (vus.has(personnage.groupe)) return [];
    vus.add(personnage.groupe);
    const { groupe, ...reste } = personnage;
    return [{ ...reste, id: groupe, element: "all" }];
  });
}

// Membres d'un groupe (catalogue complet), ou [] si ce n'est pas un groupe.
function membresGroupe(personnages, groupe) {
  return personnages.filter(personnage => personnage.groupe === groupe);
}

// Serveur (Node) : listes partagées (cf. api/auth/profile.js).
if (typeof module !== "undefined") module.exports = { VARIANTES_PERSONNAGES, SKINS_PERSONNAGES, PERSOS_SKIN_VOYAGEUR, estSkinAjoute, persoDuSkin, imagesSkin };
