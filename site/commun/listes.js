// Listes déroulantes du site : chaque <select> du site (sauf multiple /
// size > 1 / data-natif) garde son apparence fermée et son code (valeur,
// événements change / input), mais à l'ouverture (clic, toucher, Entrée,
// Espace, Alt+↓, F4), la liste du navigateur est remplacée par celle du
// site, dans le style de la liste des joueurs de l'entraînement : options
// qui défilent, option choisie en doré, recherche au-dessus quand il y en a
// beaucoup (SEUIL_RECHERCHE). Écoute déléguée sur le document : marche
// aussi pour les <select> ajoutés plus tard. Styles : commun/listes.css.

(() => {
  const SEUIL_RECHERCHE = 10;
  let ouverte = null; // { select, fond, liste, recherche, elements, surligne }

  const remplacable = cible => cible instanceof HTMLSelectElement && !cible.multiple && !(cible.size > 1) &&
    !cible.disabled && !cible.hasAttribute("data-natif");

  const sansAccents = texte => texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Options du select (groupes : titre non cliquable).
  function entrees(select) {
    const liste = [];
    [...select.children].forEach(enfant => {
      if (enfant instanceof HTMLOptGroupElement) {
        liste.push({ groupe: enfant.label });
        [...enfant.children].forEach(option => option instanceof HTMLOptionElement && !option.hidden && liste.push({ option }));
      } else if (enfant instanceof HTMLOptionElement && !enfant.hidden) {
        liste.push({ option: enfant });
      }
    });
    return liste;
  }

  function placer() {
    if (!ouverte) return;
    const { select, fond } = ouverte;
    const rect = select.getBoundingClientRect();
    // Sorti de l'écran (page qui défile) : fermée.
    if (rect.bottom < 0 || rect.top > window.innerHeight) return fermer();
    const largeur = Math.min(Math.max(rect.width, 8 * 16), window.innerWidth - 16);
    fond.style.minWidth = `${largeur}px`;
    fond.style.maxWidth = `${Math.max(largeur, Math.min(24 * 16, window.innerWidth - 16))}px`;
    const gauche = Math.min(Math.max(8, rect.left), window.innerWidth - fond.offsetWidth - 8);
    fond.style.left = `${Math.max(8, gauche)}px`;
    const dessous = window.innerHeight - rect.bottom - 8;
    const dessus = rect.top - 8;
    const hauteur = fond.offsetHeight;
    if (hauteur > dessous && dessus > dessous) {
      fond.style.top = "";
      fond.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      fond.style.maxHeight = `${dessus - 4}px`;
    } else {
      fond.style.bottom = "";
      fond.style.top = `${rect.bottom + 4}px`;
      fond.style.maxHeight = `${dessous - 4}px`;
    }
  }

  function rendreOptions() {
    const { select, liste, recherche } = ouverte;
    const filtre = recherche ? sansAccents(recherche.value.trim()) : "";
    liste.replaceChildren();
    ouverte.elements = [];
    let groupeEnAttente = null;
    entrees(select).forEach(entree => {
      if (entree.groupe !== undefined) {
        groupeEnAttente = entree.groupe;
        return;
      }
      const option = entree.option;
      if (filtre && !sansAccents(option.textContent).includes(filtre)) return;
      if (groupeEnAttente !== null) {
        const titre = document.createElement("li");
        titre.className = "groupe-liste-site";
        titre.textContent = groupeEnAttente;
        liste.appendChild(titre);
        groupeEnAttente = null;
      }
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = option.textContent;
      if (option.title) li.title = option.title;
      if (option.selected) {
        li.classList.add("actuel");
        li.setAttribute("aria-selected", "true");
      }
      if (option.disabled) li.classList.add("desactive");
      li.option = option;
      liste.appendChild(li);
      ouverte.elements.push(li);
    });
    if (!ouverte.elements.length) {
      const vide = document.createElement("li");
      vide.className = "vide-liste-site";
      vide.textContent = "Aucun résultat";
      liste.appendChild(vide);
    }
    const actuel = ouverte.elements.find(li => li.classList.contains("actuel"));
    surligner(filtre ? ouverte.elements.find(li => !li.option.disabled) : actuel || ouverte.elements[0]);
  }

  function surligner(li, defiler = true) {
    if (!ouverte) return;
    ouverte.surligne?.classList.remove("surligne");
    ouverte.surligne = li || null;
    if (!li) return;
    li.classList.add("surligne");
    if (defiler) li.scrollIntoView({ block: "nearest" });
  }

  function deplacer(sens) {
    const actifs = ouverte.elements.filter(li => !li.option.disabled);
    if (!actifs.length) return;
    const index = actifs.indexOf(ouverte.surligne);
    const suivant = index === -1 ? (sens > 0 ? 0 : actifs.length - 1) : Math.min(actifs.length - 1, Math.max(0, index + sens));
    surligner(actifs[suivant]);
  }

  function choisir(li) {
    if (!ouverte || !li?.option || li.option.disabled) return;
    const select = ouverte.select;
    const change = select.value !== li.option.value || !li.option.selected;
    li.option.selected = true;
    fermer();
    select.focus({ preventScroll: true });
    if (!change) return;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Recherche au clavier sans champ de recherche : 1re option qui commence
  // par les lettres tapées (comme une liste du navigateur).
  let frappe = "";
  let finFrappe = 0;
  function chercherFrappe(touche) {
    const maintenant = Date.now();
    frappe = maintenant > finFrappe ? touche : frappe + touche;
    finFrappe = maintenant + 800;
    const debut = sansAccents(frappe);
    const trouve = ouverte.elements.find(li => !li.option.disabled && sansAccents(li.textContent).startsWith(debut));
    if (trouve) surligner(trouve);
  }

  function surTouche(event) {
    if (!ouverte) return;
    const { recherche } = ouverte;
    switch (event.key) {
      case "ArrowDown": deplacer(1); break;
      case "ArrowUp": deplacer(-1); break;
      case "PageDown": deplacer(8); break;
      case "PageUp": deplacer(-8); break;
      case "Home": if (event.target === recherche) return; deplacer(-Infinity); break;
      case "End": if (event.target === recherche) return; deplacer(Infinity); break;
      case "Enter": choisir(ouverte.surligne); break;
      case "Escape": {
        const select = ouverte.select;
        fermer();
        select.focus({ preventScroll: true });
        break;
      }
      case "Tab": fermer(); return;
      default:
        if (!recherche && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          chercherFrappe(event.key);
          break;
        }
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function ouvrir(select, { toucher = false } = {}) {
    if (ouverte?.select === select) return fermer();
    fermer();
    const fond = document.createElement("div");
    fond.className = "liste-site";
    const nombre = entrees(select).filter(e => e.option).length;
    let recherche = null;
    if (nombre > SEUIL_RECHERCHE) {
      recherche = document.createElement("input");
      recherche.type = "text";
      recherche.className = "recherche-liste-site";
      recherche.placeholder = "Rechercher…";
      recherche.autocomplete = "off";
      recherche.spellcheck = false;
      recherche.addEventListener("input", rendreOptions);
      fond.appendChild(recherche);
    }
    const liste = document.createElement("ul");
    liste.setAttribute("role", "listbox");
    const libelle = select.getAttribute("aria-label") || select.title;
    if (libelle) liste.setAttribute("aria-label", libelle);
    fond.appendChild(liste);
    liste.addEventListener("click", event => choisir(event.target.closest("li")));
    liste.addEventListener("mousemove", event => {
      const li = event.target.closest("li[role=option]");
      if (li && li !== ouverte?.surligne && !li.option.disabled) surligner(li, false);
    });
    fond.addEventListener("keydown", surTouche);
    // Fenêtre (dialog) ouverte en modal : liste dedans, sinon dessous.
    (select.closest("dialog[open]") || document.body).appendChild(fond);
    ouverte = { select, fond, liste, recherche, elements: [], surligne: null };
    select.setAttribute("aria-expanded", "true");
    rendreOptions();
    placer();
    if (ouverte.surligne) surligner(ouverte.surligne);
    // Au toucher : pas de clavier du téléphone ouvert d'office.
    if (recherche && !toucher) recherche.focus({ preventScroll: true });
    else {
      liste.tabIndex = -1;
      liste.focus({ preventScroll: true });
    }
  }

  function fermer() {
    if (!ouverte) return;
    ouverte.select.setAttribute("aria-expanded", "false");
    ouverte.fond.remove();
    ouverte = null;
  }

  // Ouverture à la souris : la liste du navigateur ne s'ouvre pas.
  document.addEventListener("mousedown", event => {
    if (event.button !== 0) return;
    if (ouverte && !ouverte.fond.contains(event.target) && event.target !== ouverte.select) fermer();
    const select = event.target.closest?.("select");
    if (!remplacable(select)) return;
    event.preventDefault();
    select.focus({ preventScroll: true });
    ouvrir(select, { toucher: !!event.sourceCapabilities?.firesTouchEvents });
  }, true);

  // Au toucher : ouverte au relâché si le doigt n'a pas glissé (défilement).
  let depart = null;
  document.addEventListener("touchstart", event => {
    const select = event.target.closest?.("select");
    depart = remplacable(select) ? { select, x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    if (ouverte && !ouverte.fond.contains(event.target) && select !== ouverte.select) fermer();
  }, { capture: true, passive: true });
  document.addEventListener("touchend", event => {
    const select = event.target.closest?.("select");
    if (!depart || depart.select !== select) return;
    const doigt = event.changedTouches[0];
    const glisse = Math.hypot(doigt.clientX - depart.x, doigt.clientY - depart.y) > 10;
    depart = null;
    if (glisse) return;
    event.preventDefault(); // ni liste du navigateur, ni clic simulé
    ouvrir(select, { toucher: true });
  }, { capture: true, passive: false });

  // Clavier sur le select fermé : Entrée, Espace, Alt+↓, F4 ouvrent la
  // liste du site (les flèches seules changent la valeur, comme avant).
  document.addEventListener("keydown", event => {
    const select = event.target;
    if (!remplacable(select) || ouverte) return;
    if (event.key === "Enter" || event.key === " " || event.key === "F4" || (event.altKey && ["ArrowDown", "ArrowUp"].includes(event.key))) {
      event.preventDefault();
      ouvrir(select);
    }
  }, true);

  // Clic ailleurs (fenêtre, autre élément), défilement, redimensionnement.
  document.addEventListener("click", event => {
    if (ouverte && !ouverte.fond.contains(event.target) && event.target !== ouverte.select) fermer();
  }, true);
  window.addEventListener("scroll", event => {
    if (ouverte && !ouverte.fond.contains(event.target)) placer();
  }, true);
  window.addEventListener("resize", placer);
  // Le select retiré de la page (page redessinée) : liste fermée.
  setInterval(() => {
    if (ouverte && !ouverte.select.isConnected) fermer();
  }, 1000);
})();
