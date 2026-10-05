const crypto = require("crypto");
const { supabase } = require("./supabase");
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  header.split(";").forEach(part => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const index = trimmed.indexOf("=");
    if (index === -1) return;

    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);

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

// Sessions révoquées (déconnexion) : table sessions_revoquees (cf.
// sql/sessions_revoquees.sql), relue au plus toutes les 30 s ; une session
// déconnectée peut donc encore servir jusqu'à 30 s. Table absente (SQL pas
// lancé) : aucune révocation (erreur journalisée).
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

// Utilisateur de la session (cookie "session"), ou null si absente,
// invalide, expirée ou révoquée.
async function verifySessionToken(token) {
  const session = lireSessionToken(token);
  if (!session) return null;
  if (session.jti && await estRevoquee(session.jti)) return null;
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
  revoquerSession
};