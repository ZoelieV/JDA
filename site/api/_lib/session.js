const crypto = require("crypto");
const { supabase } = require("./supabase");
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
// Requête qui modifie quelque chose (POST, PUT, PATCH, DELETE) envoyée
// depuis un autre site (CSRF) : en-tête Sec-Fetch-Site "cross-site" ou
// Origin d'un autre hôte. En plus du SameSite=Lax du cookie.
function estRequeteAutreSite(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return true;
  const origine = req.headers.origin;
  if (!origine || origine === "null") return !!origine;
  try {
    const hote = new URL(origine).host;
    return hote !== req.headers.host && hote !== req.headers["x-forwarded-host"];
  } catch {
    return true;
  }
}

// Cookies de la requête ; pour une requête d'un autre site (cf.
// estRequeteAutreSite), sans le cookie "session" : elle est traitée comme
// venant d'un visiteur non connecté.
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  const autreSite = estRequeteAutreSite(req);

  header.split(";").forEach(part => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const index = trimmed.indexOf("=");
    if (index === -1) return;

    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (autreSite && key === "session") return;

    // Valeur mal encodée : cookie ignoré (pas d'erreur 500).
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // ignoré
    }
  });

  return cookies;
}
function serializeCookie(name, value, options = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}`;

  cookie += `; Path=${options.path || "/"}`;

  if (options.maxAge !== undefined) {
    cookie += `; Max-Age=${options.maxAge}`;
  }

  if (options.httpOnly) {
    cookie += "; HttpOnly";
  }

  if (options.secure) {
    cookie += "; Secure";
  }

  if (options.sameSite) {
    cookie += `; SameSite=${options.sameSite}`;
  }

  return cookie;
}
function setCookie(res, name, value, options = {}) {
  const cookie = serializeCookie(name, value, options);
  const existing = res.getHeader("Set-Cookie");

  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
    return;
  }

  res.setHeader("Set-Cookie", [existing, cookie]);
}
function sign(data) {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET manquant");
  }

  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(data)
    .digest("base64url");
}
function createSessionToken(user) {
  const payload = {
    user,
    // Identifiant de la session : révoquée à la déconnexion (cf.
    // revoquerSession).
    jti: crypto.randomBytes(16).toString("base64url"),
    exp: Date.now() + SESSION_TTL_SECONDS * 1000  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);

  return `${encoded}.${signature}`;
}
// Jeton signé et pas expiré -> son contenu { user, jti, exp }, sinon null.
function lireSessionToken(token) {
  if (!token) {
    return null;
  }

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = sign(encoded);

  const sigA = Buffer.from(signature);
  const sigB = Buffer.from(expected);

  if (sigA.length !== sigB.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(sigA, sigB)) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

  if (!payload.exp || Date.now() > payload.exp) {
    return null;
  }

  return payload;
}

// Sessions révoquées (déconnexion) : table sessions_revoquees, relue
// au plus toutes les 30 s ; une session déconnectée peut donc encore servir
// jusqu'à 30 s. Table absente : aucune révocation (erreur journalisée).
const CACHE_REVOCATIONS_MS = 30 * 1000;
let cacheRevocations = null;

async function estRevoquee(jti) {
  if (!cacheRevocations || Date.now() - cacheRevocations.lu > CACHE_REVOCATIONS_MS) {
    const { data, error } = await supabase
      .from("sessions_revoquees")
      .select("jti")
      .gt("expire_le", new Date().toISOString());
    if (error) console.error("Erreur lecture sessions_revoquees :", error);
    cacheRevocations = { jtis: new Set((data || []).map(ligne => ligne.jti)), lu: Date.now() };
  }
  return cacheRevocations.jtis.has(jti);
}

// Joueurs bannis du site (sanction de type "site", en cours : fin nulle =
// définitive) : plus de connexion (cf. api/auth/discord/callback.js) et
// leurs sessions ne valent plus rien, donc aucun match possible. Un ban vise
// un compte Discord (discord_id) ou un UID Genshin (uid) : tous les comptes
// dont le profil porte cet UID sont bannis, et un compte qui essaie de le
// renseigner l'est aussi (cf. api/auth/profile.js). Relus au plus toutes les
// 30 s, comme les révocations ; en cas d'erreur de lecture, la liste
// précédente reste en place (un ban ne saute pas sur une panne).
let cacheBannis = null;

async function lireBannis() {
  if (cacheBannis && Date.now() - cacheBannis.lu <= CACHE_REVOCATIONS_MS) return cacheBannis;
  const { data, error } = await supabase
    .from("sanctions")
    .select("discord_id, uid, fin")
    .eq("type", "site");
  if (error) {
    console.error("Erreur lecture des bans du site :", error);
    if (cacheBannis) return cacheBannis;
  }
  const maintenant = Date.now();
  const actifs = (data || []).filter(s => s.fin === null || Date.parse(s.fin) > maintenant);
  const ids = new Set(actifs.filter(s => s.discord_id).map(s => String(s.discord_id)));
  const uids = new Set(actifs.filter(s => s.uid).map(s => String(s.uid)));
  if (uids.size) {
    const { data: profils, error: erreurProfils } = await supabase.from("profiles").select("discord_id").in("data->>uid", [...uids]);
    if (erreurProfils) console.error("Erreur lecture des comptes aux UID bannis :", erreurProfils);
    (profils || []).forEach(p => ids.add(String(p.discord_id)));
  }
  cacheBannis = { ids, uids, lu: Date.now() };
  return cacheBannis;
}

async function estBanniSite(discordId) {
  return (await lireBannis()).ids.has(String(discordId));
}

async function estUidBanni(uid) {
  return !!uid && (await lireBannis()).uids.has(String(uid));
}

// Après un nouveau ban : relu à la prochaine demande (sur cette instance),
// l'ancienne liste restant en secours si la lecture échoue.
function oublierBannis() {
  if (cacheBannis) cacheBannis.lu = 0;
}

// Utilisateur de la session (cookie "session"), ou null si absente,
// invalide, expirée, révoquée ou d'un joueur banni du site.
async function verifySessionToken(token) {
  const session = lireSessionToken(token);
  if (!session) return null;
  if (session.jti && await estRevoquee(session.jti)) return null;
  if (session.user?.id && await estBanniSite(session.user.id)) return null;
  return session.user;
}

// Déconnexion : session révoquée jusqu'à son expiration (un cookie copié
// ne sert plus). Jeton invalide ou plus ancien (sans jti) : rien à faire.
async function revoquerSession(token) {
  const session = lireSessionToken(token);
  if (!session?.jti) return;
  const { error } = await supabase
    .from("sessions_revoquees")
    .upsert({ jti: session.jti, expire_le: new Date(session.exp).toISOString() });
  if (error) {
    console.error("Erreur révocation de session :", error);
    return;
  }
  cacheRevocations?.jtis.add(session.jti);
  // Ménage : révocations expirées supprimées.
  await supabase.from("sessions_revoquees").delete().lt("expire_le", new Date().toISOString());
}
module.exports = {
  SESSION_TTL_SECONDS,
  parseCookies,
  setCookie,
  createSessionToken,
  verifySessionToken,
  revoquerSession,
  estBanniSite,
  estUidBanni,
  oublierBannis
};