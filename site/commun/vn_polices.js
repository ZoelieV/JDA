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

// Mise en forme d'un texte : **gras**, *italique*, ~~barré~~, combinables. Une
// marque sans sa fermeture reste écrite telle quelle ; \* écrit une vraie
// étoile. -> [{ texte, gras, italique, barre }]
function decouperTexteVn(texte) {
  const CHAMPS = { "**": "gras", "*": "italique", "~~": "barre" };
  const morceaux = String(texte ?? "").split(/(\\[*~\\]|\*\*|\*|~~)/);
  const restantes = {};
  morceaux.forEach(m => { if (CHAMPS[m]) restantes[m] = (restantes[m] || 0) + 1; });
  const etat = { gras: false, italique: false, barre: false };
  const resultat = [];
  const ajouter = valeur => {
    if (!valeur) return;
    const dernier = resultat.at(-1);
    if (dernier && dernier.gras === etat.gras && dernier.italique === etat.italique && dernier.barre === etat.barre) dernier.texte += valeur;
    else resultat.push({ texte: valeur, ...etat });
  };
  morceaux.forEach(m => {
    const champ = CHAMPS[m];
    if (!champ) return ajouter(/^\\[*~\\]$/.test(m) ? m[1] : m);
    // Dernière marque d'un nombre impair : pas de fermeture, écrite telle quelle.
    if (restantes[m] === 1 && !etat[champ]) return ajouter(m);
    restantes[m]--;
    etat[champ] = !etat[champ];
  });
  return resultat;
}

if (typeof module !== "undefined") module.exports = { POLICES_VN, TAILLE_TEXTE_VN, lirePoliceVn, decouperTexteVn };
