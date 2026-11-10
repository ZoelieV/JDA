// Profil d'un joueur depuis n'importe quelle page : un clic sur un élément
// [data-profil="<discord_id>"] ouvre sa box dans la même fenêtre que la
// page Joueurs (/comptes?profil=<id>, chargée dans un iframe par-dessus la
// page, cf. PAGE_INTEGREE dans all_accounts/all_accounts.js). Aucune
// dépendance ; chargé après fenetres.js. Page de la fenêtre : X-Frame-Options
// SAMEORIGIN pour /comptes (vercel.json).

(function () {
  if (window.self !== window.top) return;

  if (!document.querySelector('link[href^="/commun/profil_joueur.css"]')) {
    const lien = document.createElement("link");
    lien.rel = "stylesheet";
    lien.href = "/commun/profil_joueur.css?v=1";
    document.head.appendChild(lien);
  }

  let voile = null;

  function fermer() {
    if (!voile) return;
    voile.remove();
    voile = null;
    document.documentElement.classList.remove("profil-joueur-ouvert");
  }

  function ouvrir(discordId) {
    fermer();
    voile = document.createElement("div");
    voile.className = "voile-profil-joueur";
    voile.innerHTML = `<span class="chargement-profil-joueur">Chargement…</span>`;
    const cadre = document.createElement("iframe");
    cadre.className = "cadre-profil-joueur";
    cadre.title = "Box du joueur";
    cadre.src = `/comptes?profil=${encodeURIComponent(discordId)}`;
    voile.appendChild(cadre);
    // Clic sur le voile pendant le chargement : annule.
    voile.addEventListener("click", event => { if (event.target === voile) fermer(); });
    document.body.appendChild(voile);
    document.documentElement.classList.add("profil-joueur-ouvert");
  }

  window.ouvrirProfilJoueur = ouvrir;

  window.addEventListener("message", event => {
    if (event.origin !== location.origin || !voile) return;
    const cadre = voile.querySelector("iframe");
    if (event.source !== cadre.contentWindow) return;
    if (event.data?.type === "jda-profil-pret") {
      voile.classList.add("pret");
      cadre.focus();
    } else if (event.data?.type === "jda-fermer-profil") {
      fermer();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && voile) fermer();
  });

  // Clic sur un joueur, sauf sur un lien ou un bouton qu'il contient.
  document.addEventListener("click", event => {
    const cible = event.target.closest("[data-profil]");
    // Box fictive (fictif_…) : réservée aux admins, pas de profil.
    if (!cible || !cible.dataset.profil || cible.dataset.profil.startsWith("fictif_")) return;
    const interne = event.target.closest("a, button, input, select, label");
    if (interne && interne !== cible && cible.contains(interne)) return;
    event.preventDefault();
    event.stopPropagation();
    ouvrir(cible.dataset.profil);
  }, true);
})();
