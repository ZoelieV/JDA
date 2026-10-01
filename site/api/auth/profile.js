const { parseCookies, verifySessionToken } = require("../_lib/session");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Vitrine : 12 personnages et 12 armes maximum (même limite que
// my_account/my_account.js, MAX_VITRINE) ; au-delà, les suivants sont
// ignorés.
const MAX_VITRINE = { characters: 12, weapons: 12 };
// Noms des box optimisées choisis par le joueur (affichés en draft).
const BOX_RENOMMABLES = ["opti1", "opti2", "opti3", "opti4", "opti5"];
const LONGUEUR_NOM_BOX = 20;

// Lien de stream (Twitch, YouTube...) affiché aux adversaires pendant la
// saisie des temps : http(s) seulement ("twitch.tv/x" -> "https://..."),
// sinon retiré (pas de lien javascript: ou autre).
const LONGUEUR_LIEN_STREAM = 300;

function nettoyerLienStream(texte) {
  if (typeof texte !== "string") return null;
  let lien = texte.trim();
  if (!lien) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(lien)) lien = `https://${lien}`;
  try {
    const url = new URL(lien);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    return url.href.slice(0, LONGUEUR_LIEN_STREAM);
  } catch {
    return null;
  }
}

function nettoyerProfil(profil) {
  Object.entries(MAX_VITRINE).forEach(([vue, max]) => {
    const vitrine = profil?.[vue]?.selections?.vitrine;
    if (vitrine && typeof vitrine === "object") {
      profil[vue].selections.vitrine = Object.fromEntries(Object.entries(vitrine).slice(0, max));
    }
  });

  if (profil && typeof profil === "object") {
    const noms = {};
    BOX_RENOMMABLES.forEach(box => {
      const nom = profil.nomsBoxes?.[box];
      if (typeof nom === "string" && nom.trim()) noms[box] = nom.trim().slice(0, LONGUEUR_NOM_BOX);
    });
    if (Object.keys(noms).length) profil.nomsBoxes = noms;
    else delete profil.nomsBoxes;

    const stream = nettoyerLienStream(profil.stream);
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
      }

      let profil;
      try {
        profil = nettoyerProfil(JSON.parse(body));
      } catch {
        return res.status(400).json({ error: "JSON invalide." });
      }

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