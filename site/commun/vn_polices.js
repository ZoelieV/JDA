// Polices du visual novel : toutes celles de DB/fonts (déclarées dans
// visual_novel/lecteur.css, téléchargées seulement si un panneau s'en sert),
// et celles importées par l'admin (histoire.polices : [{ id, nom, chemin }],
// id commençant par "police_", chargées par visual_novel/scene.js).
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
// importees : histoire.polices (une police importée puis supprimée redevient Classic).
function lirePoliceVn(brut, importees = []) {
  const taille = Number(brut?.taille);
  const connue = POLICES_VN.some(p => p.id === brut?.famille) || (importees || []).some(p => p.id === brut?.famille);
  return {
    famille: connue ? brut.famille : POLICES_VN[0].id,
    taille: Number.isFinite(taille) ? Math.min(TAILLE_TEXTE_VN.max, Math.max(TAILLE_TEXTE_VN.min, taille)) : TAILLE_TEXTE_VN.defaut,
    gras: brut?.gras === true,
    italique: brut?.italique === true
  };
}

// Mise en forme d'un texte : **gras**, *italique*, ~~barré~~, combinables, et
// {7}texte{/} pour une autre taille (même échelle que la taille du panneau).
// Une marque sans sa fermeture reste écrite telle quelle ; \* ou \{ écrit le
// vrai caractère. -> [{ texte, gras, italique, barre, taille (null = celle du panneau) }]
function decouperTexteVn(texte) {
  const CHAMPS = { "**": "gras", "*": "italique", "~~": "barre" };
  const morceaux = String(texte ?? "").split(/(\\[*~{\\]|\*\*|\*|~~|\{\d{1,2}(?:[.,]5)?\}|\{\/\})/);
  const restantes = {};
  morceaux.forEach(m => { if (CHAMPS[m] || m === "{/}") restantes[m] = (restantes[m] || 0) + 1; });
  const etat = { gras: false, italique: false, barre: false, taille: null };
  const resultat = [];
  const ajouter = valeur => {
    if (!valeur) return;
    const dernier = resultat.at(-1);
    if (dernier && ["gras", "italique", "barre", "taille"].every(c => dernier[c] === etat[c])) dernier.texte += valeur;
    else resultat.push({ texte: valeur, ...etat });
  };
  morceaux.forEach(m => {
    if (m === "{/}") {
      restantes[m]--;
      if (etat.taille === null) return ajouter(m);
      etat.taille = null;
      return;
    }
    if (/^\{[\d.,]+\}$/.test(m)) {
      // Taille sans {/} plus loin : écrite telle quelle.
      if (!restantes["{/}"]) return ajouter(m);
      const taille = Number(m.slice(1, -1).replace(",", "."));
      etat.taille = Math.min(TAILLE_TEXTE_VN.max, Math.max(TAILLE_TEXTE_VN.min, taille));
      return;
    }
    const champ = CHAMPS[m];
    if (!champ) return ajouter(/^\\[*~{\\]$/.test(m) ? m[1] : m);
    // Dernière marque d'un nombre impair : pas de fermeture, écrite telle quelle.
    if (restantes[m] === 1 && !etat[champ]) return ajouter(m);
    restantes[m]--;
    etat[champ] = !etat[champ];
  });
  return resultat;
}

if (typeof module !== "undefined") module.exports = { POLICES_VN, TAILLE_TEXTE_VN, lirePoliceVn, decouperTexteVn };
