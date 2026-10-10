// Courbes des full box (calibrage de l'équilibrage) : pour chaque box,
// personnages triés du plus cher au moins cher, x = nombre de personnages,
// y = points cumulés (perso + meilleure copie de son arme signature si elle
// est dans la box). Profils des joueurs + box fictives des admins.
//
// Même calcul que le site (valeursBansBox avec signature, _lib/draft.js),
// points admin et buffs du théâtre du mois compris (actualiserPoints).
//
// Lancement (depuis BPUC/) :
//   node scripts/courbes_boxes.js
// Variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY : dans l'environnement
// ou dans scripts/.env (ignoré par git).
// Sortie : scripts/sortie/courbes_boxes.json et courbes_boxes.html.
const fs = require("fs");
const path = require("path");

const fichierEnv = path.join(__dirname, ".env");
if (fs.existsSync(fichierEnv)) {
  fs.readFileSync(fichierEnv, "utf8").split(/\r?\n/).forEach(ligne => {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants (environnement ou scripts/.env).");
  process.exit(1);
}

const site = path.join(__dirname, "..", "site", "api", "_lib");
const { supabase } = require(path.join(site, "supabase"));
const { getPersonnages, getArmes, actualiserPoints } = require(path.join(site, "personnages"));
const { valeursBansBox } = require(path.join(site, "draft"));
const { lireBoxesFictives } = require(path.join(site, "boxes_fictives"));

function courbe(data) {
  const valeurs = valeursBansBox(data, "full", getPersonnages(), getArmes(), true);
  const tries = Object.entries(valeurs).sort((a, b) => b[1] - a[1]);
  let cumul = 0;
  return tries.map(([id, points]) => ({ id, points, cumul: (cumul += points) }));
}

async function main() {
  await actualiserPoints();
  const [{ data: profils, error }, fictives] = await Promise.all([
    supabase.from("profiles").select("discord_id, discord_username, discord_global_name, data"),
    lireBoxesFictives()
  ]);
  if (error) throw error;

  const boxes = [
    ...profils.map(p => ({ id: p.discord_id, nom: p.discord_global_name || p.discord_username, fictive: false, data: p.data })),
    ...Object.entries(fictives).map(([id, b]) => ({ id, nom: b.nom, fictive: true, data: b.data }))
  ]
    .map(b => ({ id: b.id, nom: b.nom, fictive: b.fictive, persos: courbe(b.data) }))
    .filter(b => b.persos.length > 0);

  const sortie = path.join(__dirname, "sortie");
  fs.mkdirSync(sortie, { recursive: true });
  fs.writeFileSync(path.join(sortie, "courbes_boxes.json"), JSON.stringify(boxes, null, 1));
  const gabarit = fs.readFileSync(path.join(__dirname, "courbes_boxes_gabarit.html"), "utf8");
  fs.writeFileSync(path.join(sortie, "courbes_boxes.html"),
    gabarit.replace("/*DONNEES*/[]", JSON.stringify(boxes).replace(/</g, "\\u003c")));
  console.log(`${boxes.length} box (${boxes.filter(b => b.fictive).length} fictives) -> ${sortie}/courbes_boxes.html`);
}

main().catch(erreur => {
  console.error(erreur);
  process.exit(1);
});
