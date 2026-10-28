// Fenêtre de choix de cosmétiques (administration des Rikoyns, cf.
// admin_koyns.js) : images en grille par onglet (namecards, bannières, fonds,
// skins et variantes ; onglet Cachés en premier, ouvert par défaut :
// cosmétiques cachés de cosmetiques.json, "caches", seulement donnés par les
// administrateurs), recherche, un ou plusieurs choix à la fois.
// choisirCosmetiques({ titre, multiple, selection }) -> Promise<[ids] | null>
// (null : annulé). infoCosmetiqueAdmin(id) -> { id, type, nom, image, cache }.
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
  promesseCatalogueChoix ??= fetch("/DB/images/cosmetiques.json", { cache: "no-cache" })
    .then(reponse => reponse.json())
    .then(cosmetiques => {
      const caches = new Set(cosmetiques.caches || []);
      const infos = [
        ...cosmetiques.bannieres.map(chemin => ({ id: idCosmetique("banniere", chemin), onglet: "banniere", type: "Namecard", nom: nomNamecardAdmin(chemin), image: `/DB/images/${chemin}` })),
        ...cosmetiques.bannieres2.map(chemin => ({ id: idCosmetique("banniere2", chemin), onglet: "banniere2", type: "Bannière", nom: nomNamecardAdmin(chemin), image: `/DB/images/${chemin}` })),
        ...cosmetiques.fonds.map(fond => ({ id: idCosmetique("fond", fond.id), onglet: "fond", type: "Fond d'écran", nom: nomFond(fond), image: `/DB/images/${fond.miniature}` })),
        ...Object.values(VARIANTES_PERSONNAGES).flatMap(variante => Object.entries(variante.options).map(([valeur, option]) => ({
          id: idCosmetique(variante.parametre, valeur), onglet: "persos", type: "Variante", nom: option.nom, image: `/DB/${option.image}`
        }))),
        ...SKINS_PERSONNAGES.map(id => ({ id: idCosmetique("skin", id), onglet: "persos", type: "Skin", nom: id, image: `/DB/${imagesSkin(id).item}` }))
      ].filter(info => !COSMETIQUES_GRATUITS.has(info.id))
        .map(info => ({ ...info, image: encodeURI(info.image), cache: caches.has(info.id) }));
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

function choisirCosmetiques({ titre = "Choisir des cosmétiques", multiple = true, selection = [] } = {}) {
  return new Promise(async resoudre => {
    const catalogue = await chargerCatalogueChoix().catch(() => null);
    if (!catalogue) {
      alert("Impossible de charger les cosmétiques.");
      resoudre(null);
      return;
    }
    const choisis = new Set(selection);
    const nbCaches = [...catalogue.values()].filter(info => info.cache).length;
    let onglet = nbCaches ? "caches" : "banniere";
    const fenetre = document.createElement("div");
    fenetre.className = "modal-apercu active fenetre-choix-cosmetiques";
    fenetre.innerHTML = `
      <div class="modal-apercu-contenu" role="dialog" aria-modal="true">
        <div class="modal-apercu-entete">
          <h2></h2>
          <button type="button" class="fermer-apercu" data-action="annuler" aria-label="Fermer">×</button>
        </div>
        <div class="choix-cosmetiques-onglets">${ONGLETS_CHOIX_COSMETIQUES.map(o => `<button type="button" class="bouton-creer secondaire" data-onglet="${o.id}">${o.nom}${o.id === "caches" ? ` (${nbCaches})` : ""}</button>`).join("")}</div>
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
      </div>`;
    fenetre.querySelector("h2").textContent = titre;
    const grille = fenetre.querySelector(".choix-cosmetiques-grille");
    const recherche = fenetre.querySelector(".choix-cosmetiques-recherche");

    // Onglet Cachés : namecards puis bannières cachées ; les autres onglets
    // montrent aussi leurs cachés (pastille « caché »).
    const visibles = () => [...catalogue.values()].filter(info => (onglet === "caches" ? info.cache : info.onglet === onglet) &&
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
          <span>${echapper(info.nom)}</span>
        </button>`).join("") : `<p class="aide-apercu">Aucun cosmétique.</p>`;
      majCompte();
    };

    const terminer = resultat => {
      fenetre.remove();
      document.removeEventListener("keydown", surTouche, true);
      resoudre(resultat);
    };
    const surTouche = event => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      terminer(null);
    };
    document.addEventListener("keydown", surTouche, true);

    fenetre.addEventListener("click", event => {
      if (event.target === fenetre) return terminer(null);
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
