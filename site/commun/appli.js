// Installation du site comme application sur téléphone (cf.
// /manifest.webmanifest, /sw.js). Boutons [data-installer-appli] (menu du
// compte, commun/compte.js et Mon compte) : affichés seulement sur
// téléphone, si le site n'est pas déjà ouvert en appli et si l'installation
// est possible : invite du navigateur (Android : Chrome, Edge, Samsung
// Internet...) ou, sur iPhone / iPad où aucun site ne peut la déclencher,
// marche à suivre du bouton Partager.
(function () {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(erreur => console.error(erreur));
  }

  let invite = null; // événement beforeinstallprompt gardé pour le bouton
  const telephone = matchMedia("(pointer: coarse)").matches;
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installee = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const disponible = () => telephone && !installee() && (!!invite || apple);

  function rafraichir() {
    const visible = disponible();
    document.querySelectorAll("[data-installer-appli]").forEach(bouton => {
      bouton.style.display = visible ? "" : "none";
    });
  }

  // Pas de preventDefault : le navigateur garde sa propre proposition.
  window.addEventListener("beforeinstallprompt", event => {
    invite = event;
    rafraichir();
  });
  window.addEventListener("appinstalled", () => {
    invite = null;
    rafraichir();
  });

  document.addEventListener("click", async event => {
    if (!event.target.closest("[data-installer-appli]")) return;
    if (invite) {
      const evenement = invite;
      invite = null; // une invite ne sert qu'une fois
      await evenement.prompt();
      rafraichir();
    } else if (apple) {
      alert("Pour installer l'appli : touche le bouton Partager du navigateur (carré avec une flèche vers le haut), puis « Sur l'écran d'accueil ».");
    }
  });

  document.addEventListener("DOMContentLoaded", rafraichir);
  window.Appli = { rafraichir };
})();
