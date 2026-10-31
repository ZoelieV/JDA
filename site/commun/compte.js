// Bouton du compte (deuxième bannière, photo, pseudo) en haut à droite des
// pages ; bouton de connexion Discord si l'utilisateur n'est pas connecté.
// Pas sur Mon compte (menu du compte propre).
// Clic sur la photo : menu des paramètres, comme sur Mon compte (UID,
// niveau du monde, stream, théâtre, zoom du site, Personnalisation ouverte
// sur place avec Voyageur / Manekin / skins, Déconnexion) ; clic ailleurs sur la
// bannière : Mon compte.
//
// Placé dans #zone-compte si la page en a un (accueil), sinon dans une zone
// ajoutée en haut à droite de la page. À inclure avec defer, après fond.js.
(function () {
  // Source des visiteurs (statistiques d'inscription, cf.
  // api/_lib/statistiques.js) : à la première arrivée, ?src=... ou
  // ?utm_source=... du lien de pub, sinon le site d'où vient le visiteur ;
  // gardée 30 jours dans le cookie source_pub, enregistrée sur le profil à
  // sa création (cf. api/auth/discord/callback.js).
  try {
    if (!/(?:^|;\s*)source_pub=/.test(document.cookie)) {
      const parametres = new URLSearchParams(location.search);
      let source = parametres.get("src") || parametres.get("utm_source");
      if (!source && document.referrer) {
        const origine = new URL(document.referrer).hostname.replace(/^www\./, "");
        if (origine && origine !== location.hostname) source = origine;
      }
      source = (source || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
      if (source) document.cookie = `source_pub=${source}; Max-Age=${30 * 24 * 3600}; Path=/; SameSite=Lax; Secure`;
    }
  } catch {
    // Cookie ou URL illisible : pas de source.
  }

  const PAGE_COMPTE = "/compte";
  const ICONES = "/DB/images/others/";
  // Champs du menu enregistrés dans le profil (mêmes que sur Mon compte).
  const CHAMPS = [
    // UID Genshin : 9 chiffres ou vide (vérifié aussi par le serveur).
    { id: "menu-uid", label: "UID", inputmode: "numeric", maxlength: 9, placeholder: "744102007",
      lire: p => p.uid || "", ecrire: (p, v) => { p.uid = v.trim(); } },
    { id: "menu-niveau-monde", label: "Niveau du monde", lire: p => p.niveau_monde || "", ecrire: (p, v) => { p.niveau_monde = v; },
      options: [["", "Choisir"], ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => [n, n])] },
    // Nettoyé par le serveur (http(s) seulement, cf. api/auth/profile.js).
    { id: "menu-stream", label: "Lien de stream (Twitch ou YouTube)", type: "url", placeholder: "https://twitch.tv/…",
      lire: p => p.stream || "", ecrire: (p, v) => { p.stream = v.trim(); } }
    // Théâtre : palier calculé sur la full box (cf. palierTheatre,
    // api/_lib/personnages.js), plus choisi ici.
  ];
  // Voyageur, Manekin et skins : dans Personnalisation (commun/personnalisation.js).

  // Personnalisation ouverte sur place (commun/personnalisation.js, chargé au
  // 1er clic).
  let promessePersonnalisation = null;
  function chargerPersonnalisation() {
    // Déjà chargée par la page (page Cosmétiques).
    if (window.Personnalisation) return Promise.resolve();
    promessePersonnalisation ??= new Promise((resoudre, rejeter) => {
      const script = document.createElement("script");
      script.src = "/commun/personnalisation.js?v=39";
      script.onload = resoudre;
      script.onerror = () => {
        promessePersonnalisation = null;
        rejeter(new Error("Impossible de charger la personnalisation."));
      };
      document.head.appendChild(script);
    });
    return promessePersonnalisation;
  }

  async function lireProfil() {
    const reponse = await fetch("/api/auth/profile", { credentials: "include" });
    if (!reponse.ok) throw new Error("Impossible de charger le profil.");
    return (await reponse.json()).profil || {};
  }

  function creerMenu() {
    const menu = document.createElement("div");
    menu.className = "menu-compte cache";
    menu.id = "menu-compte-global";
    menu.innerHTML = `
      ${CHAMPS.map(champ => `
        <div class="menu-champ">
          <label for="${champ.id}">${champ.label}</label>
          ${champ.options
            ? `<select id="${champ.id}">${champ.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>`
            : `<input type="${champ.type || "text"}" id="${champ.id}"${champ.placeholder ? ` placeholder="${champ.placeholder}"` : ""}${champ.inputmode ? ` inputmode="${champ.inputmode}"` : ""}${champ.maxlength ? ` maxlength="${champ.maxlength}"` : ""}>`}
        </div>`).join("")}
      <button type="button" class="menu-btn menu-btn-principal" data-action="enregistrer" disabled>Enregistrer</button>
      <p class="menu-etat cache"></p>
      <div class="menu-separateur"></div>
      <button type="button" class="menu-btn" data-action="personnalisation"><img class="menu-icone" src="${ICONES}Icon_Photo_Mode.webp" alt="">Personnalisation</button>
      <button type="button" class="menu-btn" data-installer-appli style="display: none"><img class="menu-icone" src="/DB/images/others/logo_site.webp" alt="">Installer l'appli</button>
      <button type="button" class="menu-btn" data-action="deconnexion"><img class="menu-icone" src="${ICONES}Icon_Quit_Game.webp" alt="">Déconnexion</button>
    `;
    return menu;
  }

  // Menu : champs remplis depuis le profil à la 1re ouverture ; Enregistrer
  // relit le profil (changements faits ailleurs entre-temps) et n'y change
  // que ces champs.
  function brancherMenu(zone, bouton, photo, menu) {
    let valeursChargees = null; // { id: valeur } à l'ouverture
    const champ = id => menu.querySelector(`#${id}`);
    const etat = menu.querySelector(".menu-etat");
    const btnEnregistrer = menu.querySelector('[data-action="enregistrer"]');
    const afficherEtat = texte => {
      etat.textContent = texte;
      etat.classList.toggle("cache", !texte);
    };
    const modifie = () => valeursChargees && CHAMPS.some(c => champ(c.id).value !== valeursChargees[c.id]);

    // Comme sur Mon compte (verrouillerChampsDefinitifs, cf.
    // erreurChampsDefinitifs dans api/auth/profile.js) : UID et stream plus
    // modifiables une fois enregistrés (corrections par les admins) ; niveau
    // du monde : un cran sous le plus haut enregistré au minimum, plus
    // "Choisir" une fois renseigné.
    function verrouiller(profil) {
      [["menu-uid", "uid", "UID"], ["menu-stream", "stream", "Lien de stream"]].forEach(([id, cle, nom]) => {
        const verrouille = !!profil[cle];
        champ(id).readOnly = verrouille;
        champ(id).title = verrouille ? `${nom} déjà renseigné : il ne peut plus être modifié.` : "";
      });
      const max = Math.max(Number(profil.niveau_monde_max) || 0, Number(profil.niveau_monde) || 0);
      champ("menu-niveau-monde").querySelectorAll("option").forEach(option => {
        option.disabled = !!max && (option.value === "" || Number(option.value) < max - 1);
      });
    }

    async function charger() {
      afficherEtat("Chargement…");
      try {
        const profil = await lireProfil();
        valeursChargees = {};
        CHAMPS.forEach(c => {
          valeursChargees[c.id] = c.lire(profil);
          champ(c.id).value = valeursChargees[c.id];
        });
        verrouiller(profil);
        afficherEtat("");
      } catch (erreur) {
        console.error(erreur);
        afficherEtat("Erreur de chargement du profil.");
      }
      btnEnregistrer.disabled = !modifie();
    }

    function ouvrir(ouvert) {
      menu.classList.toggle("cache", !ouvert);
      photo.setAttribute("aria-expanded", String(ouvert));
      bouton.classList.toggle("menu-ouvert", ouvert);
      if (ouvert && !valeursChargees) charger();
      if (ouvert) window.Appli?.rafraichir();
    }

    photo.addEventListener("click", event => {
      event.stopPropagation();
      ouvrir(menu.classList.contains("cache"));
    });

    menu.addEventListener("input", () => { btnEnregistrer.disabled = !modifie(); });
    menu.addEventListener("change", () => { btnEnregistrer.disabled = !modifie(); });

    btnEnregistrer.addEventListener("click", async () => {
      if (!/^(\d{9})?$/.test(champ("menu-uid").value.trim())) {
        afficherEtat("UID refusé : 9 chiffres attendus (ex. 744102007).");
        return;
      }
      btnEnregistrer.disabled = true;
      afficherEtat("Enregistrement…");
      try {
        const profil = await lireProfil();
        CHAMPS.forEach(c => c.ecrire(profil, champ(c.id).value));
        const reponse = await fetch("/api/auth/profile", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profil)
        });
        if (!reponse.ok) {
          // Ex. lien de stream refusé (Twitch / YouTube uniquement).
          const { error } = await reponse.json().catch(() => ({}));
          throw new Error(error || "Erreur lors de l'enregistrement.");
        }
        window.FondEcran?.memoriserTheatre(profil.theatre);
        // Relu tel qu'enregistré (lien de stream complété par le serveur,
        // champs maintenant verrouillés).
        await charger();
        afficherEtat("Enregistré ✓");
      } catch (erreur) {
        console.error(erreur);
        afficherEtat(erreur.message || "Erreur lors de l'enregistrement.");
        btnEnregistrer.disabled = !modifie();
      }
    });

    menu.querySelector('[data-action="personnalisation"]').addEventListener("click", async () => {
      ouvrir(false);
      try {
        await chargerPersonnalisation();
        window.Personnalisation.ouvrir();
      } catch (erreur) {
        console.error(erreur);
        // Repli : la personnalisation de Mon compte.
        window.location.href = `${PAGE_COMPTE}?personnalisation=1`;
      }
    });

    // Déconnexion en POST (cf. api/auth/logout.js), puis page d'accueil.
    async function deconnecter() {
      try {
        const reponse = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        const { redirection } = await reponse.json().catch(() => ({}));
        if (!reponse.ok) throw new Error();
        window.location.href = redirection || "/";
      } catch {
        alert("Erreur lors de la déconnexion : réessaie.");
      }
    }

    menu.querySelector('[data-action="deconnexion"]').addEventListener("click", () => {
      if (!confirm("Se déconnecter ?")) return;
      // Plus de fond personnalisé une fois déconnecté (comme sur Mon compte).
      window.FondEcran?.memoriser(null, null);
      window.FondEcran?.memoriserTheatre(null);
      window.FondEcran?.memoriserTrophees(null);
      deconnecter();
    });

    // Clic en dehors du menu ou Échap : fermeture.
    document.addEventListener("click", event => {
      if (!zone.contains(event.target)) ouvrir(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") ouvrir(false);
    });
  }

  // Bonus de connexion d'un événement (Rikoyns et / ou cosmétique, cf.
  // api/_lib/koyns.js) : petite annonce en bas de l'écran, quelques
  // secondes.
  // ---- Fenêtre des récompenses ----
  // Rikoyns et cosmétiques reçus depuis la dernière visite sur ce
  // navigateur (cf. lireNouveautes, api/_lib/koyns.js) : date du serveur
  // gardée par joueur dans le localStorage.
  const LIBELLES_GAINS = {
    match: nb => nb > 1 ? `${nb} matchs joués` : "1 match joué",
    don: () => "Don d'un administrateur",
    connexion: () => "Bonus de connexion de l'événement",
    depart: () => "Rikoyns de départ"
  };
  const cleVisite = id => `recompenses-vues-${id}`;

  function lireDerniereVisite(id) {
    try { return localStorage.getItem(cleVisite(id)); } catch { return null; }
  }

  function noterVisite(id, date) {
    try { if (date) localStorage.setItem(cleVisite(id), date); } catch { /* stockage bloqué */ }
  }

  function echapper(texte) {
    return String(texte ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // Récompense annoncée d'un tournoi (cf. tournois/commun.js).
  const PRIX_TOURNOIS = {
    cosmetiques: "des cosmétiques du site",
    battle_pass: "le battle pass",
    faveur: "la faveur de l'astre",
    pack: "un pack Genshin"
  };

  function afficherRecompenses({ koyns = {}, cosmetiques = [], tournois = [] }, ouvrirPersonnalisation) {
    const total = Object.values(koyns).reduce((somme, gain) => somme + gain.total, 0);
    const fenetre = document.createElement("dialog");
    fenetre.className = "fenetre-recompenses";
    fenetre.setAttribute("aria-label", "Récompenses reçues");
    fenetre.innerHTML = `
      <div class="recompenses-eclat" aria-hidden="true"></div>
      <h2>${tournois.length ? "Victoire !" : "Récompenses reçues !"}</h2>
      ${tournois.map(t => `
        <div class="recompenses-tournoi">
          <p class="recompenses-tournoi-titre">🏆 Tu remportes le tournoi « ${echapper(t.nom)} » !</p>
          ${PRIX_TOURNOIS[t.recompense?.type] ? `<p>Tu gagnes ${PRIX_TOURNOIS[t.recompense.type]}${t.recompense.texte ? ` : ${echapper(t.recompense.texte)}` : ""}. À récupérer auprès de l'organisateur.</p>` : ""}
          <a href="/tournoi?id=${encodeURIComponent(t.id)}">Voir le tournoi</a>
        </div>`).join("")}
      ${total ? `
        <p class="recompenses-total">+${total} <img src="${ICONES}rikoyn.webp" alt=""> <span>Rikoyns</span></p>
        <ul class="recompenses-lignes">${Object.entries(koyns).map(([raison, gain]) => `
          <li><span>${echapper((LIBELLES_GAINS[raison] || (() => "Gain"))(gain.nb))}</span><strong>+${gain.total}</strong></li>`).join("")}
        </ul>` : ""}
      ${cosmetiques.length ? `
        <p class="recompenses-sous-titre">${cosmetiques.length > 1 ? `${cosmetiques.length} nouveaux cosmétiques` : "Nouveau cosmétique"}</p>
        <div class="recompenses-cosmetiques">${cosmetiques.map(c => `
          <figure>${c.image ? `<img src="/DB/${echapper(c.image)}" alt="" loading="lazy">` : `<span class="recompenses-sans-image">?</span>`}<figcaption>${echapper(c.type)}</figcaption></figure>`).join("")}
        </div>` : ""}
      <div class="recompenses-actions">
        ${cosmetiques.length ? `<button type="button" class="recompenses-btn secondaire" data-action="porter">Personnalisation</button>` : ""}
        <button type="button" class="recompenses-btn" data-action="fermer">Super !</button>
      </div>`;
    const fermer = () => { fenetre.close(); fenetre.remove(); };
    fenetre.querySelector('[data-action="fermer"]').addEventListener("click", fermer);
    fenetre.querySelector('[data-action="porter"]')?.addEventListener("click", () => {
      fermer();
      ouvrirPersonnalisation();
    });
    fenetre.addEventListener("click", event => { if (event.target === fenetre) fermer(); });
    fenetre.addEventListener("close", () => fenetre.remove());
    document.body.appendChild(fenetre);
    fenetre.showModal();
  }

  // Bandeau « match de tournoi lancé » (cf. matchTournoiEnCours dans
  // api/auth/me.js), masquable pour cette room.
  function afficherMatchTournoi({ room_id: roomId, equipe, nom }) {
    const cle = `bandeau-tournoi-${roomId}`;
    try { if (sessionStorage.getItem(cle)) return; } catch { /* stockage bloqué */ }
    const bandeau = document.createElement("div");
    bandeau.className = "bandeau-match-tournoi";
    bandeau.setAttribute("role", "status");
    bandeau.innerHTML = `<span>🏆 Ton match de tournoi${nom ? ` « ${echapper(nom)} »` : ""} est lancé !</span>
      <a class="recompenses-btn" href="/${equipe ? "equipe" : "match"}?room=${encodeURIComponent(roomId)}">Rejoindre</a>
      <button type="button" class="fermer-bandeau-tournoi" aria-label="Masquer">×</button>`;
    bandeau.querySelector("button").addEventListener("click", () => {
      try { sessionStorage.setItem(cle, "1"); } catch { /* stockage bloqué */ }
      bandeau.remove();
    });
    document.body.appendChild(bandeau);
  }

  async function demarrer() {
    let zone = document.getElementById("zone-compte");
    if (!zone) {
      zone = document.createElement("div");
      zone.id = "zone-compte";
      zone.className = "zone-compte flottante";
      document.body.prepend(zone);
    }

    // Connecté : jamais le bouton de connexion, même si l'affichage du compte
    // échoue ensuite (bannière, médaille...).
    let connecte = false;
    try {
      // Dernière visite (récompenses) : du joueur précédemment connecté sur
      // ce navigateur, vérifié une fois l'id connu.
      const idPrecedent = (() => { try { return localStorage.getItem("recompenses-joueur"); } catch { return null; } })();
      const depuis = idPrecedent && lireDerniereVisite(idPrecedent);
      const reponse = await fetch(`/api/auth/me${depuis ? `?depuis=${encodeURIComponent(depuis)}` : ""}`, { credentials: "include" });

      if (reponse.ok) {
        connecte = true;
        const { user, maintenant, nouveautes, match_tournoi: matchTournoi } = await reponse.json();
        const nom = user.global_name || user.username || "Mon compte";
        // Autre compte que celui de la date envoyée : date de ce compte (ou
        // rien) à la prochaine visite, pas de fenêtre cette fois.
        try { localStorage.setItem("recompenses-joueur", user.id); } catch { /* stockage bloqué */ }
        if (idPrecedent === user.id || !lireDerniereVisite(user.id)) noterVisite(user.id, maintenant);
        if (matchTournoi) afficherMatchTournoi(matchTournoi);
        if (nouveautes && idPrecedent === user.id) {
          afficherRecompenses(nouveautes, async () => {
            try {
              await chargerPersonnalisation();
              window.Personnalisation.ouvrir();
            } catch (erreur) {
              console.error(erreur);
              window.location.href = `${PAGE_COMPTE}?personnalisation=1`;
            }
          });
        }

        // Accès réservés aux administrateurs et mini admins (ex. carte
        // Administration de l'accueil ; lecture seule pour les mini admins).
        // Theorycraft : connectés seulement, sauf shadowbans (cf.
        // api/auth/me.js).
        if (user.theorycraft) {
          document.querySelectorAll(".carte-theorycraft").forEach(carte => { carte.hidden = false; });
        }
        if (user.admin || user.mini_admin) {
          document.querySelectorAll(".carte-admin").forEach(carte => { carte.hidden = false; });
        }

        const conteneur = document.createElement("div");
        conteneur.className = "compte-menu-zone";

        // Bannière : mène à Mon compte (sauf la photo, qui ouvre le menu).
        const bouton = document.createElement("div");
        bouton.className = "compte-lien";
        bouton.setAttribute("role", "link");
        bouton.tabIndex = 0;
        bouton.title = "Mon compte";
        bouton.addEventListener("click", event => {
          if (!event.target.closest(".compte-photo")) window.location.href = PAGE_COMPTE;
        });
        bouton.addEventListener("keydown", event => {
          if (event.key === "Enter" && event.target === bouton) window.location.href = PAGE_COMPTE;
        });

        const photo = document.createElement("button");
        photo.type = "button";
        photo.className = "compte-photo";
        photo.title = "Paramètres du compte";
        photo.setAttribute("aria-haspopup", "true");
        photo.setAttribute("aria-expanded", "false");
        const avatar = document.createElement("img");
        avatar.src = user.avatar || `${ICONES}Icon_Settings.webp`;
        avatar.alt = "Paramètres du compte";
        photo.appendChild(avatar);
        bouton.appendChild(photo);

        const texte = document.createElement("span");
        texte.textContent = nom;
        bouton.appendChild(texte);

        const menu = creerMenu();
        // Zoom du site (ordinateur, cf. commun/zoom.js).
        window.ZoomSite?.inserer(menu);
        conteneur.append(bouton, menu);
        zone.appendChild(conteneur);
        brancherMenu(conteneur, bouton, photo, menu);

        // Deuxième bannière en fond du bouton et médaille du théâtre après le
        // pseudo (cf. commun/fond.js).
        window.FondEcran?.appliquerBanniere2(bouton, window.FondEcran.banniere2());
        document.addEventListener("banniere2-change", event => {
          window.FondEcran.appliquerBanniere2(bouton, event.detail);
        });
        window.FondEcran?.appliquerMedaille(bouton, window.FondEcran.theatre());
        document.addEventListener("theatre-change", event => {
          window.FondEcran.appliquerMedaille(bouton, event.detail);
        });
        // Rang du classé (trophées de la saison), à côté de la médaille.
        window.FondEcran?.appliquerRang(bouton, window.FondEcran.trophees());
        document.addEventListener("trophees-change", event => {
          window.FondEcran.appliquerRang(bouton, event.detail);
        });
        return;
      }
    } catch (erreur) {
      console.error(erreur);
    }
    if (connecte) return;

    const connexion = document.createElement("a");
    connexion.className = "compte-connexion";
    // Retour sur la page en cours après la connexion (cf. api/auth/discord/login.js).
    connexion.href = `/api/auth/discord/login?retour=${encodeURIComponent(location.pathname + location.search)}`;
    connexion.textContent = "Connexion Discord";
    zone.appendChild(connexion);
  }

  demarrer();
})();
