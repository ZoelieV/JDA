// Fenêtre de choix de cosmétiques (administration des Rikoyns, cf.
// admin_koyns.js) : images en grille par onglet (namecards, bannières, fonds,
// skins et variantes ; onglet Cachés en premier, ouvert par défaut :
// cosmétiques cachés de cosmetiques.json, "caches", seulement donnés par les
// administrateurs), recherche, un ou plusieurs choix à la fois.
// Fonds retirés (config.cosmetiques_retires) : seulement avec avecRetires.
// choisirCosmetiques({ titre, multiple, selection, onglets, etiquette }) ->
// Promise<[ids] | null> (null : annulé ; onglets : ids des onglets proposés,
// tous sinon ; etiquette(id) : texte affiché sur l'image, ex. son prix ;
// apercu : bouton « Aperçu » sur chaque image, qui l'ouvre en grand). infoCosmetiqueAdmin(id) -> { id, type, nom, image, cache }.
// Utilise idCosmetique, COSMETIQUES_GRATUITS (commun/koyns.js), nomFond,
// VARIANTES_PERSONNAGES, SKINS_PERSONNAGES et imagesSkin (commun/variantes.js).

const ONGLETS_CHOIX_COSMETIQUES = [
  { id: "caches", nom: "Cachés" },
  { id: "banniere", nom: "Namecards" },
  { id: "banniere2", nom: "Bannières" },
  { id: "fond", nom: "Fonds d'écran" },
  { id: "persos", nom: "Skins et variantes" }
];
let catalogueChoixCosmetiques = null; // Map id -> info
let promesseCatalogueChoix = null;

// "namecards/Namecard_Background_Hu_Tao_Lingering.webp" -> "Hu Tao Lingering"
function nomNamecardAdmin(chemin) {
  return chemin.split("/").pop()
    .replace(/^Namecard_(Background|Banner)_/, "")
    .replace(/\.[a-z]+$/i, "")
    .replace(/_/g, " ");
}

function chargerCatalogueChoix() {
  promesseCatalogueChoix ??= Promise.all([fetch("/DB/images/cosmetiques.json", { cache: "no-cache" }).then(reponse => reponse.json()), chargerPointsAdmin()])
    .then(([cosmetiques, points]) => {
      const caches = new Set(cosmetiques.caches || []);
      Object.entries(points.cosmetiques_caches || {}).forEach(([id, cache]) => { if (cache) caches.add(id); else caches.delete(id); });
      definirSkinsAjoutes(points.skins_ajoutes);
      const retires = new Set(points.cosmetiques_retires || []);
      const infos = [
        ...cosmetiques.bannieres.map(chemin => ({ id: idCosmetique("banniere", chemin), onglet: "banniere", type: "Namecard", nom: nomNamecardAdmin(chemin), image: `/DB/images/${chemin}` })),
        ...cosmetiques.bannieres2.map(chemin => ({ id: idCosmetique("banniere2", chemin), onglet: "banniere2", type: "Bannière", nom: nomNamecardAdmin(chemin), image: `/DB/images/${chemin}` })),
        ...cosmetiques.fonds.map(fond => ({ id: idCosmetique("fond", fond.id), onglet: "fond", type: "Fond d'écran", nom: nomFond(fond), image: `/DB/images/${fond.miniature}`, imageGrande: encodeURI(`/DB/images/${fond.image}`) })),
        ...Object.values(VARIANTES_PERSONNAGES).flatMap(variante => Object.entries(variante.options).map(([valeur, option]) => ({
          id: idCosmetique(variante.parametre, valeur), onglet: "persos", type: "Variante", nom: option.nom, image: `/DB/${option.image}`
        }))),
        ...SKINS_PERSONNAGES.map(id => ({ id: idCosmetique("skin", id), onglet: "persos", type: "Skin", nom: id, image: `/DB/${imagesSkin(id).item}` })),
        ...SKINS_AJOUTES.map(skin => ({ id: idCosmetique("skin", skin.id), onglet: "persos", type: "Skin", nom: nomSkin(skin.id, skin.perso), image: `/DB/${imagesSkin(skin.id).item}` }))
      ].filter(info => !COSMETIQUES_GRATUITS.has(info.id))
        .map(info => ({ ...info, image: encodeURI(info.image), cache: caches.has(info.id), retire: retires.has(info.id) }));
      catalogueChoixCosmetiques = new Map(infos.map(info => [info.id, info]));
      return catalogueChoixCosmetiques;
    })
    .catch(erreur => {
      promesseCatalogueChoix = null;
      throw erreur;
    });
  return promesseCatalogueChoix;
}

function infoCosmetiqueAdmin(id) {
  return catalogueChoixCosmetiques?.get(id) || { id, type: "Cosmétique", nom: id, image: null, cache: false };
}

// Pastille d'un cosmétique choisi (miniature, nom, ×).
function htmlPastilleCosmetique(id) {
  const info = infoCosmetiqueAdmin(id);
  return `<span class="exclusif-koyns pastille-cosmetique" title="${echapper(`${info.type} : ${id}`)}">` +
    (info.image ? `<img src="${echapper(info.image)}" alt="" loading="lazy">` : "") +
    `${echapper(info.nom)}${info.cache ? ` <small>(caché)</small>` : ""}` +
    `<button type="button" class="retirer-exclusif" data-id="${echapper(id)}" aria-label="Retirer">×</button></span>`;
}

function choisirCosmetiques({ titre = "Choisir des cosmétiques", multiple = true, selection = [], onglets = null, exclure = null, etiquette = null, avecRetires = false, apercu = false } = {}) {
  return new Promise(async resoudre => {
    const catalogue = await chargerCatalogueChoix().catch(() => null);
    if (!catalogue) {
      alert("Impossible de charger les cosmétiques.");
      resoudre(null);
      return;
    }
    const choisis = new Set(selection);
    const nbCaches = [...catalogue.values()].filter(info => info.cache).length;
    const ongletsProposes = ONGLETS_CHOIX_COSMETIQUES.filter(o => !onglets || onglets.includes(o.id));
    let onglet = nbCaches && ongletsProposes.some(o => o.id === "caches") ? "caches" : ongletsProposes.find(o => o.id !== "caches").id;
    const fenetre = document.createElement("div");
    fenetre.className = "modal-apercu active fenetre-choix-cosmetiques";
    fenetre.innerHTML = `
      <div class="modal-apercu-contenu" role="dialog" aria-modal="true">
        <div class="modal-apercu-entete">
          <h2></h2>
          <button type="button" class="fermer-apercu" data-action="annuler" aria-label="Fermer">×</button>
        </div>
        <div class="choix-cosmetiques-onglets">${ongletsProposes.map(o => `<button type="button" class="bouton-creer secondaire" data-onglet="${o.id}">${o.nom}${o.id === "caches" ? ` (${nbCaches})` : ""}</button>`).join("")}</div>
        <div class="choix-cosmetiques-outils">
          <input type="text" class="texte-ajout choix-cosmetiques-recherche" placeholder="Rechercher…" autocomplete="off">
          ${multiple ? `<button type="button" class="bouton-creer secondaire" data-action="tout">Tout l'onglet</button>
          <button type="button" class="bouton-creer secondaire" data-action="aucun">Tout désélectionner</button>` : ""}
        </div>
        <div class="choix-cosmetiques-grille"></div>
        <div class="choix-cosmetiques-pied">
          <span class="choix-cosmetiques-compte"></span>
          <button type="button" class="bouton-creer secondaire" data-action="annuler">Annuler</button>
          ${multiple ? `<button type="button" class="bouton-creer" data-action="valider">Valider</button>` : ""}
        </div>
        ${apercu ? `<div class="apercu-choix-cosmetique" hidden>
          <button type="button" class="bouton-creer secondaire fleche-apercu-choix" data-apercu="precedent" aria-label="Précédent">‹</button>
          <img alt="">
          <button type="button" class="bouton-creer secondaire fleche-apercu-choix" data-apercu="suivant" aria-label="Suivant">›</button>
          <div class="pied-apercu-choix">
            <span class="nom-apercu-choix"></span>
            <button type="button" class="bouton-creer" data-apercu="basculer"></button>
            <button type="button" class="bouton-creer secondaire" data-apercu="fermer">Fermer</button>
          </div>
        </div>` : ""}
      </div>`;
    fenetre.querySelector("h2").textContent = titre;
    const grille = fenetre.querySelector(".choix-cosmetiques-grille");
    const recherche = fenetre.querySelector(".choix-cosmetiques-recherche");

    // Onglet Cachés : namecards puis bannières cachées ; les autres onglets
    // montrent aussi leurs cachés (pastille « caché »).
    const visibles = () => [...catalogue.values()].filter(info => (avecRetires || !info.retire) && !exclure?.(info.id) && (onglet === "caches" ? info.cache : info.onglet === onglet) &&
      (!recherche.value.trim() || `${info.nom} ${info.id}`.toLowerCase().includes(recherche.value.trim().toLowerCase())));

    const majCompte = () => {
      fenetre.querySelector(".choix-cosmetiques-compte").textContent = multiple ? `${choisis.size} sélectionné${choisis.size > 1 ? "s" : ""}` : "";
    };
    const rendre = () => {
      fenetre.querySelectorAll("[data-onglet]").forEach(bouton => bouton.classList.toggle("secondaire", bouton.dataset.onglet !== onglet));
      grille.className = `choix-cosmetiques-grille onglet-${onglet}`;
      const infos = visibles();
      grille.innerHTML = infos.length ? infos.map(info => `
        <button type="button" class="choix-cosmetique${choisis.has(info.id) ? " choisi" : ""}${info.cache ? " est-cache" : ""}" data-id="${echapper(info.id)}" title="${echapper(info.id)}">
          <img src="${echapper(info.image)}" alt="" loading="lazy">
          ${apercu ? `<span class="loupe-choix-cosmetique" title="Voir en grand">Aperçu</span>` : ""}
          ${etiquette ? `<span class="etiquette-choix-cosmetique">${etiquette(info.id)}</span>` : ""}
          <span>${echapper(info.nom)}</span>
        </button>`).join("") : `<p class="aide-apercu">Aucun cosmétique.</p>`;
      majCompte();
    };

    // Aperçu en grand : parcourt les images affichées dans la grille, et permet
    // de choisir sans revenir à la grille.
    const zoneApercu = fenetre.querySelector(".apercu-choix-cosmetique");
    let listeApercu = [];
    let indexApercu = 0;
    const apercuOuvert = () => zoneApercu && !zoneApercu.hidden;
    const majApercu = () => {
      const info = listeApercu[indexApercu];
      zoneApercu.querySelector("img").src = info.imageGrande || info.image;
      zoneApercu.querySelector(".nom-apercu-choix").textContent = `${info.nom} (${indexApercu + 1} / ${listeApercu.length})`;
      const choisi = choisis.has(info.id);
      const bouton = zoneApercu.querySelector("[data-apercu=basculer]");
      bouton.textContent = choisi ? "Désélectionner" : "Sélectionner";
      bouton.classList.toggle("secondaire", choisi);
    };
    const ouvrirApercu = id => {
      listeApercu = visibles();
      indexApercu = Math.max(0, listeApercu.findIndex(info => info.id === id));
      zoneApercu.hidden = false;
      majApercu();
    };
    const fermerApercu = () => {
      zoneApercu.hidden = true;
      zoneApercu.querySelector("img").removeAttribute("src");
    };
    const deplacerApercu = pas => {
      indexApercu = (indexApercu + pas + listeApercu.length) % listeApercu.length;
      majApercu();
    };
    const basculerApercu = () => {
      const { id } = listeApercu[indexApercu];
      if (choisis.has(id)) choisis.delete(id);
      else choisis.add(id);
      grille.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.toggle("choisi", choisis.has(id));
      majCompte();
      majApercu();
    };

    const terminer = resultat => {
      fenetre.remove();
      document.removeEventListener("keydown", surTouche, true);
      resoudre(resultat);
    };
    const surTouche = event => {
      if (apercuOuvert() && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        deplacerApercu(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.key !== "Escape") return;
      if (apercuOuvert()) {
        event.stopPropagation();
        fermerApercu();
        return;
      }
      event.stopPropagation();
      terminer(null);
    };
    document.addEventListener("keydown", surTouche, true);

    fenetre.addEventListener("click", event => {
      if (event.target === fenetre) return terminer(null);
      if (apercuOuvert() && zoneApercu.contains(event.target)) {
        const action = event.target.closest("[data-apercu]")?.dataset.apercu;
        if (action === "precedent") deplacerApercu(-1);
        if (action === "suivant") deplacerApercu(1);
        if (action === "basculer") basculerApercu();
        if (action === "fermer" || event.target === zoneApercu) fermerApercu();
        return;
      }
      const loupe = event.target.closest(".loupe-choix-cosmetique");
      if (loupe) {
        ouvrirApercu(loupe.closest(".choix-cosmetique").dataset.id);
        return;
      }
      const ongletBouton = event.target.closest("[data-onglet]");
      if (ongletBouton) {
        onglet = ongletBouton.dataset.onglet;
        rendre();
        return;
      }
      const carte = event.target.closest(".choix-cosmetique");
      if (carte) {
        const id = carte.dataset.id;
        if (!multiple) return terminer([id]);
        if (choisis.has(id)) choisis.delete(id);
        else choisis.add(id);
        carte.classList.toggle("choisi", choisis.has(id));
        majCompte();
        return;
      }
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "annuler") terminer(null);
      if (action === "valider") terminer([...choisis]);
      if (action === "tout") {
        visibles().forEach(info => choisis.add(info.id));
        rendre();
      }
      if (action === "aucun") {
        choisis.clear();
        rendre();
      }
    });
    recherche.addEventListener("input", rendre);
    document.body.appendChild(fenetre);
    rendre();
    recherche.focus();
  });
}
