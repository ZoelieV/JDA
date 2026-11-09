// Animation plein écran des vœux de cosmétiques (page Cosmétiques), façon
// vœu de Genshin, avec la mécanique du tirage de boss (styles tb-* de
// commun/tirage_boss.css) : clip du jeu, cosmétique en silhouette noire
// zoomée qui rétrécit jusqu'à l'arrêt sur image, puis ses couleurs, son nom,
// son type et ses étoiles (une par tintement de la fin du son).
//
// Étoiles et clips selon la rareté : commun 2★ et rare 3★ (clip bleu ; 2★ :
// sans le 3e tintement), épique 4★ (violet), légendaire 5★ (doré). Un
// légendaire obtenu par la garantie joue la capture de radiance.
// Clips : cf. scripts/clips_tirage.sh.
//   1 vœu   : tirage_boss_2/3/4/5.mp4 ou voeu_5_capture.mp4 (vœu + obtention) ;
//   10 vœux : dix_4/5/5_capture.mp4 (selon le meilleur gain : légendaire de
//             la garantie, légendaire, sinon 4★), puis l'écran d'obtention
//             de chaque cosmétique, du moins rare au plus rare
//             (obtention_<étoiles>_t.mp4 pour le premier, transition
//             comprise ; obtention_<étoiles>.mp4 ensuite).
// TirageVoeu.jouer(gains) -> promesse résolue à la fermeture (fin, « Passer »,
// Échap). gains : [{ nom, type, image, rarete, garantie }]. Clic pendant un
// écran d'obtention : passe au suivant. Rien d'animé si le système demande
// moins d'animations.

const TirageVoeu = (() => {
  const ETOILES = { commun: 2, rare: 3, epique: 4, legendaire: 5 };
  // fige : arrêt sur image après le début de l'obtention ; pics :
  // tintements (une étoile chacun), en secondes depuis ce début.
  const OBTENTIONS = {
    2: { fige: 1.033, pics: [1.98, 2.15] },
    3: { fige: 1.033, pics: [1.98, 2.15, 2.32] },
    4: { fige: 1.017, pics: [2.03, 2.20, 2.37, 2.52] },
    5: { fige: 1.083, pics: [2.05, 2.20, 2.32, 2.54, 2.69] }
  };
  // Vœu simple : clip complet, obtention à partir de debut.
  const SIMPLES = {
    2: { src: "/DB/videos/tirage_boss_2.mp4?v=1", debut: 5.933 },
    3: { src: "/DB/videos/tirage_boss_3.mp4?v=1", debut: 5.933 },
    4: { src: "/DB/videos/tirage_boss_4.mp4?v=1", debut: 5.933 },
    5: { src: "/DB/videos/tirage_boss_5.mp4?v=1", debut: 5.883 },
    capture: { src: "/DB/videos/voeu_5_capture.mp4?v=1", debut: 7.467 }
  };
  const DIX = {
    4: "/DB/videos/dix_4.mp4?v=1",
    5: "/DB/videos/dix_5.mp4?v=1",
    capture: "/DB/videos/dix_5_capture.mp4?v=1"
  };
  const obtention = (etoiles, premier) => `/DB/videos/obtention_${etoiles}${premier ? "_t" : ""}.mp4?v=1`;
  const ZOOM = 2.2;
  const FONDU = 0.35;
  // Fin d'un écran d'obtention : suivant (ou fermeture) après ce délai.
  const SUITE_APRES_FIN_MS = 1500;
  const VOLUME = 0.5;
  const MOUVEMENT_REDUIT = window.matchMedia("(prefers-reduced-motion: reduce)");

  const etoilesDe = gain => ETOILES[gain.rarete] || 2;

  // Plans à jouer : { src, debut (début de l'obtention, null : pas
  // d'objet), gain }.
  function plans(gains) {
    if (gains.length === 1) {
      const gain = gains[0];
      const n = etoilesDe(gain);
      const clip = n === 5 && gain.garantie ? SIMPLES.capture : SIMPLES[n];
      return [{ src: clip.src, debut: clip.debut, gain }];
    }
    const ordre = gains.map((gain, i) => ({ gain, i })).sort((a, b) => etoilesDe(a.gain) - etoilesDe(b.gain) || a.i - b.i).map(e => e.gain);
    const meilleur = Math.max(...gains.map(etoilesDe));
    const intro = gains.some(g => etoilesDe(g) === 5 && g.garantie) ? DIX.capture : meilleur === 5 ? DIX[5] : DIX[4];
    return [{ src: intro, debut: null, gain: null }, ...ordre.map((gain, i) => ({ src: obtention(etoilesDe(gain), i === 0), debut: 0, gain }))];
  }

  // Clips téléchargés à l'avance (ouverture de la page).
  function precharger() {
    const liens = [...Object.values(SIMPLES).map(c => c.src), ...Object.values(DIX),
      ...[2, 3, 4, 5].flatMap(n => [obtention(n, true), obtention(n, false)])];
    liens.forEach(href => {
      const lien = document.createElement("link");
      lien.rel = "preload";
      lien.as = "video";
      lien.href = href;
      document.head.appendChild(lien);
    });
  }

  function jouer(gains) {
    if (!Array.isArray(gains) || !gains.length || MOUVEMENT_REDUIT.matches) return Promise.resolve();
    document.getElementById("tirage-voeu")?._finir?.();
    const liste = plans(gains);

    const ecran = document.createElement("div");
    ecran.id = "tirage-voeu";
    ecran.className = "tirage-boss tirage-voeu";
    ecran.setAttribute("role", "dialog");
    ecran.setAttribute("aria-modal", "true");
    ecran.setAttribute("aria-label", gains.length > 1 ? `${gains.length} vœux` : "Vœu");
    ecran.innerHTML = `
      <video class="tb-video" playsinline preload="auto"></video>
      <img class="tb-boss tv-objet" alt="">
      <div class="tb-bloc">
        <div class="tb-texte">
          <span class="tb-nom"></span>
          <span class="tv-type"></span>
          <span class="tb-etoiles"></span>
        </div>
      </div>
      <span class="tv-compteur"></span>
      <button type="button" class="tb-passer">Passer</button>`;
    document.body.appendChild(ecran);

    const video = ecran.querySelector("video");
    const image = ecran.querySelector(".tv-objet");
    const bloc = ecran.querySelector(".tb-bloc");
    const zoneEtoiles = ecran.querySelector(".tb-etoiles");
    const compteur = ecran.querySelector(".tv-compteur");
    const passer = ecran.querySelector(".tb-passer");
    if (window.VolumeSite) VolumeSite.appliquer(video, VOLUME);
    else video.volume = VOLUME;

    return new Promise(resolve => {
      let indice = -1;
      let raf = 0;
      let minuteur = 0;
      let termine = false;
      let finPlan = false;
      let etoiles = [];
      let reglage = null;
      const objets = liste.filter(p => p.gain).length;

      const finir = () => {
        if (termine) return;
        termine = true;
        cancelAnimationFrame(raf);
        clearTimeout(minuteur);
        document.removeEventListener("keydown", touche);
        video.pause();
        ecran.classList.add("tb-ferme");
        setTimeout(() => ecran.remove(), 300);
        resolve();
      };

      // Fin d'un écran d'obtention : tout affiché, puis suivant.
      const afficherFin = () => {
        if (finPlan || termine) return;
        finPlan = true;
        cancelAnimationFrame(raf);
        const plan = liste[indice];
        if (!plan.gain) return suivant();
        image.style.opacity = "1";
        image.style.filter = "none";
        image.style.transform = "translate(-50%, -50%) scale(1)";
        bloc.style.opacity = "1";
        etoiles.forEach(etoile => etoile.classList.add("tb-visible"));
        minuteur = setTimeout(suivant, SUITE_APRES_FIN_MS);
      };

      // Une image par rafraîchissement, calée sur le temps de la vidéo.
      const animer = () => {
        const plan = liste[indice];
        const t = video.currentTime - (plan.debut ?? Infinity);
        if (!plan.gain || t < 0) {
          image.style.opacity = "0";
          bloc.style.opacity = "0";
        } else {
          const p = Math.min(1, t / reglage.fige);
          const echelle = 1 + (ZOOM - 1) * (1 - p) ** 3;
          const couleurs = Math.min(1, Math.max(0, (t - reglage.fige) / FONDU));
          image.style.opacity = String(Math.min(1, t / 0.08));
          image.style.transform = `translate(-50%, -50%) scale(${echelle})`;
          image.style.filter = couleurs < 1 ? `brightness(${couleurs})` : "none";
          bloc.style.opacity = String(couleurs);
          etoiles.forEach((etoile, i) => etoile.classList.toggle("tb-visible", t >= reglage.pics[i]));
        }
        if (!termine && !finPlan && !video.ended) raf = requestAnimationFrame(animer);
      };

      function lancer() {
        video.play().catch(() => {
          // Son refusé par le navigateur : sans le son.
          video.muted = true;
          video.play().catch(suivant);
        });
      }

      function suivant() {
        if (termine) return;
        clearTimeout(minuteur);
        cancelAnimationFrame(raf);
        indice++;
        if (indice >= liste.length) return finir();
        finPlan = false;
        const plan = liste[indice];
        image.style.opacity = "0";
        bloc.style.opacity = "0";
        if (plan.gain) {
          const n = etoilesDe(plan.gain);
          reglage = OBTENTIONS[n];
          image.style.filter = "brightness(0)";
          image.style.transform = `translate(-50%, -50%) scale(${ZOOM})`;
          image.src = plan.gain.image || "";
          ecran.querySelector(".tb-nom").textContent = plan.gain.nom || "";
          ecran.querySelector(".tv-type").textContent = plan.gain.type || "";
          zoneEtoiles.innerHTML = reglage.pics.map(() => `<img alt="" src="/DB/images/others/etoile_tirage.webp">`).join("");
          zoneEtoiles.setAttribute("aria-label", `${n} étoiles`);
          etoiles = [...zoneEtoiles.querySelectorAll("img")];
          const rang = liste.slice(0, indice + 1).filter(p => p.gain).length;
          compteur.textContent = objets > 1 ? `${rang} / ${objets}` : "";
        } else {
          compteur.textContent = "";
        }
        video.src = plan.src;
        lancer();
      }

      const touche = event => {
        if (event.key === "Escape") finir();
        else if ((event.key === "Enter" || event.key === " ") && liste[indice]?.gain) { event.preventDefault(); suivant(); }
      };
      ecran._finir = finir;
      passer.addEventListener("click", event => { event.stopPropagation(); finir(); });
      // Clic : écran d'obtention suivant (pas pendant le clip du vœu).
      ecran.addEventListener("click", () => {
        const plan = liste[indice];
        if (plan?.gain && video.currentTime >= plan.debut) suivant();
      });
      video.addEventListener("ended", afficherFin);
      // Une seule boucle d'animation, relancée à chaque clip.
      video.addEventListener("playing", () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(animer);
      });
      video.addEventListener("error", suivant);
      document.addEventListener("keydown", touche);
      suivant();
    });
  }

  return { jouer, precharger };
})();
