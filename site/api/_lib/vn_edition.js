// Éditeur du visual novel (visual_novel/editeur.html), vrais administrateurs :
//   GET ?vn_edition=1  histoire, date de version et avertissements
//   GET ?vn_images=1   images importées et place occupée
//   POST { vn_sauvegarde: { histoire, maj } }  enregistre ; refusé si un autre
//                      admin a enregistré depuis la version chargée (maj)
//   POST { vn_import: { data } }  image WebP en data URL -> { chemin }
//   POST { vn_import_son: { data } }  MP3 ou OGG en data URL -> { chemin }
//   POST { vn_image_suppression: { chemin } }  image ou son ; refusé si
//                      l'histoire s'en sert
//   POST { vn_reinitialiser: true }  efface sa propre progression
// Images dans le dossier public "visual_novel" de Supabase Storage, servies
// sous /DB/images/vn/ (cf. vercel.json), nommées d'après leur contenu : la même
// image importée deux fois ne prend qu'une place. Sons limités à 3 Mo comme les
// images : une requête Vercel ne dépasse pas 4,5 Mo, base64 compris.
const crypto = require("crypto");
const { supabase } = require("./supabase");
const { ID_HISTOIRE } = require("./visual_novel");
const { lireHistoireVn, avertissementsVn } = require("./vn_format");
const HISTOIRE_ESSAI = require("./vn_histoire_essai");

const DOSSIER = "visual_novel";
const POIDS_MAX_IMAGE = 3 * 1024 * 1024;
// Forfait gratuit : 1 Go de stockage pour tout le site.
const POIDS_MAX_TOTAL = 300 * 1024 * 1024;
const PREFIXE = "vn/";

const REQUETES_POST = ["vn_sauvegarde", "vn_import", "vn_import_son", "vn_image_suppression", "vn_reinitialiser"];

function estRequeteEdition(req) {
  if (req.method === "GET") return req.query?.vn_edition === "1" || req.query?.vn_images === "1";
  return req.method === "POST" && REQUETES_POST.some(cle => req.body?.[cle]);
}

async function lireLigne() {
  const { data, error } = await supabase.from("vn_histoires").select("data, maj").eq("id", ID_HISTOIRE).maybeSingle();
  if (error) throw error;
  return data;
}

async function listerImages() {
  const { data, error } = await supabase.storage.from(DOSSIER).list("", { limit: 1000 });
  if (error) throw error;
  const fichiers = (data || []).filter(f => /\.(webp|mp3|ogg)$/.test(f.name));
  return {
    images: fichiers.filter(f => f.name.endsWith(".webp")).map(f => `${PREFIXE}${f.name}`),
    poids: fichiers.reduce((total, f) => total + (f.metadata?.size || 0), 0),
    poids_max: POIDS_MAX_TOTAL
  };
}

async function sauvegarder(discordId, { histoire: brute, maj }) {
  const { histoire, erreur } = lireHistoireVn(brute, ID_HISTOIRE);
  if (erreur) return { status: 400, corps: { error: erreur } };
  const ligne = await lireLigne();
  if ((ligne?.maj ?? null) !== (maj ?? null)) {
    return { status: 409, corps: { error: "Un autre administrateur a enregistré depuis : recharge la page pour récupérer sa version." } };
  }
  const { data, error } = await supabase.from("vn_histoires")
    .upsert({ id: ID_HISTOIRE, data: histoire, public: histoire.public, maj: new Date().toISOString(), maj_par: discordId })
    .select("maj")
    .single();
  if (error) throw error;
  return { status: 200, corps: { maj: data.maj, avertissements: avertissementsVn(histoire) } };
}

async function importerImage({ data }) {
  const correspondance = typeof data === "string" && /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!correspondance) return { status: 400, corps: { error: "Image invalide (WebP attendu)" } };
  const tampon = Buffer.from(correspondance[1], "base64");
  if (tampon.length > POIDS_MAX_IMAGE) return { status: 400, corps: { error: "Image trop lourde (3 Mo au plus)" } };
  if (tampon.toString("latin1", 0, 4) !== "RIFF" || tampon.toString("latin1", 8, 12) !== "WEBP") {
    return { status: 400, corps: { error: "Image invalide (WebP attendu)" } };
  }
  return televerser(tampon, "webp", "image/webp");
}

async function importerSon({ data }) {
  const correspondance = typeof data === "string" && /^data:audio\/(mpeg|ogg);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!correspondance) return { status: 400, corps: { error: "Son invalide (MP3 ou OGG attendu)" } };
  const tampon = Buffer.from(correspondance[2], "base64");
  if (tampon.length > POIDS_MAX_IMAGE) return { status: 400, corps: { error: "Son trop lourd (3 Mo au plus)" } };
  const estMp3 = tampon.toString("latin1", 0, 3) === "ID3" || (tampon[0] === 0xff && (tampon[1] & 0xe0) === 0xe0);
  const estOgg = tampon.toString("latin1", 0, 4) === "OggS";
  if (correspondance[1] === "mpeg" ? !estMp3 : !estOgg) return { status: 400, corps: { error: "Son invalide (MP3 ou OGG attendu)" } };
  return correspondance[1] === "mpeg" ? televerser(tampon, "mp3", "audio/mpeg") : televerser(tampon, "ogg", "audio/ogg");
}

async function televerser(tampon, extension, contentType) {
  const { poids } = await listerImages();
  if (poids + tampon.length > POIDS_MAX_TOTAL) return { status: 400, corps: { error: "Plus de place : supprime des images importées qui ne servent plus." } };
  const nom = `${crypto.createHash("sha256").update(tampon).digest("hex").slice(0, 24)}.${extension}`;
  const { error } = await supabase.storage.from(DOSSIER).upload(nom, tampon, {
    contentType,
    // Adresse tirée du contenu : elle ne change jamais d'image.
    cacheControl: "31536000",
    upsert: true
  });
  if (error) throw error;
  return { status: 200, corps: { chemin: `${PREFIXE}${nom}` } };
}

async function supprimerImage({ chemin }) {
  if (typeof chemin !== "string" || !/^vn\/[a-f0-9]{24}\.(?:webp|mp3|ogg)$/.test(chemin)) return { status: 400, corps: { error: "Fichier invalide" } };
  const ligne = await lireLigne();
  // Sans la liste des sons de l'histoire, qui n'est qu'un catalogue.
  const { sons, ...utilise } = ligne?.data || {};
  if (JSON.stringify(utilise).includes(chemin)) return { status: 409, corps: { error: "L'histoire enregistrée se sert de ce fichier." } };
  const { error } = await supabase.storage.from(DOSSIER).remove([chemin.slice(PREFIXE.length)]);
  if (error) throw error;
  return { status: 200, corps: { ok: true } };
}

async function traiterEdition(req, discordId) {
  if (req.method === "GET") {
    if (req.query.vn_images === "1") return { status: 200, corps: await listerImages() };
    const ligne = await lireLigne();
    // Tous les champs remplis, même sur l'histoire d'essai écrite à la main.
    const { histoire } = lireHistoireVn(ligne?.data || HISTOIRE_ESSAI, ID_HISTOIRE);
    return { status: 200, corps: { histoire, maj: ligne?.maj ?? null, avertissements: avertissementsVn(histoire) } };
  }
  const corps = req.body;
  if (corps.vn_sauvegarde) return sauvegarder(discordId, corps.vn_sauvegarde);
  if (corps.vn_import) return importerImage(corps.vn_import);
  if (corps.vn_import_son) return importerSon(corps.vn_import_son);
  if (corps.vn_image_suppression) return supprimerImage(corps.vn_image_suppression);
  const { error } = await supabase.from("vn_parties").delete().eq("discord_id", discordId);
  if (error) throw error;
  return { status: 200, corps: { ok: true } };
}

module.exports = { estRequeteEdition, traiterEdition };
