const { parseCookies, setCookie, revoquerSession } = require("../_lib/session");
module.exports = async (req, res) => {
  try {
    // Jeton invalidé côté serveur (pas seulement le cookie effacé).
    await revoquerSession(parseCookies(req).session);

    setCookie(res, "session", "", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 0    });

    res.writeHead(302, {
      Location: process.env.AUTH_LOGOUT_REDIRECT || "/"    });
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur déconnexion.");
  }
};