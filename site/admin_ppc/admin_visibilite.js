// Administration : cosmétiques visibles (tuile Cosmétiques visibles). Fenêtre
// de choix (admin_choix_cosmetiques.js) où les cosmétiques sélectionnés sont
// ceux qui sont cachés : ni en vente ni dans le tirage normal, visibles une
// fois obtenus. Réglage enregistré par-dessus cosmetiques.json
// (config.cosmetiques_caches, api/points.js). Skins ajoutés : masquage dans
// la tuile Skins. Mini admins : le serveur refuse.

const TEXTE_VISIBILITE = document.getElementById("texte-visibilite").textContent;

function afficherResultatVisibilite(texte) {
  document.getElementById("texte-visibilite").textContent = texte || TEXTE_VISIBILITE;
}

async function ouvrirVisibilite() {
  const catalogue = await chargerCatalogueChoix().catch(() => null);
  if (!catalogue) return afficherResultatVisibilite("Impossible de charger les cosmétiques.");
  const avant = new Set([...catalogue.values()].filter(info => info.cache).map(info => info.id));
  const choisis = await choisirCosmetiques({
    titre: "Sélectionne les cosmétiques à cacher (les autres sont visibles)",
    selection: [...avant],
    exclure: id => id.startsWith("skin:") && estSkinAjoute(id.slice(5))
  });
  if (!choisis) return;
  const apres = new Set(choisis);
  const changes = Object.fromEntries([
    ...choisis.filter(id => !avant.has(id)).map(id => [id, true]),
    ...[...avant].filter(id => !apres.has(id)).map(id => [id, false])
  ]);
  const nb = Object.keys(changes).length;
  if (!nb) return afficherResultatVisibilite("Aucun changement.");
  afficherResultatVisibilite("Enregistrement…");
  try {
    const reponse = await fetch("/api/points", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cosmetiques_caches: changes })
    });
    const resultat = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(resultat.error || "Erreur d'enregistrement.");
    promessePointsAdmin = null;
    promesseCatalogueChoix = null;
    catalogueChoixCosmetiques = null;
    afficherResultatVisibilite(`${nb} cosmétique${nb > 1 ? "s" : ""} modifié${nb > 1 ? "s" : ""} : ${apres.size} caché${apres.size > 1 ? "s" : ""} au total.`);
  } catch (erreur) {
    console.error(erreur);
    afficherResultatVisibilite(erreur.message);
  }
}

document.getElementById("ouvrir-visibilite").addEventListener("click", ouvrirVisibilite);
