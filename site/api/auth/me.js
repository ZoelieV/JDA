const { parseCookies, verifySessionToken } = require("../_lib/session");
const { estAdmin, estMiniAdmin, estShadowban } = require("../_lib/admin");
const { actualiserPoints } = require("../_lib/personnages");
const { reclamerBonusConnexion } = require("../_lib/koyns");
module.exports = async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const user = await verifySessionToken(cookies.session);

    if (!user) {
      return res.status(401).json({
        authenticated: false      });
    }

    // Bonus de connexion d'un événement (config.bonus_connexion, cache
    // 30 s) : gagné à la première visite de la journée, annoncé par la page
    // (cf. commun/compte.js).
    await actualiserPoints();
    const bonus = await reclamerBonusConnexion(user.id);

    return res.status(200).json({
      authenticated: true,
      ...(bonus ? { bonus_connexion: bonus } : {}),
      // admin : accès à la page d'administration des points (carte de l'accueil).
      // mini_admin : même page en lecture seule, litiges et bans du classé.
      // theorycraft : accès à la page Theorycraft (tout connecté sauf les
      // shadowbans, cf. sql/shadowbans.sql).
      user: {
        ...user,
        admin: estAdmin(user.id),
        mini_admin: !estAdmin(user.id) && await estMiniAdmin(user.id),
        theorycraft: !await estShadowban(user.id)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ authenticated: false });
  }
};