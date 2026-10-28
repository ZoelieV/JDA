// Page Cosmétiques (/cosmetiques) : tirages de cosmétiques (ex-onglet
// Tirage de la personnalisation). Un cosmétique au hasard (namecard,
// bannière ou fond pas possédé) ou un cosmétique focus (obtenable seulement
// par tirage, chance et garantie données par le serveur, cf. tirerCosmetique
// dans api/_lib/koyns.js). « Équiper » ouvre la personnalisation avec le
// cosmétique déjà choisi (Personnalisation.ouvrir({ equiper }),
// commun/personnalisation.js). Styles du tirage : commun/personnalisation.css.
(function () {
  const RACINE_IMAGES = "/DB/images/";
  const TYPES_COSMETIQUES = { fond: "Fond d'écran", banniere: "Namecard", banniere2: "Bannière", skin: "Skin", voyageur: "Voyageur", manekin: "Manekin" };

  let koyns = null;       // { solde, tout, possedes: Set, tirage }
  let cosmetiques = null; // DB/images/cosmetiques.json
  let nomsPersos = new Map();
  let tirageEnCours = false;

  const $ = id => document.getElementById(id);
  const urlImage = chemin => encodeURI(RACINE_IMAGES + chemin);
  const texteRikoyns = montant => `${montant} ${ICONE_KOYN}`;
  const possede = id => !koyns || koyns.tout || COSMETIQUES_GRATUITS.has(id) || koyns.possedes.has(id);

  function afficherEtat(texte) {
    $("etat-cosmetiques").textContent = texte;
  }

  function lireEtatKoyns(etat) {
    koyns = { ...etat, possedes: new Set(etat.possedes || []), tirage: etat.tirage ?? null };
    $("solde-cosmetiques").innerHTML = texteRikoyns(koyns.solde);
  }

  function celebrer() {
    const solde = $("solde-cosmetiques");
    solde.classList.remove("achat");
    void solde.offsetWidth;
    solde.classList.add("achat");
  }

  // "namecards/Namecard_Background_Hu_Tao_Lingering.webp" -> "Hu Tao Lingering"
  function nomNamecard(chemin) {
    return chemin.split("/").pop().replace(/^Namecard_(Background|Banner)_/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " ");
  }

  // Nom, type et image d'un cosmétique (id "<choix>:<valeur>").
  function infoCosmetique(id) {
    const [choix, ...reste] = id.split(":");
    const valeur = reste.join(":");
    const type = TYPES_COSMETIQUES[choix] || "Cosmétique";
    if (choix === "fond") {
      const fond = cosmetiques?.fonds.find(f => f.id === valeur);
      return { type, nom: fond ? nomFond(fond) : valeur, image: fond && urlImage(fond.miniature) };
    }
    if (choix === "banniere" || choix === "banniere2") return { type, nom: nomNamecard(valeur), image: urlImage(valeur) };
    if (choix === "skin") return { type, nom: nomsPersos.get(valeur) || valeur, image: urlImage(imagesSkin(valeur).item.replace(/^images\//, "")) };
    const option = Object.values(VARIANTES_PERSONNAGES).find(v => v.parametre === choix)?.options[valeur];
    return { type, nom: option?.nom || valeur, image: option && urlImage(option.image.replace(/^images\//, "")) };
  }

  function equiper(id) {
    window.Personnalisation?.ouvrir({ equiper: id });
  }

  function rendreTirage() {
    const conteneur = $("tirage-cosmetiques");
    conteneur.innerHTML = "";
    const tirage = koyns?.tirage;
    if (!tirage) {
      conteneur.textContent = "Tirage indisponible pour l'instant.";
      return;
    }
    const restants = Math.max(1, tirage.garantie - tirage.compteur);
    const focusRestants = tirage.focus.filter(id => !possede(id));
    const bloc = document.createElement("div");
    bloc.className = "perso-tirage";
    bloc.innerHTML = `
      <p class="perso-note">Pour ${texteRikoyns(tirage.prix)}, un cosmétique au hasard : une namecard, une bannière ou un fond d'écran que tu n'as pas encore.
        ${tirage.focus.length ? `1 chance sur ${Math.round(1 / tirage.chance)} d'obtenir un <strong>cosmétique focus</strong> (seulement par tirage), garanti au ${tirage.garantie}e tirage sans focus.` : ""}</p>
      ${tirage.focus.length ? `
        <h3 class="perso-categorie">Focus</h3>
        <div class="perso-tirage-focus"></div>
        ${focusRestants.length ? `
          <div class="perso-tirage-garantie">
            <span>Focus garanti dans <strong>${restants}</strong> tirage${restants > 1 ? "s" : ""}</span>
            <span class="perso-tirage-jauge"><span style="width: ${Math.min(100, tirage.compteur / (tirage.garantie - 1) * 100)}%"></span></span>
          </div>` : `<p class="perso-note">Tu as tous les cosmétiques focus !</p>`}` : ""}
      <div class="perso-tirer-boutons">
        <button type="button" class="perso-tirer" data-nombre="1">🎲 Tirer · ${texteRikoyns(tirage.prix)}</button>
        <button type="button" class="perso-tirer" data-nombre="10">🎲 Tirer ×10 · ${texteRikoyns(tirage.prix * 10)}</button>
      </div>`;
    const vitrine = bloc.querySelector(".perso-tirage-focus");
    tirage.focus.forEach(id => {
      const info = infoCosmetique(id);
      const carte = document.createElement("figure");
      carte.className = `perso-tirage-carte${possede(id) ? " possede" : ""}`;
      carte.innerHTML = `${info.image ? `<img src="${info.image}" alt="" loading="lazy">` : ""}<figcaption><strong></strong><small>${info.type}${possede(id) ? " · obtenu ✓" : ""}</small></figcaption>`;
      carte.querySelector("strong").textContent = info.nom;
      vitrine?.appendChild(carte);
    });
    bloc.querySelectorAll(".perso-tirer").forEach(bouton => {
      const prix = tirage.prix * Number(bouton.dataset.nombre);
      bouton.disabled = koyns.solde < prix;
      if (bouton.disabled) bouton.title = `Il faut ${prix} Rikoyns : joue des matchs pour en gagner.`;
      bouton.addEventListener("click", () => tirer(Number(bouton.dataset.nombre)));
    });
    conteneur.appendChild(bloc);
  }

  // nombre : 1 ou 10 tirages.
  async function tirer(nombre = 1) {
    if (tirageEnCours) return;
    tirageEnCours = true;
    afficherEtat("Tirage…");
    try {
      const reponse = await fetch("/api/auth/profile?action=tirer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre })
      });
      const donnees = await reponse.json().catch(() => ({}));
      if (donnees.koyns) lireEtatKoyns(donnees.koyns);
      if (!reponse.ok) throw new Error(donnees.error || "Tirage impossible.");
      afficherEtat(donnees.arret ? `Tirages arrêtés après ${donnees.tirages.length} : ${donnees.arret}` : "");
      celebrer();
      rendreTirage();
      if (nombre > 1) revelerGains(donnees.tirages || [donnees.tirage]);
      else revelerGain(donnees.tirage);
    } catch (erreur) {
      console.error(erreur);
      afficherEtat(erreur.message);
    } finally {
      tirageEnCours = false;
    }
  }

  function preparerFenetre(fenetre) {
    fenetre.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    fenetre.addEventListener("close", () => fenetre.remove());
    document.body.appendChild(fenetre);
    fenetre.showModal();
  }

  // Fenêtre du gain : carte retournée (dorée pour un focus), équiper,
  // retirer encore.
  function revelerGain({ cosmetique, focus }) {
    const info = infoCosmetique(cosmetique);
    const fenetre = document.createElement("dialog");
    fenetre.className = `perso-fenetre perso-fenetre-gain${focus ? " focus" : ""}`;
    fenetre.innerHTML = `
      <h3 class="perso-fenetre-titre">${focus ? "✨ Focus ! ✨" : "Tirage"}</h3>
      <div class="perso-gain-carte">
        <div class="perso-gain-dos" aria-hidden="true">🎲</div>
        <div class="perso-gain-face">${info.image ? `<img src="${info.image}" alt="">` : ""}</div>
      </div>
      <p class="perso-gain-nom"><strong></strong><small>${info.type}</small></p>
      <div class="perso-fenetre-actions">
        <button type="button" data-action="fermer">Fermer</button>
        <button type="button" data-action="encore"></button>
        <button type="button" class="perso-fenetre-ok" data-action="equiper">Équiper</button>
      </div>`;
    fenetre.querySelector(".perso-gain-nom strong").textContent = info.nom;
    const encore = fenetre.querySelector('[data-action="encore"]');
    encore.innerHTML = `Retirer · ${texteRikoyns(koyns.tirage?.prix ?? 10)}`;
    encore.disabled = !koyns.tirage || koyns.solde < koyns.tirage.prix;
    fenetre.addEventListener("click", event => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (event.target === fenetre || action === "fermer") fenetre.close();
      if (action === "equiper") {
        fenetre.close();
        equiper(cosmetique);
      }
      if (action === "encore") {
        fenetre.close();
        tirer();
      }
    });
    preparerFenetre(fenetre);
  }

  // Fenêtre de plusieurs gains : cartes retournées l'une après l'autre
  // (dorées pour un focus) ; clic sur une carte : l'équiper.
  function revelerGains(tirages) {
    const nbFocus = tirages.filter(t => t.focus).length;
    const fenetre = document.createElement("dialog");
    fenetre.className = `perso-fenetre perso-fenetre-gain perso-fenetre-gains${nbFocus ? " focus" : ""}`;
    fenetre.innerHTML = `
      <h3 class="perso-fenetre-titre">${nbFocus ? `✨ ${nbFocus > 1 ? `${nbFocus} focus` : "Focus"} ! ✨` : `${tirages.length} tirages`}</h3>
      <div class="perso-gains-grille"></div>
      <p class="perso-note">Clic sur un cosmétique pour l'équiper.</p>
      <div class="perso-fenetre-actions">
        <button type="button" data-action="fermer">Fermer</button>
        <button type="button" class="perso-fenetre-ok" data-action="encore"></button>
      </div>`;
    const grille = fenetre.querySelector(".perso-gains-grille");
    tirages.forEach(({ cosmetique, focus }, i) => {
      const info = infoCosmetique(cosmetique);
      const carte = document.createElement("button");
      carte.type = "button";
      carte.className = `perso-gains-carte${focus ? " focus" : ""}`;
      carte.style.setProperty("--delai", `${i * 0.15}s`);
      carte.dataset.id = cosmetique;
      carte.title = `${info.nom} (${info.type}) : clic pour l'équiper`;
      carte.innerHTML = `
        <span class="perso-gain-carte">
          <span class="perso-gain-dos" aria-hidden="true">🎲</span>
          <span class="perso-gain-face">${info.image ? `<img src="${info.image}" alt="">` : ""}</span>
        </span>
        <span class="perso-gains-nom"></span>`;
      carte.querySelector(".perso-gains-nom").textContent = info.nom;
      grille.appendChild(carte);
    });
    const encore = fenetre.querySelector('[data-action="encore"]');
    const prix = (koyns.tirage?.prix ?? 10) * 10;
    encore.innerHTML = `Retirer ×10 · ${texteRikoyns(prix)}`;
    encore.disabled = !koyns.tirage || koyns.solde < prix;
    fenetre.addEventListener("click", event => {
      const carte = event.target.closest(".perso-gains-carte");
      if (carte) {
        fenetre.close();
        equiper(carte.dataset.id);
        return;
      }
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (event.target === fenetre || action === "fermer") fenetre.close();
      if (action === "encore") {
        fenetre.close();
        tirer(10);
      }
    });
    preparerFenetre(fenetre);
  }

  async function demarrer() {
    $("ouvrir-personnalisation").addEventListener("click", () => window.Personnalisation?.ouvrir());
    try {
      const [reponse, cosmetiquesJson, personnages] = await Promise.all([
        fetch("/api/auth/profile", { credentials: "include" }),
        fetch(`${RACINE_IMAGES}cosmetiques.json`).then(r => r.json()),
        fetch("/DB/characters.json").then(r => r.json()).catch(() => [])
      ]);
      cosmetiques = cosmetiquesJson;
      nomsPersos = new Map(personnages.map(perso => [perso.id, perso.nom]));
      if (reponse.status === 401) {
        $("tirage-cosmetiques").innerHTML = `<p class="perso-note">Connecte-toi avec Discord pour faire des tirages.</p>`;
        return;
      }
      const donnees = await reponse.json();
      if (!reponse.ok || !donnees.koyns) throw new Error(donnees.error || "Chargement impossible.");
      lireEtatKoyns(donnees.koyns);
      rendreTirage();
    } catch (erreur) {
      console.error(erreur);
      $("tirage-cosmetiques").innerHTML = `<p class="perso-note">Impossible de charger le tirage.</p>`;
    }
  }

  // Achat ou tirage fait dans la personnalisation : solde relu.
  document.addEventListener("personnalisation-enregistree", () => {
    fetch("/api/auth/profile", { credentials: "include" })
      .then(r => r.json())
      .then(donnees => { if (donnees.koyns) { lireEtatKoyns(donnees.koyns); rendreTirage(); } })
      .catch(() => {});
  });

  demarrer();
})();
