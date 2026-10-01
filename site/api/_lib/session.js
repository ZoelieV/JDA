const crypto = require("crypto");
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
    exp: Date.now() + SESSION_TTL_SECONDS * 1000  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);

  return `${encoded}.${signature}`;
}
function verifySessionToken(token) {
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

  return payload.user;
}
module.exports = {
  SESSION_TTL_SECONDS,
  parseCookies,
  setCookie,
  createSessionToken,
  verifySessionToken
};