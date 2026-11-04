// Polices du visual novel : toutes celles de DB/fonts (déclarées dans
// visual_novel/lecteur.css, téléchargées seulement si un panneau s'en sert).
// Taille : en % de la hauteur de la scène, pour rester proportionnée à tous
// les écrans.
const POLICES_VN = [
  { id: "classic", nom: "Classic", famille: "Classic" },
  { id: "titre", nom: "Titre", famille: "Titre" },
  { id: "titre_site", nom: "Titre du site", famille: "Titre site" },
  { id: "rubik", nom: "Rubik", famille: "VN Rubik" },
  { id: "mermaid", nom: "Mermaid", famille: "VN Mermaid" },
  { id: "teyvat", nom: "Teyvat", famille: "VN Teyvat" },
  { id: "celestial", nom: "Céleste", famille: "VN Celestial" },
  { id: "deshret", nom: "Deshret", famille: "VN Deshret" },
  { id: "fontaine", nom: "Fontaine", famille: "VN Fontaine" },
  { id: "inazuma", nom: "Inazuma", famille: "VN Inazuma" },
  { id: "latin", nom: "Latin", famille: "VN Latin" },
  { id: "sumeru", nom: "Sumeru", famille: "VN Sumeru" }
];

const TAILLE_TEXTE_VN = { min: 2, defaut: 4, max: 12 };

// Police d'un panneau, valeurs inconnues remplacées par celles par défaut.
function lirePoliceVn(brut) {
  const taille = Number(brut?.taille);
  return {
    famille: POLICES_VN.some(p => p.id === brut?.famille) ? brut.famille : POLICES_VN[0].id,
    taille: Number.isFinite(taille) ? Math.min(TAILLE_TEXTE_VN.max, Math.max(TAILLE_TEXTE_VN.min, taille)) : TAILLE_TEXTE_VN.defaut,
    gras: brut?.gras === true,
    italique: brut?.italique === true
  };
}

if (typeof module !== "undefined") module.exports = { POLICES_VN, TAILLE_TEXTE_VN, lirePoliceVn };
