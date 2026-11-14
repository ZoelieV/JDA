// Tutoriel obligatoire des nouveaux comptes (chargé par commun/site.js).
// Étape enregistrée sur le compte (?action=tutoriel, api/auth/profile.js) et
// cookie tutoriel_actif (posé à la connexion Discord). Relancé par un joueur
// (page Tutoriel) : étape dans localStorage "tutoriel-test",
// rien au serveur, et on peut le quitter.
// Une étape déjà faite n'est jamais passée toute seule : l'animation se joue
// et il faut cliquer pour continuer. Le serveur bloque les matchs tant que le
// tutoriel n'est pas fini (erreurProfilIncomplet, api/_lib/room.js).
// Fin : astuce unique sur le tri par points au premier match.
(function () {
  // Mêmes valeurs que MIN_PERSOS_MONTES (api/_lib/room.js).
  const MIN_PERSOS_MONTES = { 1: 3, 2: 8, 3: 12, 4: 16 };
  const NOMS_PALIERS = { 1: "Sardine", 2: "Carpe", 3: "Dauphin", 4: "Baleine" };
  const CLE_TEST = "tutoriel-test";
  const CLE_ASTUCE = "tutoriel-astuce-tri";
  const PAGES_LIBRES = ["/regles/completes", "/tutoriel"];

  const lireStockage = cle => { try { return localStorage.getItem(cle); } catch { return null; } };
  const ecrireStockage = (cle, valeur) => { try { localStorage.setItem(cle, valeur); } catch { /* stockage bloqué */ } };
  const retirerStockage = cle => { try { localStorage.removeItem(cle); } catch { /* stockage bloqué */ } };

  async function lireProfil() {
    const reponse = await fetch("/api/auth/profile", { credentials: "include" });
    if (!reponse.ok) throw new Error("Impossible de lire ton compte.");
    return (await reponse.json()).profil || {};
  }

  const montes = profil => new Set(Object.entries(profil.characters?.selections?.stuff || {})
    .filter(([, coche]) => coche).map(([id]) => id.replace(/^traveler_.*/, "traveler"))).size;

  // verifier(profil) -> { ok, detail } (état enregistré sur le compte) ;
  // enregistrer : bouton Enregistrer de l'étape, entouré à part.
  const ETAPES = [
    {
      page: "/", titre: "Bienvenue !", assombrir: true,
      texte: "On va préparer ton compte, puis faire le tour du site. Ça prend quelques minutes, et tu pourras jouer juste après."
    },
    {
      page: "/compte", titre: "Tes informations", cibles: ["#uid", "#niveau-monde"], enregistrer: "#btn-enregistrer-compte", clic: "#compte-btn",
      texte: "Renseigne ton UID et ton niveau du monde, puis clique sur Enregistrer. Attention : ton UID ne pourra plus être modifié.",
      verifier: profil => {
        const manque = [!profil.uid && "ton UID", !profil.niveau_monde && "ton niveau du monde"].filter(Boolean);
        return { ok: !manque.length, detail: manque.length ? `Il manque ${manque.join(" et ")} (pense à Enregistrer).` : "" };
      }
    },
    {
      page: "/compte", titre: "Tes personnages", cibles: ["#btn-auto-box"], enregistrer: ".btn-enregistrer-fixe", clic: ['[data-box="full"]', '.view-btn[data-view="characters"]'],
      texte: `Renseigne tous tes personnages dans ta Full box. On te conseille la <strong>Détection auto</strong> : elle lit une image de ta liste HoYoLAB et te fait gagner beaucoup de temps (<button type="button" class="tutoriel-lien" data-tuto-hoyolab-ouvrir>comment obtenir l'image</button>). Vérifie les constellations proposées, puis clique sur Enregistrer.`,
      verifier: profil => {
        const nb = Object.values(profil.characters?.full || {}).filter(valeur => valeur >= 0).length;
        return { ok: nb > 0, detail: nb ? `${nb} personnages enregistrés.` : "Aucun personnage enregistré pour l'instant (pense à Enregistrer)." };
      }
    },
    {
      page: "/compte", titre: "Tes armes", cibles: ['.view-btn[data-view="weapons"]'], enregistrer: ".btn-enregistrer-fixe", clic: ['[data-box="full"]', '.view-btn[data-view="weapons"]'],
      texte: "La Détection auto ne renseigne pas les armes : on est passé sur la vue Armes pour ça. Renseigne au moins un exemplaire de chaque arme que tu possèdes, et leurs doublons, puis clique sur Enregistrer. Si tu n'en as pas encore, passe simplement à la suite.",
      remplir: true
    },
    {
      page: "/compte", titre: "Tes persos montés", cibles: ['[data-box="stuff"]'], enregistrer: ".btn-enregistrer-fixe", clic: ['[data-box="stuff"]', '.view-btn[data-view="characters"]'],
      texte: "Dans ta Box stuff, coche les persos que tu as vraiment montés (niveau 80 ou plus, sauf exceptions comme Sucrose : niveau 70 suffit ; aptitudes utiles niveau 8 ou plus, un set d'artefacts). Il en faut 3 pour jouer en Sardine, 8 en Carpe, 12 en Dauphin et 16 en Baleine. Puis clique sur Enregistrer.",
      verifier: profil => {
        const palier = Number(profil.theatre) || 1;
        const nb = montes(profil);
        return { ok: nb >= MIN_PERSOS_MONTES[palier], detail: `${nb} / ${MIN_PERSOS_MONTES[palier]} persos montés pour ton palier (${NOMS_PALIERS[palier]}).` };
      }
    },
    {
      page: "/regles/simplifiees", titre: "Les règles en bref", cibles: [".sections-regles"],
      texte: `Voici l'essentiel. Le détail existe aussi : <a href="/regles/completes" target="_blank" rel="noopener">les règles complètes</a>, à lire avant tes premiers matchs classés.`
    },
    {
      page: "/compte", titre: "Personnalisation", cibles: ["#btn-parametres"], clic: "#compte-btn",
      texte: "Dans le menu de ton compte, ce bouton ouvre la Personnalisation : fond d'écran, namecard, bannière, skins. Tu gagnes des Rikoyns en jouant pour les débloquer."
    },
    {
      page: "/comptes", titre: "Les boxes des joueurs", cibles: ["#accounts-list"],
      texte: "Ici, tu peux consulter les comptes et les boxes des autres joueurs, pour préparer tes matchs."
    },
    {
      page: "/match", titre: "C'est parti !", cibles: [".cartes-match"], assombrir: true,
      texte: "C'est ici que tu lances tes matchs : classé, amical, entraînement, en équipe ou tournois. Bon jeu !"
    }
  ];

  const css = document.createElement("style");
  css.textContent = `
    .tutoriel-bulle { position: fixed; left: 50%; bottom: 1.25rem; z-index: 100001; box-sizing: border-box; width: min(34rem, calc(100vw - 2rem)); max-height: 60vh; overflow-y: auto; padding: 1.125rem 1.25rem; border: 1px solid #f5c542; border-radius: 0.875rem; background: rgba(10, 10, 14, 0.3); -webkit-backdrop-filter: blur(1.25rem); backdrop-filter: blur(1.25rem); color: #fff; text-shadow: 0 1px 0.25rem rgba(0, 0, 0, 0.9); box-shadow: 0 0.5rem 2rem rgba(0, 0, 0, 0.6); transform: translateX(-50%); animation: tutoriel-arrivee 0.35s ease-out; }
    .tutoriel-bulle a { color: #f5c542; }
    .tutoriel-bulle[hidden], .tutoriel-halo[hidden] { display: none; }
    .tutoriel-progression { margin: 0 0 0.25rem; font-size: 0.8125rem; opacity: 0.7; }
    .tutoriel-bulle h2 { margin: 0 0 0.5rem; font-size: 1.25rem; }
    .tutoriel-bulle p { margin: 0 0 0.625rem; line-height: 1.4; text-align: justify; }
    .tutoriel-bulle.reduite h2, .tutoriel-bulle.reduite p:not(.tutoriel-progression) { display: none; }
    .tutoriel-etat { font-weight: bold; }
    .tutoriel-etat.fait { color: #5fd38d; }
    .tutoriel-etat.manque { color: #ffb37a; }
    .tutoriel-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
    .tutoriel-actions button { padding: 0.5rem 0.875rem; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 0.5rem; background: transparent; color: #fff; font: inherit; cursor: pointer; }
    .tutoriel-actions .principal { border-color: #f5c542; background: #f5c542; color: #1b1b22; font-weight: bold; }
    .tutoriel-actions .quitter { margin-right: auto; }
    .tutoriel-lien { padding: 0; border: 0; background: none; color: #f5c542; font: inherit; text-decoration: underline; cursor: pointer; }
    .tutoriel-halo { position: fixed; z-index: 100000; box-sizing: border-box; border: 2px solid #f5c542; border-radius: 0.625rem; pointer-events: none; }
    .tutoriel-halo::after { content: ""; position: absolute; inset: -2px; border-radius: inherit; box-shadow: 0 0 1rem 0.1875rem rgba(245, 197, 66, 0.75); animation: tutoriel-lueur 1.8s ease-in-out infinite alternate; }
    .tutoriel-halo.assombri { box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.6); }
    .tutoriel-voile { position: fixed; inset: 0; z-index: 100000; background: rgba(0, 0, 0, 0.6); pointer-events: none; animation: tutoriel-fondu 0.35s ease-out; }
    @keyframes tutoriel-arrivee { from { opacity: 0; transform: translate(-50%, 1rem); } }
    @keyframes tutoriel-fondu { from { opacity: 0; } }
    @keyframes tutoriel-lueur { from { opacity: 0.25; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .tutoriel-bulle, .tutoriel-voile, .tutoriel-halo::after { animation: none; } }`;
  document.head.appendChild(css);

  // Fenêtre du site ouverte (Détection auto, Personnalisation, étapes
  // HoYoLAB...) : cadre et bulle s'effacent, ils reviennent à sa fermeture.
  const fenetreOuverte = () => !!document.querySelector(".modal-parametres.active, .modal-personnalisation.active, .etapes-hoyolab, .capture-hoyolab-agrandie");

  function masquerBulleSousFenetre(element) {
    const suivre = () => {
      if (!element.isConnected) return;
      element.hidden = fenetreOuverte();
      requestAnimationFrame(suivre);
    };
    suivre();
  }

  // Halo autour des cibles (suit le défilement ; laisse passer les clics).
  // defiler : amène la cible à l'écran au premier affichage.
  function suivreCibles(selecteurs, assombrir, defiler = true) {
    const halo = document.createElement("div");
    halo.className = `tutoriel-halo${assombrir ? " assombri" : ""}`;
    halo.hidden = true;
    document.body.appendChild(halo);
    let premier = true;
    const suivre = () => {
      if (!halo.isConnected) return;
      const rects = selecteurs.map(s => document.querySelector(s)).filter(Boolean).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
      // Fenêtre ouverte par-dessus la page : pas de cadre au-dessus d'elle.
      halo.hidden = !rects.length || fenetreOuverte();
      if (rects.length) {
        const haut = Math.min(...rects.map(r => r.top)), gauche = Math.min(...rects.map(r => r.left));
        Object.assign(halo.style, {
          top: `${haut - 6}px`, left: `${gauche - 6}px`,
          width: `${Math.max(...rects.map(r => r.right)) - gauche + 12}px`,
          height: `${Math.max(...rects.map(r => r.bottom)) - haut + 12}px`
        });
        if (premier) {
          premier = false;
          if (defiler) document.querySelector(selecteurs.find(s => document.querySelector(s))).scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
      requestAnimationFrame(suivre);
    };
    suivre();
    return halo;
  }

  function bulle({ progression, titre, texte }) {
    const element = document.createElement("div");
    element.className = "tutoriel-bulle";
    element.setAttribute("role", "dialog");
    // Un clic dans la bulle ne ferme pas le menu du compte ouvert par l'étape.
    element.addEventListener("click", event => event.stopPropagation());
    element.innerHTML = `${progression ? `<p class="tutoriel-progression">${progression}</p>` : ""}<h2>${titre}</h2><p>${texte}</p>
      <p class="tutoriel-etat" hidden></p><div class="tutoriel-actions"></div>`;
    document.body.appendChild(element);
    masquerBulleSousFenetre(element);
    return element;
  }

  function bouton(zone, texte, classe, action) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = texte;
    if (classe) element.className = classe;
    element.addEventListener("click", action);
    zone.appendChild(element);
    return element;
  }

  // Clics de l'étape (onglet de la box, vue, menu du compte), répétés tant
  // qu'ils n'ont pas pris effet : la page peut brancher ses boutons plus tard.
  function preparerPage(etape) {
    let essais = 0;
    const visible = selecteur => !!document.querySelector(selecteur)?.getClientRects().length;
    const faits = selecteur => (selecteur === "#compte-btn" ? etape.cibles.every(visible) : !!document.querySelector(selecteur)?.classList.contains("active"));
    const essayer = () => {
      if (essais++ > 20) return;
      const clics = [].concat(etape.clic);
      // Pas d'attente du chargement complet (images) : la liste suffit.
      if (clics.some(selecteur => !document.querySelector(selecteur)) || document.querySelector("#liste-collection")?.children.length === 0) {
        setTimeout(essayer, 300);
        return;
      }
      const restants = clics.filter(selecteur => !faits(selecteur));
      if (!restants.length) return;
      restants.forEach(selecteur => document.querySelector(selecteur).click());
      setTimeout(essayer, 500);
    };
    essayer();
  }

  const chemin = () => (location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/");

  function terminerCookie() {
    document.cookie = "tutoriel_actif=; path=/; max-age=0; secure; samesite=lax";
  }

  async function enregistrer(corps) {
    const reponse = await fetch("/api/auth/profile?action=tutoriel", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps)
    });
    if (!reponse.ok) throw new Error("Impossible d'enregistrer ta progression : réessaie.");
  }

  function lancer(numero, test) {
    const etape = ETAPES[numero];
    // Pages ouvertes depuis le tutoriel (règles complètes, autre onglet) :
    // consultables, sans bulle ni renvoi.
    if (PAGES_LIBRES.includes(chemin())) return;
    if (chemin() !== etape.page) {
      location.replace(etape.page);
      return;
    }
    if (etape.assombrir && !etape.cibles) {
      const voile = document.createElement("div");
      voile.className = "tutoriel-voile";
      document.body.appendChild(voile);
    }
    if (etape.cibles) suivreCibles(etape.cibles, etape.assombrir);
    // Bouton Enregistrer de l'étape : son propre halo (il peut être loin
    // des cibles, ex. figé en bas de l'écran).
    if (etape.enregistrer) suivreCibles([etape.enregistrer], false, false);
    if (etape.clic) preparerPage(etape);

    const element = bulle({ progression: `Étape ${numero + 1} / ${ETAPES.length}`, titre: etape.titre, texte: etape.texte });
    const zone = element.querySelector(".tutoriel-actions");
    const etat = element.querySelector(".tutoriel-etat");
    const afficherEtat = (texte, fait) => {
      etat.hidden = !texte;
      etat.textContent = texte;
      etat.className = `tutoriel-etat ${fait ? "fait" : "manque"}`;
    };
    const aller = async cible => {
      if (test) ecrireStockage(CLE_TEST, String(cible));
      else await enregistrer({ etape: cible });
      if (ETAPES[cible].page === chemin()) location.reload();
      else location.href = ETAPES[cible].page;
    };

    // Étapes à remplir : la bulle se réduit pour laisser voir la page.
    if (etape.verifier || etape.remplir) {
      const reduire = bouton(zone, "Réduire", "quitter", () => {
        reduire.textContent = element.classList.toggle("reduite") ? "Agrandir" : "Réduire";
      });
    }
    if (test) bouton(zone, "Quitter le tutoriel", etape.verifier || etape.remplir ? "" : "quitter", () => { retirerStockage(CLE_TEST); location.reload(); });
    if (numero > 0) bouton(zone, "Précédent", "", () => aller(numero - 1).catch(erreur => afficherEtat(erreur.message, false)));

    const derniere = numero === ETAPES.length - 1;
    const principal = bouton(zone, derniere ? "Terminer" : "Suivant", "principal", async () => {
      principal.disabled = true;
      try {
        if (etape.verifier) {
          const resultat = etape.verifier(await lireProfil());
          afficherEtat(resultat.detail, resultat.ok);
          if (!resultat.ok) {
            principal.disabled = false;
            return;
          }
        }
        if (!derniere) return await aller(numero + 1);
        if (test) retirerStockage(CLE_TEST);
        else {
          await enregistrer({ fini: true });
          terminerCookie();
        }
        ecrireStockage(CLE_ASTUCE, "1");
        location.reload();
      } catch (erreur) {
        console.error(erreur);
        afficherEtat(erreur.message, false);
        principal.disabled = false;
      }
    });

    // Déjà faite : rien n'est passé tout seul, le bouton le dit.
    if (etape.verifier) {
      principal.textContent = "Vérifier et continuer";
      lireProfil().then(profil => {
        const resultat = etape.verifier(profil);
        if (!resultat.ok) return afficherEtat(resultat.detail, false);
        afficherEtat(`Déjà fait. ${resultat.detail}`.trim(), true);
        principal.textContent = "Confirmer et passer cette étape";
      }).catch(console.error);
    }
  }

  // Premier match : astuce unique dès que la barre de tri est là.
  function astuceTri() {
    const SELECTEUR = '#barre-outils .tri-btn[data-tri="points"]';
    const attente = setInterval(() => {
      const cible = document.querySelector(SELECTEUR);
      if (!cible || !cible.getClientRects().length) return;
      clearInterval(attente);
      const halo = suivreCibles([SELECTEUR], false);
      const element = bulle({ titre: "Astuce pour ton premier match", texte: "Trie les personnages par points avec ce bouton : tu verras tout de suite les plus forts à bannir ou à choisir." });
      bouton(element.querySelector(".tutoriel-actions"), "Compris", "principal", () => {
        retirerStockage(CLE_ASTUCE);
        halo.remove();
        element.remove();
      });
    }, 1000);
  }

  async function demarrer() {
    if (new URLSearchParams(location.search).has("room")) {
      if (lireStockage(CLE_ASTUCE)) astuceTri();
      return;
    }
    const test = lireStockage(CLE_TEST);
    if (test !== null) {
      const numero = Number(test);
      lancer(Number.isInteger(numero) && ETAPES[numero] ? numero : 0, true);
      return;
    }
    if (!/(^|; )tutoriel_actif=1/.test(document.cookie)) return;
    const reponse = await fetch("/api/auth/profile?action=tutoriel", { credentials: "include" });
    if (!reponse.ok) return;
    const { etape } = await reponse.json();
    if (etape === null) return terminerCookie();
    lancer(ETAPES[etape] ? etape : 0, false);
  }

  demarrer().catch(console.error);
})();
