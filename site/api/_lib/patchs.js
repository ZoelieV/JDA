// Patchs d'équilibrage, notés par les administrateurs (fenêtre Patchs de la page
// Équilibrage) et affichés dans l'onglet Patchs de Theorycraft.
//
// Ligne à part de la table "points" (pas dans la config, lue par toutes les
// pages) : l'historique grandit, seule Theorycraft en a besoin.
//   { patchs: [{ id, date: "AAAA-MM-JJ", lignes: [{ perso, avant, apres, explication }] }] }
// avant et apres sont du texte : "10", mais aussi "C2 : 10" ou "10 / 20".
const crypto = require("crypto");
const { supabase } = require("./supabase");

const LIGNE = "patchs";
const MAX_PATCHS = 200;
const MAX_LIGNES = 100;
const LONGUEUR_POINTS = 40;
const LONGUEUR_EXPLICATION = 500;

const texte = valeur => (typeof valeur === "string" ? valeur.trim() : "");

function dateValide(valeur) {
  if (typeof valeur !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const date = new Date(`${valeur}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
}

async function lirePatchs() {
  const { data, error } = await supabase.from("points").select("data").eq("id", LIGNE).maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.data?.patchs) ? data.data.patchs : [];
}

async function ecrirePatchs(patchs, auteur) {
  const { error } = await supabase.from("points").upsert({
    id: LIGNE,
    data: { patchs },
    updated_at: new Date().toISOString(),
    updated_by: auteur
  });
  if (error) throw error;
}

// Plus récent d'abord ; même date : le dernier créé d'abord (tri stable).
const trierPatchs = patchs => [...patchs].sort((a, b) => b.date.localeCompare(a.date));

// Hors administrateurs : sans les persos masqués, un patch sans autre ligne disparaît.
function patchsPublics(patchs, masques) {
  const caches = new Set(masques);
  return patchs
    .map(patch => ({ ...patch, lignes: patch.lignes.filter(ligne => !caches.has(ligne.perso)) }))
    .filter(patch => patch.lignes.length);
}

// -> { patch: { date, lignes } } ou { erreur }.
function lirePatch(brut, idsPersos) {
  if (!dateValide(brut?.date)) return { erreur: "Date du patch invalide." };
  const brutes = Array.isArray(brut?.lignes) ? brut.lignes : [];
  if (!brutes.length) return { erreur: "Ajoute au moins un personnage." };
  if (brutes.length > MAX_LIGNES) return { erreur: `${MAX_LIGNES} personnages au plus par patch.` };
  const lignes = [];
  for (const [i, ligne] of brutes.entries()) {
    const numero = `Ligne ${i + 1} :`;
    if (!idsPersos.has(ligne?.perso)) return { erreur: `${numero} personnage inconnu.` };
    const avant = texte(ligne.avant);
    const apres = texte(ligne.apres);
    const explication = texte(ligne.explication);
    if (!avant && !apres) return { erreur: `${numero} indique les points avant ou après.` };
    if (avant.length > LONGUEUR_POINTS || apres.length > LONGUEUR_POINTS) return { erreur: `${numero} ${LONGUEUR_POINTS} caractères au plus pour les points.` };
    if (explication.length > LONGUEUR_EXPLICATION) return { erreur: `${numero} ${LONGUEUR_EXPLICATION} caractères au plus pour l'explication.` };
    lignes.push({ perso: ligne.perso, avant, apres, explication });
  }
  return { patch: { date: brut.date, lignes } };
}

// corps : { patch: { id?, date, lignes } } (sans id : nouveau patch) ou
// { patch_suppression: id }. -> { status, corps }.
async function modifierPatchs(corps, idsPersos, auteur) {
  const patchs = await lirePatchs();
  let suite;
  if (corps.patch_suppression) {
    suite = patchs.filter(p => p.id !== corps.patch_suppression);
    if (suite.length === patchs.length) return { status: 404, corps: { error: "Patch introuvable" } };
  } else {
    const { patch, erreur } = lirePatch(corps.patch, idsPersos);
    if (erreur) return { status: 400, corps: { error: erreur } };
    const id = corps.patch.id;
    if (id) {
      if (!patchs.some(p => p.id === id)) return { status: 404, corps: { error: "Patch introuvable" } };
      suite = patchs.map(p => (p.id === id ? { id, ...patch } : p));
    } else {
      if (patchs.length >= MAX_PATCHS) return { status: 400, corps: { error: `${MAX_PATCHS} patchs au plus : supprimes-en un ancien.` } };
      suite = [{ id: crypto.randomBytes(6).toString("hex"), ...patch }, ...patchs];
    }
  }
  suite = trierPatchs(suite);
  await ecrirePatchs(suite, auteur);
  return { status: 200, corps: { patchs: suite } };
}

module.exports = { lirePatchs, patchsPublics, modifierPatchs };
