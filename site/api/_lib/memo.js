// Lectures publiques lourdes (historique, statistiques, tous les comptes)
// gardées quelques secondes en mémoire de la fonction : des requêtes
// simultanées attendent la même lecture Supabase au lieu d'en lancer une
// chacune (une rafale de requêtes ne fait plus tomber la base). Résultat
// partagé : ne jamais le modifier sur place. Erreur : pas gardée.
const caches = new Map();

function memoriser(cle, dureeMs, charger) {
  const entree = caches.get(cle);
  if (entree && Date.now() - entree.lu < dureeMs) return entree.promesse;

  const promesse = Promise.resolve().then(charger);
  caches.set(cle, { promesse, lu: Date.now() });
  promesse.catch(() => {
    if (caches.get(cle)?.promesse === promesse) caches.delete(cle);
  });
  // Ménage : entrées périmées retirées (clés par saison, par joueurs...).
  if (caches.size > 200) {
    for (const [autre, { lu }] of caches) if (Date.now() - lu > 60 * 1000) caches.delete(autre);
  }
  return promesse;
}

module.exports = { memoriser };
