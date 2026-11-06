// Animation plein écran du tirage d'un boss, façon vœu de Genshin : clip du
// jeu (tirage simple puis obtention, DB/videos/tirage_boss_<rareté>.mp4) et,
// par-dessus, le boss en silhouette noire zoomée qui rétrécit jusqu'à
// l'arrêt sur image, puis ses couleurs, le logo de son type, son nom et ses
// étoiles (une par tintement de la fin du son).
// Boss hebdomadaire (et world boss) : 3★ ; légende locale : 4★ ; carnage : 5★.
// TirageBoss.jouer(boss) -> promesse résolue à la fermeture (fin, « Passer »,
// clic ou Échap). Rien d'animé si le système demande moins d'animations.

const TirageBoss = (() => {
  // debut : début de l'obtention dans le clip ; fige : arrêt sur image après
  // ce début ; pics : tintements (une étoile chacun), en secondes.
  const CLIPS = {
    3: { src: "/DB/videos/tirage_boss_3.mp4?v=1", debut: 5.933, fige: 1.033, pics: [1.98, 2.15, 2.32] },
    4: { src: "/DB/videos/tirage_boss_4.mp4?v=1", debut: 5.933, fige: 1.017, pics: [2.03, 2.20, 2.37, 2.52] },
    5: { src: "/DB/videos/tirage_boss_5.mp4?v=1", debut: 5.883, fige: 1.083, pics: [2.05, 2.20, 2.32, 2.54, 2.69] }
  };
  const LOGOS = {
    weekly_boss: "logo_boss_hebdo",
    legende_locale_jour: "logo_legende_locale",
    legende_locale_infinie: "logo_legende_locale",
    carnage_boss: "logo_carnage"
  };
  const ZOOM = 2.2;
  const FONDU = 0.35;
  const FERMETURE_APRES_FIN_MS = 1800;
  const MOUVEMENT_REDUIT = window.matchMedia("(prefers-reduced-motion: reduce)");

  function rarete(boss) {
    if (boss?.type === "carnage_boss") return 5;
    if (boss?.type === "legende_locale_jour" || boss?.type === "legende_locale_infinie") return 4;
    return 3;
  }

  function imageBoss(boss) {
    return Array.isArray(boss.images) && boss.images.length ? boss.images[0] : boss.image;
  }

  // Vidéos téléchargées à l'avance (ex. à l'ouverture de la draft).
  function precharger() {
    Object.values(CLIPS).forEach(clip => {
      const lien = document.createElement("link");
      lien.rel = "preload";
      lien.as = "video";
      lien.href = clip.src;
      document.head.appendChild(lien);
    });
  }

  function jouer(boss) {
    if (!boss || MOUVEMENT_REDUIT.matches) return Promise.resolve();
    fermer();
    const n = rarete(boss);
    const clip = CLIPS[n];
    const logo = LOGOS[boss.type];

    const ecran = document.createElement("div");
    ecran.id = "tirage-boss";
    ecran.className = "tirage-boss";
    ecran.setAttribute("role", "dialog");
    ecran.setAttribute("aria-modal", "true");
    ecran.setAttribute("aria-label", "Tirage du boss");
    ecran.innerHTML = `
      <video class="tb-video" playsinline preload="auto" src="${clip.src}"></video>
      <img class="tb-boss" alt="" src="/DB/${encodeURI(imageBoss(boss))}">
      <div class="tb-bloc">
        ${logo ? `<img class="tb-logo" alt="" src="/DB/images/others/${logo}.webp">` : ""}
        <div class="tb-texte">
          <span class="tb-nom"></span>
          <span class="tb-etoiles">${clip.pics.map(() => `<img alt="" src="/DB/images/others/etoile_tirage.webp">`).join("")}</span>
        </div>
      </div>
      <button type="button" class="tb-passer">Passer</button>`;
    ecran.querySelector(".tb-nom").textContent = boss.nom;
    ecran.querySelector(".tb-etoiles").setAttribute("aria-label", `${n} étoiles`);
    document.body.appendChild(ecran);

    const video = ecran.querySelector("video");
    const image = ecran.querySelector(".tb-boss");
    const bloc = ecran.querySelector(".tb-bloc");
    const etoiles = [...ecran.querySelectorAll(".tb-etoiles img")];

    return new Promise(resolve => {
      let image_raf = 0;
      let minuteur = 0;
      let termine = false;
      const finir = () => {
        if (termine) return;
        termine = true;
        cancelAnimationFrame(image_raf);
        clearTimeout(minuteur);
        document.removeEventListener("keydown", touche);
        video.pause();
        ecran.classList.add("tb-ferme");
        setTimeout(() => ecran.remove(), 300);
        resolve();
      };
      const touche = event => { if (event.key === "Escape") finir(); };
      ecran._finir = finir;
      ecran.querySelector(".tb-passer").addEventListener("click", event => { event.stopPropagation(); finir(); });
      ecran.addEventListener("click", () => { if (video.ended) finir(); });
      document.addEventListener("keydown", touche);

      // Une image par rafraîchissement, calée sur le temps de la vidéo.
      const animer = () => {
        const t = video.currentTime - clip.debut;
        if (t < 0) {
          image.style.opacity = "0";
        } else {
          const p = Math.min(1, t / clip.fige);
          const echelle = 1 + (ZOOM - 1) * (1 - p) ** 3;
          const couleurs = Math.min(1, Math.max(0, (t - clip.fige) / FONDU));
          image.style.opacity = String(Math.min(1, t / 0.08));
          image.style.transform = `translate(-50%, -50%) scale(${echelle})`;
          image.style.filter = couleurs < 1 ? `brightness(${couleurs})` : "none";
          bloc.style.opacity = String(couleurs);
          etoiles.forEach((etoile, i) => etoile.classList.toggle("tb-visible", t >= clip.pics[i]));
        }
        if (!termine && !video.ended) image_raf = requestAnimationFrame(animer);
      };
      video.addEventListener("ended", () => {
        // Fin du son : tout est affiché, fermeture peu après.
        image.style.filter = "none";
        image.style.transform = "translate(-50%, -50%) scale(1)";
        bloc.style.opacity = "1";
        etoiles.forEach(etoile => etoile.classList.add("tb-visible"));
        minuteur = setTimeout(finir, FERMETURE_APRES_FIN_MS);
      });
      video.addEventListener("error", finir);
      video.addEventListener("playing", () => { image_raf = requestAnimationFrame(animer); }, { once: true });
      // Son refusé par le navigateur (aucun clic sur la page) : sans le son.
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(finir);
      });
    });
  }

  function fermer() {
    document.getElementById("tirage-boss")?._finir?.();
  }

  return { jouer, fermer, precharger, rarete };
})();
