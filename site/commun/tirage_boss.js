// Animation plein écran du tirage d'un boss, façon vœu de Genshin : clip du
// jeu (tirage simple puis obtention, DB/videos/tirage_boss_<rareté>.mp4) et,
// par-dessus, le boss en silhouette noire zoomée qui rétrécit jusqu'à
// l'arrêt sur image, puis ses couleurs, le logo de son type, son nom et ses
// étoiles (une par tintement de la fin du son).
// Clip : bleu (3★) pour les boss hebdomadaires, violet (4★) pour les
// légendes locales, doré (5★) pour le carnage ; world boss : clip bleu sans
// le 3e tintement (tirage_boss_2.mp4), 2 étoiles.
// TirageBoss.jouer(boss) -> promesse résolue à la fermeture (fin, « Passer »,
// clic ou Échap). Rien d'animé si le système demande moins d'animations.
// TirageBoss.jouer(boss, { choix: [éléments] }) : modes où l'on peut relancer
// le boss. À la fin (ou « Passer »), l'image reste figée et les éléments
// (boutons garder / relancer) sont déplacés dessus ; promesse résolue dès
// cette fin, écran fermé seulement par TirageBoss.fermer() (ou un nouveau
// tirage), les éléments remis à leur place. Moins d'animations : écran de
// fin directement, sans la vidéo.

const TirageBoss = (() => {
  // debut : début de l'obtention dans le clip ; fige : arrêt sur image après
  // ce début ; pics : tintements (une étoile chacun), en secondes.
  const CLIPS = {
    2: { src: "/DB/videos/tirage_boss_2.mp4?v=1", debut: 5.933, fige: 1.033, pics: [1.98, 2.15] },
    3: { src: "/DB/videos/tirage_boss_3.mp4?v=1", debut: 5.933, fige: 1.033, pics: [1.98, 2.15, 2.32] },
    4: { src: "/DB/videos/tirage_boss_4.mp4?v=1", debut: 5.933, fige: 1.017, pics: [2.03, 2.20, 2.37, 2.52] },
    5: { src: "/DB/videos/tirage_boss_5.mp4?v=1", debut: 5.883, fige: 1.083, pics: [2.05, 2.20, 2.32, 2.54, 2.69] }
  };
  const LOGOS = {
    world_boss: "logo_world_boss",
    weekly_boss: "logo_boss_hebdo",
    legende_locale_jour: "logo_legende_locale",
    legende_locale_infinie: "logo_legende_locale",
    carnage_boss: "logo_carnage"
  };
  const ZOOM = 2.2;
  const FONDU = 0.35;
  const FERMETURE_APRES_FIN_MS = 1800;
  // Clips très forts : moitié du volume.
  const VOLUME = 0.5;
  const MOUVEMENT_REDUIT = window.matchMedia("(prefers-reduced-motion: reduce)");

  function rarete(boss) {
    if (boss?.type === "world_boss") return 2;
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

  function jouer(boss, { choix = null } = {}) {
    const avecChoix = Array.isArray(choix) && choix.length > 0;
    if (!boss || (MOUVEMENT_REDUIT.matches && !avecChoix)) return Promise.resolve();
    fermer();
    const sansVideo = MOUVEMENT_REDUIT.matches;
    const n = rarete(boss);
    const clip = CLIPS[n];
    const logo = LOGOS[boss.type];
    const pics = clip.pics;

    const ecran = document.createElement("div");
    ecran.id = "tirage-boss";
    ecran.className = "tirage-boss";
    ecran.setAttribute("role", "dialog");
    ecran.setAttribute("aria-modal", "true");
    ecran.setAttribute("aria-label", "Tirage du boss");
    ecran.innerHTML = `
      ${sansVideo ? "" : `<video class="tb-video" playsinline preload="auto" src="${clip.src}"></video>`}
      <img class="tb-boss" alt="" src="/DB/${encodeURI(imageBoss(boss))}">
      <div class="tb-bloc">
        ${logo ? `<img class="tb-logo" alt="" src="/DB/images/others/${logo}.webp">` : ""}
        <div class="tb-texte">
          <span class="tb-nom"></span>
          <span class="tb-etoiles">${pics.map(() => `<img alt="" src="/DB/images/others/etoile_tirage.webp">`).join("")}</span>
        </div>
      </div>
      <div class="tb-choix"></div>
      <button type="button" class="tb-passer">Passer</button>`;
    ecran.querySelector(".tb-nom").textContent = boss.nom;
    ecran.querySelector(".tb-etoiles").setAttribute("aria-label", `${pics.length} étoiles`);
    document.body.appendChild(ecran);

    const video = ecran.querySelector("video");
    const image = ecran.querySelector(".tb-boss");
    const bloc = ecran.querySelector(".tb-bloc");
    const etoiles = [...ecran.querySelectorAll(".tb-etoiles img")];
    const zoneChoix = ecran.querySelector(".tb-choix");
    const passer = ecran.querySelector(".tb-passer");

    return new Promise(resolve => {
      let image_raf = 0;
      let minuteur = 0;
      let termine = false;
      let finAffichee = false;
      // Éléments du choix : marque à leur place d'origine, pour les y remettre.
      const marques = [];
      const finir = () => {
        if (termine) return;
        termine = true;
        cancelAnimationFrame(image_raf);
        clearTimeout(minuteur);
        document.removeEventListener("keydown", touche);
        video?.pause();
        marques.forEach(([marque, element]) => marque.replaceWith(element));
        ecran.classList.add("tb-ferme");
        setTimeout(() => ecran.remove(), 300);
        resolve();
      };
      // Fin du son (ou « Passer » avec un choix) : tout est affiché, image
      // figée ; sans choix, fermeture peu après.
      const afficherFin = () => {
        if (finAffichee || termine) return;
        finAffichee = true;
        cancelAnimationFrame(image_raf);
        image.style.opacity = "1";
        image.style.filter = "none";
        image.style.transform = "translate(-50%, -50%) scale(1)";
        bloc.style.opacity = "1";
        etoiles.forEach(etoile => etoile.classList.add("tb-visible"));
        if (!avecChoix) {
          minuteur = setTimeout(finir, FERMETURE_APRES_FIN_MS);
          return;
        }
        // « Passer » : image figée de la fin du clip.
        if (video && !video.ended) {
          video.pause();
          if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.05);
        }
        passer.remove();
        choix.forEach(element => {
          const marque = document.createComment("");
          element.before(marque);
          marques.push([marque, element]);
          zoneChoix.appendChild(element);
        });
        ecran.classList.add("tb-avec-choix");
        resolve();
      };
      const sauter = () => (avecChoix ? afficherFin() : finir());
      const touche = event => { if (event.key === "Escape" && !finAffichee) sauter(); };
      ecran._finir = finir;
      passer.addEventListener("click", event => { event.stopPropagation(); sauter(); });
      ecran.addEventListener("click", () => { if (finAffichee && !avecChoix) finir(); });
      document.addEventListener("keydown", touche);

      if (sansVideo) {
        afficherFin();
        return;
      }

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
          etoiles.forEach((etoile, i) => etoile.classList.toggle("tb-visible", t >= pics[i]));
        }
        if (!termine && !finAffichee && !video.ended) image_raf = requestAnimationFrame(animer);
      };
      video.addEventListener("ended", afficherFin);
      video.addEventListener("error", sauter);
      video.addEventListener("playing", () => { image_raf = requestAnimationFrame(animer); }, { once: true });
      // Volume du site (menu des paramètres, cf. commun/volume.js).
      if (window.VolumeSite) VolumeSite.appliquer(video, VOLUME);
      else video.volume = VOLUME;
      // Son refusé par le navigateur (aucun clic sur la page) : sans le son.
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(sauter);
      });
    });
  }

  function fermer() {
    document.getElementById("tirage-boss")?._finir?.();
  }

  return { jouer, fermer, precharger, rarete };
})();
