// Recalcule le palier de théâtre enregistré (data.theatre, "1".."4") de
// tous les profils et de toutes les box fictives, après un changement des
// seuils (SEUILS_THEATRE, site/api/_lib/personnages.js). Même calcul que
// l'enregistrement d'un profil (codeTheatre), points admin à jour
// (actualiserPoints). Ne touche ni au reste des données ni à updated_at.
//
// Lancement (depuis BPUC/) :
//   node scripts/maj_paliers_theatre.js           liste les changements
//   node scripts/maj_paliers_theatre.js --ecrire  les enregistre
// Variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY : dans l'environnement
// ou dans scripts/.env (ignoré par git).
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
const { actualiserPoints, codeTheatre, costBox } = require(path.join(site, "personnages"));
const { lireBoxesFictives, ecrireBoxesFictives } = require(path.join(site, "boxes_fictives"));

const NOMS = { 1: "sardine", 2: "carpe", 3: "dauphin", 4: "baleine" };
const nomPalier = code => NOMS[code] || "-";

async function main() {
  const ecrire = process.argv.includes("--ecrire");
  await actualiserPoints();
  const [{ data: profils, error }, fictives] = await Promise.all([
    supabase.from("profiles").select("discord_id, discord_username, discord_global_name, data"),
    lireBoxesFictives()
  ]);
  if (error) throw error;

  let changes = 0;
  for (const profil of profils) {
    if (!profil.data) continue;
    const nouveau = codeTheatre(profil.data);
    if (profil.data.theatre === nouveau) continue;
    changes++;
    console.log(`${profil.discord_global_name || profil.discord_username} : ${nomPalier(profil.data.theatre)} -> ${nomPalier(nouveau)} (cost ${costBox(profil.data)})`);
    if (ecrire) {
      const { error: erreur } = await supabase
        .from("profiles")
        .update({ data: { ...profil.data, theatre: nouveau } })
        .eq("discord_id", profil.discord_id);
      if (erreur) throw erreur;
    }
  }

  let changesFictives = 0;
  Object.values(fictives).forEach(box => {
    const nouveau = codeTheatre(box.data);
    if (!box.data || box.data.theatre === nouveau) return;
    changesFictives++;
    console.log(`[fictive] ${box.nom} : ${nomPalier(box.data.theatre)} -> ${nomPalier(nouveau)} (cost ${costBox(box.data)})`);
    box.data.theatre = nouveau;
  });
  if (ecrire && changesFictives) await ecrireBoxesFictives(fictives);

  console.log(`\n${changes} profil(s), ${changesFictives} box fictive(s) ${ecrire ? "mis à jour" : "à mettre à jour (relancer avec --ecrire)"}.`);
}

main().catch(erreur => {
  console.error(erreur);
  process.exit(1);
});
