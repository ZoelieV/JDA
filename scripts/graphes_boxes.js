// Points par perso de chaque box d'un export (site/box.txt : un profil JSON
// par ligne, plus une ligne { boxes: {...} } pour les box fictives), pour
// scripts/graphes_boxes.py. Valeur d'un perso = ses points + sa meilleure
// arme signature de la box (valeursBansBox, site/api/_lib/draft.js).
//
//   node scripts/graphes_boxes.js site/box.txt sortie.json [points.json]
// points.json : réponse de GET /api/points du site (points admin, PPW des
// armes, buffs du théâtre). Sans lui : points des JSON de site/DB (PPW à 0).
const fs = require("fs"), path = require("path");
const [fichierBoxes, fichierSortie, fichierPoints] = process.argv.slice(2);
const lib = path.join(__dirname, "..", "site", "api", "_lib");

// Faux client Supabase : actualiserPoints lit la config dans points.json.
const config = fichierPoints ? JSON.parse(fs.readFileSync(fichierPoints, "utf8")) : null;
require.cache[require.resolve(path.join(lib, "supabase"))] = {
  exports: { supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: config && { data: config }, error: null }) }) }) }) } }
};
const { getPersonnages, getArmes, actualiserPoints } = require(path.join(lib, "personnages"));
const { valeursBansBox, calculerPointsBox, calculerPointsArmesBox } = require(path.join(lib, "draft"));

(async () => {
  if (config) await actualiserPoints();
  const noms = Object.fromEntries(getPersonnages().map(p => [p.groupe || p.id, p.groupe ? "Voyageur" : p.nom]));
  const boxes = [], vus = new Set();
  fs.readFileSync(fichierBoxes, "utf8").split("\n").filter(Boolean).map(JSON.parse).forEach(o => {
    if (o.boxes) return Object.values(o.boxes).forEach(b => boxes.push({ nom: `${b.nom} (fictive)`, data: b.data }));
    const cle = JSON.stringify(o);
    if (vus.has(cle)) return; // doublons de l'export
    vus.add(cle);
    const twitch = o.stream?.match(/twitch\.tv\/([^/?]+)/)?.[1];
    boxes.push({ nom: twitch ? `${twitch} (UID ${o.uid})` : `UID ${o.uid}`, data: o });
  });
  const sortie = boxes.map(b => {
    const avec = valeursBansBox(b.data, "full", getPersonnages(), getArmes(), true);
    const sans = valeursBansBox(b.data, "full", getPersonnages(), getArmes(), false);
    const persos = Object.keys(avec).map(id => ({ id, nom: noms[id] || id, points: avec[id], perso: sans[id] })).sort((a, c) => a.points - c.points);
    // Total de la full box (comme Mon compte et la draft) ; autres = ce que
    // les bâtons ne comptent pas : armes sans perso dans la box (non
    // signatures, signatures de persos absents) et copies en plus.
    const total = calculerPointsBox(b.data, "full", getPersonnages()) + calculerPointsArmesBox(b.data, "full", getArmes());
    return { nom: b.nom, persos, total, autres: total - persos.reduce((s, p) => s + p.points, 0) };
  }).filter(b => b.persos.some(p => p.points > 0));
  fs.writeFileSync(fichierSortie, JSON.stringify(sortie));
  sortie.forEach(b => console.log(`${b.nom} : ${b.persos.length} persos, ${b.total} pts dont ${b.autres} autres, ${b.persos.filter(p => p.points > p.perso).length} signatures`));
})();
