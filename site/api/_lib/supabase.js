const { createClient } = require("@supabase/supabase-js");

// Aléas passagers de Supabase (offre gratuite), relancés une fois :
// - jeton interne "émis dans le futur" (401 PGRST303, "JWT issued at
//   future", léger décalage d'horloge de leur côté) : la même requête
//   réussit un instant plus tard (DELAI_REESSAI_MS) ;
// - requête bloquée de 15 s à plus d'une minute alors que les autres
//   passent en 0,15 s : une lecture (GET, HEAD) sans réponse au bout de
//   DELAI_LECTURE_MS est abandonnée et relancée. Jamais les écritures (pas
//   de double insertion si la première est passée).
const DELAI_REESSAI_MS = 1000;
const DELAI_LECTURE_MS = 8000;

function avecDelai(options, ms) {
  const signal = AbortSignal.timeout(ms);
  return { ...options, signal: options?.signal ? AbortSignal.any([options.signal, signal]) : signal };
}

async function fetchAvecReessai(url, options = {}) {
  const lecture = ["GET", "HEAD"].includes((options.method || "GET").toUpperCase());
  let reponse;
  try {
    reponse = await fetch(url, lecture ? avecDelai(options, DELAI_LECTURE_MS) : options);
  } catch (erreur) {
    // Délai dépassé (pas une annulation demandée par l'appelant) : 2e essai.
    if (!lecture || erreur?.name !== "TimeoutError" || options.signal?.aborted) throw erreur;
    console.error("Lecture Supabase sans réponse, nouvel essai :", String(url).split("?")[0]);
    return fetch(url, options);
  }
  if (reponse.status !== 401) return reponse;
  const texte = await reponse.clone().text().catch(() => "");
  if (!texte.includes("PGRST303")) return reponse;
  await new Promise(resoudre => setTimeout(resoudre, DELAI_REESSAI_MS));
  return fetch(url, options);
}

// Client Supabase partagé, pour éviter de le recréer dans chaque route.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { global: { fetch: fetchAvecReessai } }
);

module.exports = { supabase, fetchAvecReessai };
