// Ajout d'un personnage, d'une arme ou d'un boss depuis la page admin.
// Les infos du JSON sont obligatoires ; l'entrée est enregistrée dans
// Supabase (api/points.js, config.ajouts) et ajoutée aux JSON de DB/ sur tout
// le site, avec 0 point partout. Les images ne sont pas envoyées : la
// fenêtre récapitule celles à fournir (nom et dossier attendus, présentes ou
// non), à ajouter au dépôt à la main.

// Où trouver chaque sorte d'image : un bouton "Chercher" s'affiche à côté de
// l'image quand son lien est renseigné.
const LIENS_IMAGES = {
  personnage: "",
  side: "",
  fullArt: "",
  namecard: "",
  banniere: "",
  arme: "",
  boss: "",
  fondBoss: ""
};

const ELEMENTS_AJOUT = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];
const LIBELLES_ELEMENTS = {
  pyro: "Pyro", hydro: "Hydro", electro: "Electro", cryo: "Cryo",
  anemo: "Anémo", geo: "Géo", dendro: "Dendro", all: "Tous les éléments"
};
const LIBELLES_ARMES = { sword: "Épée", claymore: "Épée à deux mains", polearm: "Arme d'hast", bow: "Arc", catalyst: "Catalyseur" };
const TYPES_BOSS = { weekly_boss: "Boss hebdomadaire" };
// Catégories d'une arme : aucune, une ou les deux.
const CATEGORIES_ARMES = { support: "Support", standard: "Standard" };
const NOMS_GENRES = { characters: "Personnage", weapons: "Arme", boss: "Boss" };

let genreAjout = "characters";
let brouillons = brouillonsVides();
let idSaisiALaMain = { characters: false, weapons: false, boss: false };
let ajouts = { characters: [], weapons: [], boss: [] }; // enregistrés (Supabase)
let listeBoss = [];
let promesseCosmetiques = null;
const cacheImages = new Map(); // chemin -> promesse (présente ou non)

function brouillonsVides() {
  return {
    characters: { nom: "", id: "", element: "", arme: "", rarete: "", categorie: "", standard: false },
    weapons: { nom: "", id: "", element: "", type: "", rarete: "5", categories: [] },
    boss: { nom: "", id: "", type: "weekly_boss", res: Array(7).fill(0) }
  };
}

function lireAjoutsConfig(config) {
  const lus = { characters: [], weapons: [], boss: [] };
  Object.keys(lus).forEach(genre => {
    if (Array.isArray(config?.ajouts?.[genre])) lus[genre] = config.ajouts[genre];
  });
  return lus;
}

// "Hu Tao" -> "hu_tao" (id) ; "Hu Tao" -> "Hu_Tao" (noms des images).
function sansAccents(texte) {
  return texte.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function idDepuisNom(nom) {
  return sansAccents(nom).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function nomDeFichier(nom) {
  return sansAccents(nom).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Comme la recherche des bannières de la draft (matchmaking/match.js).
function cleDeFichier(texte) {
  return sansAccents(texte).replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

// Ajoute ou retire une catégorie d'arme (ordre de CATEGORIES_ARMES).
function basculerCategorie(categories, valeur) {
  const choisies = categories.includes(valeur) ? categories.filter(c => c !== valeur) : [...categories, valeur];
  return Object.keys(CATEGORIES_ARMES).filter(c => choisies.includes(c));
}

function echapper(texte) {
  return String(texte).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

// ---- Validation ----

function listeDuGenre(genre) {
  if (genre === "characters") return personnages;
  if (genre === "weapons") return armes;
  return listeBoss;
}

// Ids déjà pris : JSON de DB/ + ajouts enregistrés (+ groupes, ex.
// "traveler", pour les personnages).
function idsPris(genre) {
  const entrees = [...listeDuGenre(genre).filter(e => !e.ajout), ...ajouts[genre]];
  return new Set(entrees.flatMap(e => [e.id, genre === "characters" ? e.groupe : null]).filter(Boolean));
}

function manquesAjout(genre, b) {
  const manques = [];
  if (!b.nom.trim()) manques.push("nom");
  if (!/^[a-z0-9_]{1,40}$/.test(b.id)) manques.push("id (minuscules, chiffres et _)");
  else if (idsPris(genre).has(b.id)) manques.push(`id libre ("${b.id}" existe déjà)`);
  if (genre === "characters") {
    if (!b.element) manques.push("élément");
    if (!b.arme) manques.push("type d'arme");
    if (!b.rarete) manques.push("rareté");
    if (!b.categorie) manques.push("catégorie");
  } else if (genre === "weapons") {
    if (!b.element) manques.push("élément");
    if (!b.type) manques.push("type");
    if (!b.rarete) manques.push("rareté");
  } else if (b.res.some(n => !Number.isFinite(n))) {
    manques.push("résistances (nombres)");
  }
  return manques;
}

// ---- Formulaire ----

function boutonsChoix(champ, valeurs, actuelle, avecIcones = null) {
  return Object.entries(valeurs).map(([valeur, libelle]) => avecIcones
    ? `<button type="button" class="filtre-admin filtre-icone choix-ajout${actuelle === valeur ? " active" : ""}" data-champ="${champ}" data-valeur="${valeur}" title="${libelle}"><img src="${avecIcones[valeur]}" alt="${libelle}"></button>`
    : `<button type="button" class="filtre-admin filtre-texte choix-ajout${actuelle === valeur ? " active" : ""}" data-champ="${champ}" data-valeur="${valeur}">${libelle}</button>`
  ).join("");
}

function champ(libelle, contenu, aide = "") {
  return `
    <div class="champ-ajout">
      <span class="libelle-ajout">${libelle}</span>
      <div class="controle-ajout">${contenu}${aide ? `<span class="aide-champ">${aide}</span>` : ""}</div>
    </div>`;
}

function rendreFormulaire() {
  const b = brouillons[genreAjout];
  const elements = Object.fromEntries(ELEMENTS_AJOUT.map(e => [e, LIBELLES_ELEMENTS[e]]));
  const texteSaisi = (nomChamp, placeholder) =>
    `<input type="text" class="texte-ajout" data-champ="${nomChamp}" value="${echapper(b[nomChamp])}" placeholder="${placeholder}" autocomplete="off">`;

  document.querySelectorAll("#genres-ajout .mode-modificateur").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.genre === genreAjout);
  });

  let html = "";
  if (genreAjout === "characters") {
    html = [
      champ("Nom complet", texteSaisi("nom", "ex. Hu Tao")),
      champ("Id", texteSaisi("id", "ex. hu_tao"), "Rempli d'après le nom. Sert aussi aux noms des images."),
      champ("Élément", boutonsChoix("element", elements, b.element, ICONES_ELEMENTS_TRI)),
      champ("Type d'arme", boutonsChoix("arme", LIBELLES_ARMES, b.arme, ICONES_TYPES_ARMES_TRI)),
      champ("Rareté", boutonsChoix("rarete", { 5: "5★", 4: "4★", 3: "3★" }, b.rarete)),
      champ("Catégorie", boutonsChoix("categorie", CATEGORIES, b.categorie)),
      champ("Standard", `<button type="button" class="filtre-admin filtre-texte choix-ajout${b.standard ? " active" : ""}" data-champ="standard" data-valeur="bascule">${b.standard ? "Oui" : "Non"}</button>`,
        "5★ de la bannière permanente.")
    ].join("");
  } else if (genreAjout === "weapons") {
    html = [
      champ("Nom complet", texteSaisi("nom", "ex. Bâton de Homa")),
      champ("Id", texteSaisi("id", "ex. hu_tao_w"), "Arme signature : id du personnage + <strong>_w</strong> (ex. hu_tao_w)."),
      champ("Élément", boutonsChoix("element", { ...elements, all: LIBELLES_ELEMENTS.all }, b.element, ICONES_ELEMENTS_TRI)),
      champ("Type", boutonsChoix("type", LIBELLES_ARMES, b.type, ICONES_TYPES_ARMES_TRI)),
      champ("Rareté", boutonsChoix("rarete", { 5: "5★", 4: "4★", 3: "3★" }, b.rarete)),
      champ("Catégories", Object.entries(CATEGORIES_ARMES).map(([valeur, libelle]) =>
        `<button type="button" class="filtre-admin filtre-texte choix-ajout${b.categories.includes(valeur) ? " active" : ""}" data-champ="categories" data-valeur="${valeur}">${libelle}</button>`
      ).join(""), "Aucune, une ou les deux.")
    ].join("");
  } else {
    html = [
      champ("Nom complet", texteSaisi("nom", "ex. Signora")),
      champ("Id", texteSaisi("id", "ex. signora_boss"), "Terminé par <strong>_boss</strong>, comme les autres boss."),
      champ("Type", boutonsChoix("type", TYPES_BOSS, b.type)),
      champ("Résistances", `<div class="resistances-ajout">${ELEMENTS_AJOUT.map((element, i) => `
        <label class="resistance-ajout" title="${LIBELLES_ELEMENTS[element]}">
          <img src="${ICONES_ELEMENTS_TRI[element]}" alt="${LIBELLES_ELEMENTS[element]}">
          <input type="text" class="res-ajout" data-index="${i}" value="${b.res[i]}" inputmode="decimal">
        </label>`).join("")}</div>`)
    ].join("");
  }

  document.getElementById("formulaire-ajout").innerHTML = html;
  majAjout();
}

// Bouton Créer, message des infos manquantes et images (vérifiées après une
// courte pause de frappe).
let minuterieImages = null;

function majAjout() {
  const b = brouillons[genreAjout];
  const manques = manquesAjout(genreAjout, b);
  document.getElementById("creer-ajout").disabled = manques.length > 0;
  const message = document.getElementById("message-ajout");
  message.textContent = manques.length ? `Manque : ${manques.join(", ")}.` : "";
  message.className = "message-ajout";

  const zone = document.getElementById("images-ajout");
  zone.innerHTML = htmlImages(genreAjout, b);
  clearTimeout(minuterieImages);
  minuterieImages = setTimeout(() => verifierImages(zone, genreAjout, b), 400);
}

function initialiserFormulaire() {
  const formulaire = document.getElementById("formulaire-ajout");

  formulaire.addEventListener("input", event => {
    const b = brouillons[genreAjout];
    const texte = event.target.closest(".texte-ajout");
    const res = event.target.closest(".res-ajout");
    if (texte) {
      b[texte.dataset.champ] = texte.value;
      if (texte.dataset.champ === "id") {
        idSaisiALaMain[genreAjout] = texte.value !== "";
      } else if (texte.dataset.champ === "nom" && !idSaisiALaMain[genreAjout] && genreAjout !== "weapons") {
        // Id proposé d'après le nom (armes : id du personnage, pas du nom).
        const base = idDepuisNom(texte.value);
        b.id = base && genreAjout === "boss" ? `${base}_boss` : base;
        formulaire.querySelector('.texte-ajout[data-champ="id"]').value = b.id;
      }
    }
    if (res) {
      const valeur = res.value.trim().replace(",", ".");
      b.res[Number(res.dataset.index)] = valeur === "" ? 0 : Number(valeur);
      res.classList.toggle("invalide", !Number.isFinite(b.res[Number(res.dataset.index)]));
    }
    majAjout();
  });

  formulaire.addEventListener("click", event => {
    const bouton = event.target.closest(".choix-ajout");
    if (!bouton) return;
    const b = brouillons[genreAjout];
    if (bouton.dataset.champ === "standard") b.standard = !b.standard;
    else if (bouton.dataset.champ === "categories") b.categories = basculerCategorie(b.categories, bouton.dataset.valeur);
    else b[bouton.dataset.champ] = b[bouton.dataset.champ] === bouton.dataset.valeur ? "" : bouton.dataset.valeur;
    if (genreAjout === "boss" && !b.type) b.type = "weekly_boss";
    rendreFormulaire();
  });

  document.getElementById("genres-ajout").addEventListener("click", event => {
    const bouton = event.target.closest("[data-genre]");
    if (!bouton) return;
    genreAjout = bouton.dataset.genre;
    rendreFormulaire();
  });
}

// ---- Images à fournir ----

function imagesAttendues(genre, entree) {
  const id = entree.id || "<id>";
  const nom = nomDeFichier(entree.nom || "") || "<Nom>";
  const script = "puis relancer <code>python scripts/generer_cosmetiques.py</code>";

  if (genre === "characters") {
    return [
      { libelle: "Character", lien: LIENS_IMAGES.personnage, chemin: `DB/images/characters/${id}.webp` },
      { libelle: "Side character", lien: LIENS_IMAGES.side, chemin: `DB/images/characters/side_char/${id}_side.webp` },
      { libelle: "Full art wish", lien: LIENS_IMAGES.fullArt, chemin: `DB/images/characters/full_art_char/Character_${nom}_Full_Wish.webp` },
      {
        libelle: "Namecard", lien: LIENS_IMAGES.namecard, note: script,
        chemin: `DB/images/namecards/Namecard_Background_${nom}_<Titre>.webp`,
        cosmetique: { liste: "bannieres", prefixe: "Namecard_Background_", nom: entree.nom }
      },
      {
        libelle: "Bannière", lien: LIENS_IMAGES.banniere, note: script,
        chemin: `DB/images/namecards/banners/Namecard_Banner_${nom}_<Titre>.webp`,
        cosmetique: { liste: "bannieres2", prefixe: "Namecard_Banner_", nom: entree.nom }
      }
    ];
  }
  if (genre === "weapons") {
    return [{ libelle: "Arme", lien: LIENS_IMAGES.arme, chemin: `DB/images/weapons/${id}.webp` }];
  }
  const prefixe = id.replace(/_boss$/, "");
  return [
    { libelle: "Boss", lien: LIENS_IMAGES.boss, chemin: `DB/images/boss/${id}.webp` },
    {
      libelle: "Fonds de la room", lien: LIENS_IMAGES.fondBoss, note: `plusieurs possibles (${prefixe}_1, ${prefixe}_2…), ${script}`,
      chemin: `DB/images/bg/boss_hebdo/${prefixe}_1.png`,
      cosmetique: { fonds: prefixe }
    }
  ];
}

function htmlImages(genre, entree) {
  return `
    <div class="images-ajout">
      ${imagesAttendues(genre, entree).map((image, i) => `
        <div class="image-ajout" data-index="${i}">
          <span class="libelle-image">${image.libelle}</span>
          <span class="chemin-image">
            <code>${echapper(image.chemin)}</code>
            ${image.note ? `<span class="note-image">${image.note}</span>` : ""}
          </span>
          <button type="button" class="copier-chemin" data-nom="${echapper(image.chemin.split("/").pop())}" title="Copier le nom du fichier">Copier</button>
          ${image.lien ? `<a class="lien-image" href="${echapper(image.lien)}" target="_blank" rel="noopener">Chercher</a>` : ""}
          <span class="statut-image" data-statut="attente">…</span>
        </div>`).join("")}
    </div>`;
}

function chargerCosmetiques() {
  promesseCosmetiques ??= fetch("/DB/images/cosmetiques.json", { cache: "no-cache" })
    .then(reponse => (reponse.ok ? reponse.json() : {}))
    .catch(() => ({}));
  return promesseCosmetiques;
}

function imagePresente(chemin) {
  if (!cacheImages.has(chemin)) {
    cacheImages.set(chemin, fetch(encodeURI(`/${chemin}`), { method: "HEAD", cache: "no-cache" })
      .then(reponse => reponse.ok)
      .catch(() => false));
  }
  return cacheImages.get(chemin);
}

// Présente / manquante. Namecard, bannière, fonds : cherchés dans
// cosmetiques.json (nom exact inconnu : titre de la namecard, numéros).
async function statutImage(image) {
  if (image.cosmetique) {
    const cosmetiques = await chargerCosmetiques();
    if (image.cosmetique.fonds) {
      const nb = (cosmetiques.fonds || []).filter(fond =>
        fond.categorie === "boss_hebdo" && fond.image.split("/").pop().replace(/_\d+\.webp$/, "") === image.cosmetique.fonds).length;
      return nb ? { statut: "ok", texte: `${nb} trouvé${nb > 1 ? "s" : ""}` } : { statut: "manquante", texte: "Aucun" };
    }
    const cle = cleDeFichier(image.cosmetique.nom);
    const trouve = (cosmetiques[image.cosmetique.liste] || []).some(chemin => {
      const nom = cleDeFichier(chemin.split("/").pop().replace(image.cosmetique.prefixe, "").replace(/\.webp$/, ""));
      return nom === cle || nom.startsWith(`${cle}_`);
    });
    return trouve ? { statut: "ok", texte: "Présente" } : { statut: "manquante", texte: "Manquante" };
  }
  return (await imagePresente(image.chemin))
    ? { statut: "ok", texte: "Présente" }
    : { statut: "manquante", texte: "Manquante" };
}

// "—" tant que l'id ou le nom nécessaire n'est pas renseigné.
function verifierImages(zone, genre, entree) {
  imagesAttendues(genre, entree).forEach(async (image, i) => {
    const statut = image.chemin.includes("<id>") || image.chemin.includes("<Nom>")
      ? { statut: "inconnu", texte: "—" }
      : await statutImage(image);
    const span = zone.querySelector(`.image-ajout[data-index="${i}"] .statut-image`);
    if (!span) return;
    span.dataset.statut = statut.statut;
    span.textContent = statut.texte;
  });
}

// ---- Création / suppression ----

async function envoyerAjout(corps) {
  const reponse = await fetch("/api/points", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps)
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.error || "Erreur d'enregistrement.");
  ajouts = lireAjoutsConfig(donnees);
  return donnees;
}

// Points et masqués enregistrés (bouton Annuler, filtre "Modifiés") : l'ajout
// n'est pas une modification en attente. Un ajout est créé masqué (cf.
// api/points.js), sa suppression le retire des masqués.
function majEtatEnregistre(genre, id, points) {
  const [valeursEnreg, modesEnreg, masquesEnreg] = JSON.parse(etatEnregistre);
  const sansId = liste => liste.filter(m => m !== id);
  if (points) {
    valeursEnreg[genre][id] = [...points];
    masquesEnreg[genre] = [...sansId(masquesEnreg[genre]), id].sort();
    masques[genre] = [...sansId(masques[genre]), id].sort();
  } else {
    delete valeursEnreg[genre][id];
    masquesEnreg[genre] = sansId(masquesEnreg[genre]);
    masques[genre] = sansId(masques[genre]);
  }
  etatEnregistre = JSON.stringify([valeursEnreg, modesEnreg, masquesEnreg]);
}

function entreeDepuisBrouillon(genre, b) {
  if (genre === "characters") {
    return { id: b.id, nom: b.nom.trim(), element: b.element, arme: b.arme, rarete: b.rarete, categorie: b.categorie, standard: b.standard };
  }
  if (genre === "weapons") return { id: b.id, nom: b.nom.trim(), element: b.element, type: b.type, rarete: b.rarete, categories: b.categories };
  return { id: b.id, nom: b.nom.trim(), type: b.type, res: b.res };
}

async function creerAjout() {
  const genre = genreAjout;
  const bouton = document.getElementById("creer-ajout");
  const message = document.getElementById("message-ajout");
  bouton.disabled = true;
  try {
    await envoyerAjout({ ajout: { genre, entree: entreeDepuisBrouillon(genre, brouillons[genre]) } });
    const entree = ajouts[genre].find(e => e.id === brouillons[genre].id);
    listeDuGenre(genre).push({ ...entree, ajout: true });
    if (genre !== "boss") {
      const points = entree[COLONNES[genre].champ];
      valeurs[genre][entree.id] = [...points];
      majEtatEnregistre(genre, entree.id, points);
      rendre();
    }
    brouillons[genre] = brouillonsVides()[genre];
    idSaisiALaMain[genre] = false;
    rendreFormulaire();
    rendreListeAjouts();
    message.textContent = genre === "boss"
      ? `Boss « ${entree.nom} » ajouté.`
      : `${NOMS_GENRES[genre]} « ${entree.nom} » ajouté${genre === "weapons" ? "e" : ""}, avec 0 point partout, masqué${genre === "weapons" ? "e" : ""} (bouton Afficher pour le rendre visible sur le site).`;
    message.className = "message-ajout succes";
  } catch (erreur) {
    console.error(erreur);
    message.textContent = erreur.message;
    message.className = "message-ajout erreur";
    bouton.disabled = false;
  }
}

async function supprimerAjout(genre, id) {
  const entree = ajouts[genre].find(e => e.id === id);
  if (!entree || !confirm(`Supprimer « ${entree.nom} » (${id}) ? Ses points seront perdus.`)) return;
  try {
    await envoyerAjout({ suppression: { genre, id } });
    const liste = listeDuGenre(genre);
    const index = liste.findIndex(e => e.id === id && e.ajout);
    if (index !== -1) liste.splice(index, 1);
    if (genre !== "boss") {
      delete valeurs[genre][id];
      majEtatEnregistre(genre, id, null);
      rendre();
    }
    rendreListeAjouts();
    majAjout(); // l'id redevient libre
  } catch (erreur) {
    console.error(erreur);
    alert(erreur.message);
  }
}

// Ajouts enregistrés : nom, id, puis ses images à fournir en dépliant.
function rendreListeAjouts() {
  const zone = document.getElementById("liste-ajouts");
  const lignes = Object.keys(ajouts).flatMap(genre => ajouts[genre].map(entree => ({ genre, entree })));
  if (!lignes.length) {
    zone.innerHTML = `<p class="aide-apercu">Aucun ajout pour l'instant.</p>`;
    return;
  }
  zone.innerHTML = lignes.map(({ genre, entree }) => `
    <details class="ajout-enregistre" data-genre="${genre}" data-id="${echapper(entree.id)}">
      <summary>
        <span class="genre-ajout">${NOMS_GENRES[genre]}</span>
        <span class="nom-ajout">${echapper(entree.nom)}</span>
        <code>${echapper(entree.id)}</code>
        <button type="button" class="supprimer-ajout" data-genre="${genre}" data-id="${echapper(entree.id)}">Supprimer</button>
      </summary>
      ${htmlImages(genre, entree)}
    </details>`).join("");
}

function initialiserAjout() {
  const modal = document.getElementById("modal-ajout");
  const fermer = () => modal.classList.remove("active");

  document.getElementById("ouvrir-ajout").addEventListener("click", async () => {
    genreAjout = vue;
    cacheImages.clear();
    promesseCosmetiques = null;
    rendreFormulaire();
    rendreListeAjouts();
    modal.classList.add("active");
    document.querySelector('#formulaire-ajout .texte-ajout[data-champ="nom"]')?.focus();
  });
  document.getElementById("fermer-ajout").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });

  document.getElementById("creer-ajout").addEventListener("click", creerAjout);

  modal.addEventListener("click", event => {
    const copie = event.target.closest(".copier-chemin");
    if (copie) {
      navigator.clipboard?.writeText(copie.dataset.nom).then(() => {
        copie.textContent = "Copié";
        setTimeout(() => { copie.textContent = "Copier"; }, 1200);
      }).catch(() => {});
    }
    const suppression = event.target.closest(".supprimer-ajout");
    if (suppression) {
      event.preventDefault(); // sans replier / déplier la ligne
      supprimerAjout(suppression.dataset.genre, suppression.dataset.id);
    }
  });

  // Images d'un ajout vérifiées à son dépliage.
  document.getElementById("liste-ajouts").addEventListener("toggle", event => {
    const details = event.target;
    if (!details.open) return;
    const entree = ajouts[details.dataset.genre]?.find(e => e.id === details.dataset.id);
    if (entree) verifierImages(details, details.dataset.genre, entree);
  }, true);

  initialiserFormulaire();
}
