const { parseCookies, verifySessionToken } = require("../_lib/session");
const { estAdmin, estMiniAdmin, estShadowban } = require("../_lib/admin");
const { actualiserPoints } = require("../_lib/personnages");
const { reclamerBonusConnexion, lireNouveautes } = require("../_lib/koyns");
const { noterConnexion } = require("../_lib/statistiques");
module.exports = async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const user = await verifySessionToken(cookies.session);

    if (!user) {
      return res.status(401).json({
        authenticated: false      });
    }

    // Bonus de connexion d'un événement (config.bonus_connexion, cache
    // 30 s) : gagné à la première visite de la journée.
    await actualiserPoints();
    // Connexion du jour (statistiques, une écriture par jour au plus) et
    // bonus de l'événement.
    await Promise.all([reclamerBonusConnexion(user.id), noterConnexion(user.id)]);

    // Récompenses reçues depuis la dernière visite (?depuis=<date ISO>,
    // gardée par le navigateur) : fenêtre de commun/compte.js. Sans date
    // (1re visite sur ce navigateur) : rien, juste la date du serveur.
    const depuis = new URL(req.url, "http://x").searchParams.get("depuis");
    const maintenant = new Date().toISOString();
    const nouveautes = depuis ? await lireNouveautes(user.id, depuis) : null;

    return res.status(200).json({
      authenticated: true,
      maintenant,
      ...(nouveautes ? { nouveautes } : {}),
      // admin : accès à la page d'administration des points (carte de l'accueil).
      // mini_admin : même page en lecture seule, litiges et bans du classé.
      // theorycraft : accès à la page Theorycraft (tout connecté sauf les
      // shadowbans).
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