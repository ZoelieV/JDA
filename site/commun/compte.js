// Bouton du compte (deuxième bannière, photo, pseudo) en haut à droite des
// pages ; bouton de connexion Discord si l'utilisateur n'est pas connecté.
// Pas sur Mon compte (menu du compte propre) ni dans les rooms de match.
// Clic sur la photo : menu des paramètres, comme sur Mon compte (UID,
// niveau du monde, stream, théâtre, zoom du site, Personnalisation ouverte
// sur place avec Voyageur / Manekin / skins, Déconnexion) ; clic ailleurs sur la
// bannière : Mon compte.
//
// Placé dans #zone-compte si la page en a un (accueil), sinon dans une zone
// ajoutée en haut à droite de la page. À inclure avec defer, après fond.js.
(function () {
  const PAGE_COMPTE = "/my_account/my_account.html";
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
      lire: p => p.stream || "", ecrire: (p, v) => { p.stream = v.trim(); } },
    { id: "menu-theatre", label: "Théâtre clear", lire: p => p.theatre || "", ecrire: (p, v) => { p.theatre = v; },
      options: [["", "Choisir"], ["1", "6"], ["2", "8"], ["3", "10"], ["4", "12"]] }
  ];
  // Voyageur, Manekin et skins : dans Personnalisation (commun/personnalisation.js).

  // Personnalisation ouverte sur place (commun/personnalisation.js, chargé au
  // 1er clic).
  let promessePersonnalisation = null;
  function chargerPersonnalisation() {
    promessePersonnalisation ??= new Promise((resoudre, rejeter) => {
      const script = document.createElement("script");
      script.src = "/commun/personnalisation.js?v=5";
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

    async function charger() {
      afficherEtat("Chargement…");
      try {
        const profil = await lireProfil();
        valeursChargees = {};
        CHAMPS.forEach(c => {
          valeursChargees[c.id] = c.lire(profil);
          champ(c.id).value = valeursChargees[c.id];
        });
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
        CHAMPS.forEach(c => { valeursChargees[c.id] = champ(c.id).value; });
        window.FondEcran?.memoriserTheatre(profil.theatre);
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

    menu.querySelector('[data-action="deconnexion"]').addEventListener("click", () => {
      if (!confirm("Se déconnecter ?")) return;
      // Plus de fond personnalisé une fois déconnecté (comme sur Mon compte).
      window.FondEcran?.memoriser(null, null);
      window.FondEcran?.memoriserTheatre(null);
      window.location.href = "/api/auth/logout";
    });

    // Clic en dehors du menu ou Échap : fermeture.
    document.addEventListener("click", event => {
      if (!zone.contains(event.target)) ouvrir(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") ouvrir(false);
    });
  }

  async function demarrer() {
    let zone = document.getElementById("zone-compte");
    if (!zone) {
      zone = document.createElement("div");
      zone.id = "zone-compte";
      zone.className = "zone-compte flottante";
      document.body.prepend(zone);
    }

    try {
      const reponse = await fetch("/api/auth/me", { credentials: "include" });

      if (reponse.ok) {
        const { user } = await reponse.json();
        const nom = user.global_name || user.username || "Mon compte";

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
        return;
      }
    } catch (erreur) {
      console.error(erreur);
    }

    const connexion = document.createElement("a");
    connexion.className = "compte-connexion";
    connexion.href = "/api/auth/discord/login";
    connexion.textContent = "Connexion Discord";
    zone.appendChild(connexion);
  }

  demarrer();
})();
