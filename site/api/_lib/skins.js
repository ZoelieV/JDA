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
// seulement (en-tête vérifié), pas seulement annoncé comme tel. partiel :
// images absentes permises (modification d'un skin).
function decoderImagesSkin(brutes, { partiel = false } = {}) {
  const tampons = {};
  for (const cle of IMAGES) {
    if (partiel && brutes?.[cle] == null) continue;
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

// Nouveau skin : une image refusée, celles déjà envoyées sont retirées.
// Modification (remplacement) : les images du skin restent en place.
async function televerserImagesSkin(id, tampons, { remplacement = false } = {}) {
  const { supabase } = require("./supabase");
  try {
    for (const cle of Object.keys(tampons)) {
      const { error } = await supabase.storage.from(DOSSIER).upload(`${id}/${cle}.webp`, tampons[cle], {
        contentType: "image/webp",
        // Court : une image remplacée garde la même adresse (cf. vercel.json).
        cacheControl: "300",
        upsert: true
      });
      if (error) throw error;
    }
  } catch (erreur) {
    if (!remplacement) await supprimerImagesSkin(id).catch(console.error);
    throw erreur;
  }
}

// Retire le skin aux joueurs : plus porté, plus possédé, et achat annulé (le
// solde étant la somme des mouvements, supprimer la ligne d'achat rembourse
// le prix payé, et permet de racheter un skin recréé sous le même id). Rien à
// rembourser pour un skin reçu en don ou au tirage.
async function retirerSkinAuxJoueurs(id, cosmetique) {
  const { supabase } = require("./supabase");
  const { data: profils, error: erreurProfils } = await supabase.from("profiles")
    .select("discord_id, data").contains("data", { parametres: { skins: [id] } });
  if (erreurProfils) throw erreurProfils;
  for (const { discord_id: discordId, data } of profils || []) {
    const parametres = { ...data.parametres, skins: data.parametres.skins.filter(skin => skin !== id) };
    const { error } = await supabase.from("profiles").update({ data: { ...data, parametres } }).eq("discord_id", discordId);
    if (error) throw error;
  }
  const { error: erreurAchats } = await supabase.from("koyns_mouvements").delete().eq("raison", "achat").eq("ref", `achat:${cosmetique}`);
  if (erreurAchats) throw erreurAchats;
  const { error: erreurPossedes } = await supabase.from("cosmetiques_possedes").delete().eq("cosmetique", cosmetique);
  if (erreurPossedes) throw erreurPossedes;
}

module.exports = { LONGUEUR_NOM_SKIN, idSkinAjoute, decoderImagesSkin, televerserImagesSkin, supprimerImagesSkin, retirerSkinAuxJoueurs };
