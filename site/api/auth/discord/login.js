const crypto = require("crypto");const { setCookie } = require("../../_lib/session");

// Page où revenir après la connexion (?retour=/chemin : la page où le bouton
// a été cliqué, cf. commun/compte.js et my_account.js ; cf. callback.js) :
// chemin du site seulement (pas d'adresse externe), accueil par défaut.
const RETOUR_PAR_DEFAUT = "/";

function retourValide(brut) {
  return typeof brut === "string" && /^\/(?![\/\\])[^\s]*$/.test(brut) && brut.length <= 200 ? brut : RETOUR_PAR_DEFAUT;
}

module.exports = async (req, res) => {
  try {
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_REDIRECT_URI) {
      return res.status(500).send("Variables Discord manquantes.");
    }

    const state = crypto.randomBytes(24).toString("hex");

    setCookie(res, "discord_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 600    });

    const retour = retourValide(new URL(req.url, `https://${req.headers.host}`).searchParams.get("retour"));
    setCookie(res, "discord_oauth_retour", retour, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 600
    });

    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", process.env.DISCORD_REDIRECT_URI);
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);

    res.writeHead(302, { Location: url.toString() });
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur lors du démarrage de la connexion Discord.");
  }
};

module.exports.retourValide = retourValide;