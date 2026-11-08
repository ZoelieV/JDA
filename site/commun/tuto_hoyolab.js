// Tutoriel « Récupérer sa box sur HoYoLAB » : étapes avec captures
// (DB/images/tuto_hoyolab/etape_<n>.webp), affichées dans chaque élément
// [data-tuto-hoyolab] de la page (page Tutoriel, fenêtre Détection auto de
// Mon compte). Clic sur une capture : agrandie par-dessus la page.
// Styles : commun/tuto_hoyolab.css.

(() => {
  const ETAPES_HOYOLAB = [
    `Va sur <a href="https://www.hoyolab.com/home" target="_blank" rel="noopener">hoyolab.com</a> et connecte-toi avec ton compte HoYoverse (le même que dans Genshin).`,
    "Clique sur ta photo de profil, en haut à droite.",
    "Clique sur « Profil ».",
    "Ton profil s'ouvre : fais défiler la page vers le bas.",
    "Clique sur Genshin Impact.",
    "Dans « Mes personnages », clique sur « Nouveaux personnages », à droite.",
    "Tous tes personnages s'affichent. Garde la langue en français (FR en haut à droite) et le tri par défaut.",
    "Clique sur le bouton de partage en haut à droite, puis sur l'icône image (la dernière) : HoYoLAB crée une image de toute ta liste. Enregistre-la, puis dépose-la dans « Détection auto » de Mon compte."
  ];

  function image(numero) {
    return `/DB/images/tuto_hoyolab/etape_${numero}.webp?v=2`;
  }

  function rendre(conteneur) {
    const liste = document.createElement("ol");
    liste.className = "tuto-hoyolab";
    liste.innerHTML = ETAPES_HOYOLAB.map((texte, i) => `
      <li class="etape-hoyolab">
        <p><span class="numero-etape-hoyolab">${i + 1}</span><span>${texte}</span></p>
        <button type="button" class="capture-hoyolab" data-capture="${image(i + 1)}" aria-label="Agrandir l'étape ${i + 1}">
          <img src="${image(i + 1)}" alt="Étape ${i + 1}" loading="lazy" width="1845" height="1087">
        </button>
      </li>`).join("");
    conteneur.replaceChildren(liste);
  }

  // Capture agrandie : clic ou Échap pour fermer.
  function agrandir(src) {
    const fond = document.createElement("div");
    fond.className = "capture-hoyolab-agrandie";
    fond.innerHTML = `<img src="${src}" alt="">`;
    const fermer = () => {
      fond.remove();
      document.removeEventListener("keydown", surTouche, true);
    };
    const surTouche = event => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      fermer();
    };
    fond.addEventListener("click", fermer);
    document.addEventListener("keydown", surTouche, true);
    document.body.appendChild(fond);
  }

  document.addEventListener("click", event => {
    const bouton = event.target.closest(".capture-hoyolab");
    if (bouton) agrandir(bouton.dataset.capture);
  });

  // Grande fenêtre, une étape à la fois (flèches du clavier comprises).
  function ouvrirEtapes() {
    let numero = 0;
    const fond = document.createElement("div");
    fond.className = "etapes-hoyolab";
    fond.setAttribute("role", "dialog");
    fond.setAttribute("aria-modal", "true");
    fond.innerHTML = `
      <div class="etapes-hoyolab-contenu">
        <button type="button" class="etapes-hoyolab-fermer" aria-label="Fermer">×</button>
        <p class="etapes-hoyolab-compte"></p>
        <p class="etapes-hoyolab-texte"></p>
        <img class="etapes-hoyolab-image" alt="" width="1845" height="1087">
        <div class="etapes-hoyolab-actions">
          <button type="button" class="etapes-hoyolab-precedent">Précédent</button>
          <button type="button" class="etapes-hoyolab-suivant">Suivant</button>
        </div>
      </div>`;
    const montrer = () => {
      fond.querySelector(".etapes-hoyolab-compte").textContent = `Étape ${numero + 1} / ${ETAPES_HOYOLAB.length}`;
      fond.querySelector(".etapes-hoyolab-texte").innerHTML = ETAPES_HOYOLAB[numero];
      fond.querySelector(".etapes-hoyolab-image").src = image(numero + 1);
      fond.querySelector(".etapes-hoyolab-precedent").disabled = numero === 0;
      fond.querySelector(".etapes-hoyolab-suivant").textContent = numero === ETAPES_HOYOLAB.length - 1 ? "Terminé" : "Suivant";
    };
    const fermer = () => {
      fond.remove();
      document.removeEventListener("keydown", surTouche, true);
    };
    const aller = sens => {
      if (numero + sens >= ETAPES_HOYOLAB.length) return fermer();
      numero = Math.max(0, numero + sens);
      montrer();
    };
    const surTouche = event => {
      if (event.key === "Escape") fermer();
      else if (event.key === "ArrowRight") aller(1);
      else if (event.key === "ArrowLeft") aller(-1);
      else return;
      event.stopPropagation();
      event.preventDefault();
    };
    fond.addEventListener("click", event => {
      event.stopPropagation();
      if (event.target === fond || event.target.closest(".etapes-hoyolab-fermer")) fermer();
      else if (event.target.closest(".etapes-hoyolab-suivant")) aller(1);
      else if (event.target.closest(".etapes-hoyolab-precedent")) aller(-1);
    });
    document.addEventListener("keydown", surTouche, true);
    document.body.appendChild(fond);
    montrer();
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-tuto-hoyolab-ouvrir]")) {
      event.preventDefault();
      ouvrirEtapes();
    }
    if (event.target.closest("[data-lancer-tutoriel]")) lancerTutoriel(event.target.closest("[data-lancer-tutoriel]"));
    // En capture : la bulle du tutoriel arrête la propagation de ses clics.
  }, true);

  // Page Tutoriel : relancer le tutoriel d'accueil (compte connecté).
  async function lancerTutoriel(bouton) {
    bouton.disabled = true;
    try {
      const reponse = await fetch("/api/auth/me", { credentials: "include" });
      if (!reponse.ok) {
        alerterSite("Connecte-toi avec Discord pour lancer le tutoriel.");
        return;
      }
      localStorage.setItem("tutoriel-test", "0");
      window.location.href = "/";
    } catch (erreur) {
      console.error(erreur);
      alerterSite("Impossible de lancer le tutoriel.");
    } finally {
      bouton.disabled = false;
    }
  }

  const demarrer = () => document.querySelectorAll("[data-tuto-hoyolab]").forEach(rendre);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
