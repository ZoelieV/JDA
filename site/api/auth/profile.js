const { parseCookies, verifySessionToken } = require("../_lib/session");
const { codeTheatre, actualiserPoints } = require("../_lib/personnages");
const { verifierFrequenceCompte } = require("../_lib/limites");
const { etatKoyns, lirePossedes, filtrerParametresPossedes, acheterCosmetique, tirerCosmetique } = require("../_lib/koyns");
const cosmetiques = require("../../DB/images/cosmetiques.json");
const { SKINS_PERSONNAGES } = require("../../commun/variantes.js");
const { lireFiltresDraft } = require("../../commun/filtres_draft.js");
const { TAILLE_FLEX } = require("../../commun/koyns.js");

const { fetchAvecReessai, supabase } = require("../_lib/supabase");
const { memoriser } = require("../_lib/memo");
const { rejouerClasse, chargerMatchsClasses, tropheesSaison } = require("../_lib/trophees");
const { saisonActuelle } = require("../_lib/saisons");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Vitrines (2, "vitrine" et "vitrine2") : 12 personnages et 12 armes
// maximum chacune (même limite que my_account/my_account.js, MAX_VITRINE) ;
// au-delà, les suivants sont ignorés.
const MAX_VITRINE = { characters: 12, weapons: 12 };
const BOX_VITRINES = ["vitrine", "vitrine2"];
// Noms des box optimisées et des vitrines choisis par le joueur (affichés
// en draft pour les box optimisées).
const BOX_RENOMMABLES = ["opti1", "opti2", "opti3", "opti4", "opti5", ...BOX_VITRINES];
const LONGUEUR_NOM_BOX = 20;
// Panier de la personnalisation : cosmétiques achetés en une fois au plus.
const MAX_PANIER = 50;
const DELAI_BOUTIQUE_MS = 1000;

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

// Enregistrements du profil : un toutes les 5 s au plus par compte (quota
// Supabase protégé d'un envoi en boucle).
const DELAI_ENREGISTREMENT_MS = 5 * 1000;

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
  manekin: new Set(["manekin", "manekina"]),
  // Affichage de la page d'accueil (gratuit) : "classique" (par défaut),
  // "panneau" ou "cartes" (cf. accueil.js).
  accueil: new Set(["classique", "panneau", "cartes"])
};
// UID Genshin : 9 chiffres (ex. 744102007), ou "" si pas renseigné.
const FORMAT_UID = /^\d{9}$/;
const uidValide = uid => uid === "" || FORMAT_UID.test(uid);
const ERREUR_UID = "UID refusé : 9 chiffres attendus (ex. 744102007).";
// Niveau du monde (1 à 9), ou "" si pas renseigné.
const NIVEAUX_MONDE = new Set(["", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

// UID et lien de stream : renseignés une seule fois (plus modifiables
// ensuite). Niveau du monde : plus haut niveau enregistré gardé
// (niveau_monde_max, champ du serveur) ; on peut monter autant qu'on veut,
// descendre d'un cran au plus sous ce maximum (comme dans le jeu), jamais
// l'effacer. -> message d'erreur, ou null.
function niveauMondeMax(ancien) {
  return Math.max(Number(ancien?.niveau_monde_max) || 0, Number(ancien?.niveau_monde) || 0);
}

function erreurChampsDefinitifs(ancien, profil) {
  if (ancien?.uid && profil.uid !== ancien.uid) return "UID déjà renseigné : il ne peut plus être modifié.";
  if (ancien?.stream && (profil.stream || "") !== ancien.stream) return "Lien de stream déjà renseigné : il ne peut plus être modifié.";
  const max = niveauMondeMax(ancien);
  if (max && !profil.niveau_monde) return "Niveau du monde déjà renseigné : il ne peut plus être effacé.";
  if (max && Number(profil.niveau_monde) < max - 1) return `Niveau du monde : ${max - 1} minimum (un cran sous ton plus haut niveau enregistré, ${max}).`;
  return null;
}

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
  // Filtres et tris de la draft affichés / figés : ids connus seulement (cf.
  // commun/filtres_draft.js).
  if (parametres.filtres_draft && typeof parametres.filtres_draft === "object") {
    propres.filtres_draft = lireFiltresDraft(parametres.filtres_draft);
  }
  // Flex cosmétiques : TAILLE_FLEX emplacements, cosmétiques connus (pas
  // Mon image, gardée dans le navigateur), sans doublon, ou null. Possédés :
  // vérifié ensuite (filtrerParametresPossedes).
  if (Array.isArray(parametres.flex)) {
    const vus = new Set();
    const flex = Array.from({ length: TAILLE_FLEX }, (_, i) => {
      const id = parametres.flex[i];
      if (typeof id !== "string" || vus.has(id) || !cosmetiqueFlexValide(id)) return null;
      vus.add(id);
      return id;
    });
    if (flex.some(Boolean)) propres.flex = flex;
  }
  return propres;
}

function cosmetiqueFlexValide(id) {
  const [choix, ...reste] = id.split(":");
  const valeur = reste.join(":");
  if (choix === "skin") return SKINS_PERSONNAGES.includes(valeur);
  return ["fond", "banniere", "banniere2", "voyageur", "manekin"].includes(choix) && valeur !== "perso" && PARAMETRES_AUTORISES[choix].has(valeur);
}

// ---- Collections (personnages, armes) ----
// Ids des JSON de DB/ (cf. validerEntree dans api/points.js) ; armes : copies
// "idArme#2"... Valeurs : constellation -1 (pas possédé) à 6, raffinement
// -1 à 4 (0 = R1) ; sélections et favoris : true ; niveaux : 95 ou 100.
const FORMAT_ID = /^[a-z0-9_]{1,40}$/;
const FORMAT_INSTANCE = /^[a-z0-9_]{1,40}(#\d{1,3})?$/;
const BOX_SELECTIONS = ["stuff", ...BOX_RENOMMABLES];
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
      nettoyerDictionnaire(source.selections?.[box], formatCle, estVrai, BOX_VITRINES.includes(box) ? MAX_VITRINE[vue] : undefined)
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
    characters: nettoyerCollection(brut.characters, "characters"),
    weapons: nettoyerCollection(brut.weapons, "weapons"),
    parametres: nettoyerParametres(brut.parametres)
  };

  // Palier de théâtre ("1".."4") : calculé sur le cost de la full box,
  // plus choisi par le joueur (cf. palierTheatre, _lib/personnages.js).
  profil.theatre = codeTheatre(profil);

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

    // Palier de théâtre : calculé avec les points à jour (cf. palierTheatre).
    const [user] = await Promise.all([getUser(req), actualiserPoints()]);
    if (!user) {
      return res.status(401).json({ error: "Non connecté" });
    }

    const discordId = user.id;

    // ---- LECTURE DU PROFIL ----
    if (req.method === "GET") {
      const r = await fetchAvecReessai(
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
      const data = rows[0]?.data || null;
      // Palier de théâtre recalculé (profil enregistré avant le calcul
      // automatique, ou catalogue changé depuis). Rikoyns : solde et
      // cosmétiques possédés (personnalisation, cf. _lib/koyns.js).
      // Trophées de la saison en cours (rang sur le bouton du compte, cf.
      // commun/fond.js), null sans match classé ; matchs classés gardés
      // 30 s en mémoire (lu à chaque page).
      const matchsClasses = await memoriser("matchs_classes", 30 * 1000, () => chargerMatchsClasses(supabase));
      const trophees = tropheesSaison(rejouerClasse(matchsClasses).parSaison, await saisonActuelle()).get(discordId) ?? null;
      return res.status(200).json({
        profil: data ? { ...data, theatre: codeTheatre(data), trophees } : null,
        koyns: await etatKoyns(discordId)
      });
    }

    // ---- TIRAGE DE COSMÉTIQUES (?action=tirer, { nombre: 1 | 10 }) ----
    // Tirages un par un (garantie comptée à chacun) ; arrêt au premier refus
    // (solde, plus rien à gagner) : tirages déjà faits gardés, avec le
    // message (arret).
    // Tirages et achats : une requête par seconde au plus par compte (chaque
    // requête fait jusqu'à 10 tirages ou MAX_PANIER achats).
    const actionBoutique = new URL(req.url, "http://x").searchParams.get("action");
    if (req.method === "POST" && ["tirer", "acheter"].includes(actionBoutique)) {
      const attente = await verifierFrequenceCompte(discordId, "boutique", DELAI_BOUTIQUE_MS);
      if (attente > 0) return res.status(429).json({ error: "Doucement : une action par seconde au plus." });
    }

    if (req.method === "POST" && new URL(req.url, "http://x").searchParams.get("action") === "tirer") {
      const nombre = req.body?.nombre === 10 ? 10 : 1;
      const tirages = [];
      let arret = null;
      for (let i = 0; i < nombre; i++) {
        const resultat = await tirerCosmetique(discordId);
        if (resultat.erreur) {
          if (!tirages.length) return res.status(resultat.status).json({ error: resultat.erreur });
          arret = resultat.erreur;
          break;
        }
        tirages.push(resultat);
      }
      return res.status(200).json({ tirage: tirages[0], tirages, arret, koyns: await etatKoyns(discordId) });
    }

    // ---- ACHAT DE COSMÉTIQUES (?action=acheter, { cosmetique } ou panier
    // { cosmetiques: [ids] }, MAX_PANIER au plus, achetés dans l'ordre ;
    // arrêt au premier refus : achetes = ceux déjà payés) ----
    if (req.method === "POST" && new URL(req.url, "http://x").searchParams.get("action") === "acheter") {
      const panier = Array.isArray(req.body?.cosmetiques) ? [...new Set(req.body.cosmetiques)] : [req.body?.cosmetique];
      if (!panier.length || panier.length > MAX_PANIER) return res.status(400).json({ error: `Panier : ${MAX_PANIER} cosmétiques au plus.` });
      const achetes = [];
      for (const id of panier) {
        const resultat = await acheterCosmetique(discordId, id);
        if (!resultat.ok) {
          return res.status(resultat.status).json({ error: resultat.erreur, achetes, koyns: await etatKoyns(discordId) });
        }
        achetes.push(id);
      }
      return res.status(200).json({ achetes, koyns: await etatKoyns(discordId) });
    }

    // ---- SAUVEGARDE DU PROFIL ----
    if (req.method === "POST") {
      const lireAncien = () => fetchAvecReessai(
        `${SUPABASE_URL}/rest/v1/profiles?discord_id=eq.${discordId}&select=data`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
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
      // UID, stream, niveau du monde : cf. erreurChampsDefinitifs.
      const reponseAncien = await lireAncien();
      if (!reponseAncien.ok) {
        console.error(await reponseAncien.text());
        return res.status(500).json({ error: "Erreur lecture profil." });
      }
      const ancien = (await reponseAncien.json())[0]?.data || null;
      const erreurDefinitif = erreurChampsDefinitifs(ancien, profil);
      if (erreurDefinitif) return res.status(400).json({ error: erreurDefinitif });
      const max = Math.max(niveauMondeMax(ancien), Number(profil.niveau_monde) || 0);
      if (max) profil.niveau_monde_max = max;
      // Cosmétiques pas possédés : retirés (retour au choix par défaut).
      profil.parametres = filtrerParametresPossedes(profil.parametres, await lirePossedes(discordId));

      // Profil valide seulement : un envoi refusé ne compte pas.
      const attente = await verifierFrequenceCompte(discordId, "profil", DELAI_ENREGISTREMENT_MS);
      if (attente > 0) {
        res.setHeader("Retry-After", String(Math.ceil(attente / 1000)));
        return res.status(429).json({ error: `Un enregistrement toutes les ${DELAI_ENREGISTREMENT_MS / 1000} s au maximum : réessaie dans ${Math.ceil(attente / 1000)} s.` });
      }

      const r = await fetchAvecReessai(`${SUPABASE_URL}/rest/v1/profiles`, {
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

// Box fictives (api/accounts/[discord_id].js) : même nettoyage des données.
module.exports.nettoyerProfil = nettoyerProfil;
// Modification par un admin (UID, stream, niveau du monde, cf.
// api/accounts/[discord_id].js) : mêmes formats.
Object.assign(module.exports, { uidValide, lienStreamAutorise, NIVEAUX_MONDE, ERREUR_UID, ERREUR_LIEN_STREAM });
