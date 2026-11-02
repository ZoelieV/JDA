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
    return `/DB/images/tuto_hoyolab/etape_${numero}.webp`;
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

  const demarrer = () => document.querySelectorAll("[data-tuto-hoyolab]").forEach(rendre);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
