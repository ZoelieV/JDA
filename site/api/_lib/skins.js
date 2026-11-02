// Skins ajoutés depuis la page admin (config.skins_ajoutes, cf. api/points.js
// et admin_ppc/admin_skins.js) : id "<perso>__<nom>", images WebP (déjà
// converties et réduites par le navigateur de l'admin) dans le dossier public
// "skins" de Supabase Storage, servies sous /DB/images/skins_ajoutes/ (cf.
// vercel.json, imagesSkin dans commun/variantes.js).

const DOSSIER = "skins";
const IMAGES = ["image", "side", "item"];
const POIDS_MAX_IMAGE = 400 * 1024;
const LONGUEUR_NOM_SKIN = 30;

// Id du skin (nom sans accents ni caractères spéciaux), ou null si le nom ne
// contient ni lettre ni chiffre.
function idSkinAjoute(perso, nom) {
  const suite = nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return suite ? `${perso}__${suite}` : null;
}

// { image, side, item } en data URL -> { tampons } ou { erreur }. Vrai WebP
// seulement (en-tête vérifié), pas seulement annoncé comme tel.
function decoderImagesSkin(brutes) {
  const tampons = {};
  for (const cle of IMAGES) {
    const correspondance = typeof brutes?.[cle] === "string" && /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(brutes[cle]);
    if (!correspondance) return { erreur: "Images du skin invalides (WebP attendu)" };
    const tampon = Buffer.from(correspondance[1], "base64");
    if (tampon.length > POIDS_MAX_IMAGE) return { erreur: "Image du skin trop lourde" };
    if (tampon.toString("latin1", 0, 4) !== "RIFF" || tampon.toString("latin1", 8, 12) !== "WEBP") {
      return { erreur: "Images du skin invalides (WebP attendu)" };
    }
    tampons[cle] = tampon;
  }
  return { tampons };
}

async function supprimerImagesSkin(id) {
  const { supabase } = require("./supabase");
  const { error } = await supabase.storage.from(DOSSIER).remove(IMAGES.map(cle => `${id}/${cle}.webp`));
  if (error) throw error;
}

// Une image refusée : celles déjà envoyées sont retirées.
async function televerserImagesSkin(id, tampons) {
  const { supabase } = require("./supabase");
  try {
    for (const cle of IMAGES) {
      const { error } = await supabase.storage.from(DOSSIER).upload(`${id}/${cle}.webp`, tampons[cle], {
        contentType: "image/webp",
        cacheControl: "86400",
        upsert: true
      });
      if (error) throw error;
    }
  } catch (erreur) {
    await supprimerImagesSkin(id).catch(console.error);
    throw erreur;
  }
}

module.exports = { LONGUEUR_NOM_SKIN, idSkinAjoute, decoderImagesSkin, televerserImagesSkin, supprimerImagesSkin };
