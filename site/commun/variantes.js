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

// Personnage tel que le joueur l'a choisi (copie ; les autres sont
// renvoyés tels quels).
function appliquerVariante(personnage, parametres) {
  const variante = VARIANTES_PERSONNAGES[personnage.id];
  if (!variante) return personnage;
  const choix = variante.options[parametres?.[variante.parametre]] || variante.options[variante.defaut];
  return { ...personnage, ...choix };
}

function appliquerVariantes(personnages, parametres) {
  return personnages.map(personnage => appliquerVariante(personnage, parametres));
}

// Chemin (depuis DB/) de l'icône de profil d'un personnage.
function getIconeLaterale(personnage) {
  return personnage.side || `images/characters/side_char/${personnage.id}_side.webp`;
}
