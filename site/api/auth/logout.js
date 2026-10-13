const { parseCookies, setCookie, revoquerSession } = require("../_lib/session");
// POST seulement (pas un simple lien qu'un autre site pourrait ouvrir) :
// la page redirige ensuite vers { redirection }.
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Méthode non autorisée" });
    }

    // Jeton invalidé côté serveur (pas seulement le cookie effacé).
    await revoquerSession(parseCookies(req).session);

    setCookie(res, "session", "", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 0    });

    return res.status(200).json({ redirection: process.env.AUTH_LOGOUT_REDIRECT || "/" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur déconnexion." });
  }
};