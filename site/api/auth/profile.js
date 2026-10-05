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
  fond: new Set([...cosmetiques.fonds.map(f => f.id), "bg/autres/default_bg.webp"]),
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

function nettoyerProfil(profil) {
  Object.entries(MAX_VITRINE).forEach(([vue, max]) => {
    const vitrine = profil?.[vue]?.selections?.vitrine;
    if (vitrine && typeof vitrine === "object") {
      profil[vue].selections.vitrine = Object.fromEntries(Object.entries(vitrine).slice(0, max));
    }
  });

  if (profil && typeof profil === "object") {
    profil.parametres = nettoyerParametres(profil.parametres);
    const uid = typeof profil.uid === "string" ? profil.uid.trim() : "";
    profil.uid = uidValide(uid) ? uid : "";
    if (!THEATRES.has(String(profil.theatre ?? ""))) profil.theatre = "";
    profil.niveau_monde = NIVEAUX_MONDE.has(String(profil.niveau_monde ?? "")) ? String(profil.niveau_monde ?? "") : "";

    const noms = {};
    BOX_RENOMMABLES.forEach(box => {
      const nom = profil.nomsBoxes?.[box];
      if (typeof nom === "string" && nom.trim()) noms[box] = nom.trim().slice(0, LONGUEUR_NOM_BOX);
    });
    if (Object.keys(noms).length) profil.nomsBoxes = noms;
    else delete profil.nomsBoxes;

    const stream = lienStreamAutorise(profil.stream);
    if (stream) profil.stream = stream;
    else delete profil.stream;
  }
  return profil;
}

function getUser(req) {
  const cookies = parseCookies(req);
  const token = cookies["session"];
  return verifySessionToken(token);
}

module.exports = async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: "Variables Supabase manquantes." });
    }

    const user = getUser(req);
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