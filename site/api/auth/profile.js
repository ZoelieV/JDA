const { parseCookies, verifySessionToken } = require("../_lib/session");
const cosmetiques = require("../../DB/images/cosmetiques.json");
const { SKINS_PERSONNAGES } = require("../../commun/variantes.js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Vitrine : 12 personnages et 12 armes maximum (même limite que
// my_account/my_account.js, MAX_VITRINE) ; au-delà, les suivants sont
// ignorés.
const MAX_VITRINE = { characters: 12, weapons: 12 };
// Noms des box optimisées choisis par le joueur (affichés en draft).
const BOX_RENOMMABLES = ["opti1", "opti2", "opti3", "opti4", "opti5"];
const LONGUEUR_NOM_BOX = 20;

// Affiché aux adversaires pendant la saisie des temps (cf. matchmaking/
// match.js) ; même règle que lienStreamAutorise dans commun/cartes.js.
// Lien de stream : uniquement une page Twitch ou YouTube (pour ne jamais
// envoyer un joueur sur un site malveillant). Domaine exact (pas
// "twitch.tv.exemple.com" ni "exemple.com/twitch.tv"), https, sans
// identifiants ni port ("https://twitch.tv@exemple.com" refusé), ancre
// retirée ; "twitch.tv/pseudo" -> "https://twitch.tv/pseudo".
// -> lien nettoyé, "" si vide, null si refusé.
const HOTES_STREAM = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv", "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const LONGUEUR_LIEN_STREAM = 300;

function lienStreamAutorise(texte) {
  if (typeof texte !== "string") return null;
  let lien = texte.trim();
  if (!lien) return "";
  if (lien.length > LONGUEUR_LIEN_STREAM) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(lien)) lien = `https://${lien}`;
  let url;
  try {
    url = new URL(lien);
  } catch {
    return null;
  }
  const hote = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !HOTES_STREAM.has(hote)) {
    return null;
  }
  return `https://${hote}${url.pathname}${url.search}`;
}

const ERREUR_LIEN_STREAM = "Lien de stream refusé : seuls les liens Twitch (twitch.tv) et YouTube (youtube.com, youtu.be) sont acceptés.";

// Profil envoyé : taille maximale (une box complète pèse quelques dizaines
// de Ko).
const TAILLE_MAX_PROFIL = 512 * 1024;

// Cosmétiques et variantes : valeurs connues seulement. Ces chemins sont
// insérés dans le CSS des pages des autres joueurs (bannière, namecard) :
// une valeur libre permettait d'y injecter du CSS (image externe, etc.).
const PARAMETRES_AUTORISES = {
  banniere: new Set([...cosmetiques.bannieres, "namecards/Namecard_Background_Default.webp"]),
  banniere2: new Set([...cosmetiques.bannieres2, "namecards/banners/Namecard_Banner_Default.webp"]),
  // "perso" : image importée par le joueur, gardée dans son navigateur
  // seulement (cf. commun/fond.js), jamais envoyée au serveur.
  fond: new Set([...cosmetiques.fonds.map(f => f.id), "bg/autres/default_bg.webp", "perso"]),
  voyageur: new Set(["aether", "lumine"]),
  manekin: new Set(["manekin", "manekina"])
};
const THEATRES = new Set(["", "1", "2", "3", "4"]);
// UID Genshin : 9 chiffres (ex. 744102007), ou "" si pas renseigné.
const FORMAT_UID = /^\d{9}$/;
const uidValide = uid => uid === "" || FORMAT_UID.test(uid);
const ERREUR_UID = "UID refusé : 9 chiffres attendus (ex. 744102007).";
// Niveau du monde (1 à 9), ou "" si pas renseigné.
const NIVEAUX_MONDE = new Set(["", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

function nettoyerParametres(parametres) {
  if (!parametres || typeof parametres !== "object") return {};
  const propres = {};
  Object.entries(PARAMETRES_AUTORISES).forEach(([cle, valeurs]) => {
    if (valeurs.has(parametres[cle])) propres[cle] = parametres[cle];
  });
  // Skins : ids connus seulement, sans doublon (cf. commun/variantes.js).
  if (Array.isArray(parametres.skins)) {
    const skins = [...new Set(parametres.skins.filter(id => SKINS_PERSONNAGES.includes(id)))];
    if (skins.length) propres.skins = skins;
  }
  return propres;
}

// ---- Collections (personnages, armes) ----
// Ids des JSON de DB/ (cf. validerEntree dans api/points.js) ; armes : copies
// "idArme#2"... Valeurs : constellation -1 (pas possédé) à 6, raffinement
// -1 à 4 (0 = R1) ; sélections et favoris : true ; niveaux : 95 ou 100.
const FORMAT_ID = /^[a-z0-9_]{1,40}$/;
const FORMAT_INSTANCE = /^[a-z0-9_]{1,40}(#\d{1,3})?$/;
const BOX_SELECTIONS = ["stuff", ...BOX_RENOMMABLES, "vitrine"];
// Bien au-delà du nombre de personnages / armes du jeu.
const MAX_ENTREES_COLLECTION = 2000;
const COLLECTIONS = {
  characters: { formatCle: FORMAT_ID, max: 6, niveaux: true },
  weapons: { formatCle: FORMAT_INSTANCE, max: 4, niveaux: false }
};

const estObjet = valeur => !!valeur && typeof valeur === "object" && !Array.isArray(valeur);
const entierEntre = (min, max) => valeur => Number.isInteger(valeur) && valeur >= min && valeur <= max;
const estVrai = valeur => valeur === true;

// Dictionnaire { clé: valeur } : seulement les clés au bon format et les
// valeurs permises, MAX_ENTREES_COLLECTION au plus.
function nettoyerDictionnaire(brut, formatCle, valeurValide, max = MAX_ENTREES_COLLECTION) {
  if (!estObjet(brut)) return {};
  return Object.fromEntries(Object.entries(brut)
    .filter(([cle, valeur]) => formatCle.test(cle) && valeurValide(valeur))
    .slice(0, max));
}

function nettoyerCollection(brut, vue) {
  const { formatCle, max, niveaux } = COLLECTIONS[vue];
  const source = estObjet(brut) ? brut : {};
  const collection = {
    full: nettoyerDictionnaire(source.full, formatCle, entierEntre(-1, max)),
    selections: Object.fromEntries(BOX_SELECTIONS.map(box => [
      box,
      nettoyerDictionnaire(source.selections?.[box], formatCle, estVrai, box === "vitrine" ? MAX_VITRINE[vue] : undefined)
    ]))
  };
  if (niveaux) collection.niveaux = nettoyerDictionnaire(source.niveaux, FORMAT_ID, valeur => valeur === 95 || valeur === 100);
  const favoris = nettoyerDictionnaire(source.favoris, FORMAT_ID, estVrai);
  if (Object.keys(favoris).length) collection.favoris = favoris;
  return collection;
}

// Profil enregistré : seulement les champs connus du site, aux valeurs
// permises (tout le reste du JSON envoyé est ignoré).
function nettoyerProfil(brut) {
  const uid = typeof brut.uid === "string" ? brut.uid.trim() : "";
  const profil = {
    uid: uidValide(uid) ? uid : "",
    niveau_monde: NIVEAUX_MONDE.has(String(brut.niveau_monde ?? "")) ? String(brut.niveau_monde ?? "") : "",
    theatre: THEATRES.has(String(brut.theatre ?? "")) ? String(brut.theatre ?? "") : "",
    characters: nettoyerCollection(brut.characters, "characters"),
    weapons: nettoyerCollection(brut.weapons, "weapons"),
    parametres: nettoyerParametres(brut.parametres)
  };

  const noms = {};
  BOX_RENOMMABLES.forEach(box => {
    const nom = brut.nomsBoxes?.[box];
    if (typeof nom === "string" && nom.trim()) noms[box] = nom.trim().slice(0, LONGUEUR_NOM_BOX);
  });
  if (Object.keys(noms).length) profil.nomsBoxes = noms;

  const stream = lienStreamAutorise(brut.stream);
  if (stream) profil.stream = stream;

  return profil;
}

async function getUser(req) {
  const cookies = parseCookies(req);
  const token = cookies["session"];
  return await verifySessionToken(token);
}

module.exports = async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: "Variables Supabase manquantes." });
    }

    const user = await getUser(req);
    if (!user) {
      return res.status(401).json({ error: "Non connecté" });
    }

    const discordId = user.id;

    // ---- LECTURE DU PROFIL ----
    if (req.method === "GET") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?discord_id=eq.${discordId}&select=data`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          }
        }
      );

      if (!r.ok) {
        const text = await r.text();
        console.error(text);
        return res.status(500).json({ error: "Erreur lecture profil." });
      }

      const rows = await r.json();
      return res.status(200).json({ profil: rows[0]?.data || null });
    }

    // ---- SAUVEGARDE DU PROFIL ----
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > TAILLE_MAX_PROFIL) {
          return res.status(413).json({ error: "Profil trop volumineux." });
        }
      }

      let profil;
      try {
        profil = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: "JSON invalide." });
      }
      if (!profil || typeof profil !== "object" || Array.isArray(profil)) {
        return res.status(400).json({ error: "Profil invalide." });
      }
      // Lien de stream refusé : enregistrement refusé avec un message (pas
      // effacé en silence).
      if (lienStreamAutorise(profil.stream ?? "") === null) {
        return res.status(400).json({ error: ERREUR_LIEN_STREAM });
      }
      if (!uidValide(typeof profil.uid === "string" ? profil.uid.trim() : "")) {
        return res.status(400).json({ error: ERREUR_UID });
      }
      profil = nettoyerProfil(profil);

      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          discord_id: discordId,
          data: profil,
          updated_at: new Date().toISOString()
        })
      });

      if (!r.ok) {
        const text = await r.text();
        console.error(text);
        return res.status(500).json({ error: "Erreur sauvegarde profil." });
      }

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};