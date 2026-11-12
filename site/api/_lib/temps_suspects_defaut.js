// Seuils par défaut des alertes de temps (réglage jamais enregistré dans
// l'admin). Côté serveur seulement : jamais dans un fichier envoyé au
// navigateur. Lus par commun/temps_suspects.js (serveur) et envoyés aux
// administrateurs avec la config (api/points.js).
module.exports = {
  signora_boss: { suspect: 37, triche: 37 },
  raiden_boss: { suspect: 8, triche: 6 },
  scara_boss: { suspect: 101, triche: 100 },
  apep_boss: { suspect: 55, triche: 42 },
  narwhal_boss: { suspect: 40, triche: 16 },
  arle_boss: { suspect: 27, triche: 25 },
  erode_boss: { suspect: 22, triche: 14 },
  dottoreI_boss: { suspect: 38, triche: 21 },
  dottoreII_boss: { suspect: 53, triche: 47 },
  chess_boss: { suspect: 41, triche: 39 }
};
