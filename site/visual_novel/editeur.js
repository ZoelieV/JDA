// Éditeur du visual novel : modifie une copie de l'histoire dans la page, puis
// l'enregistre d'un bloc (cf. api/_lib/vn_edition.js, format : visual_novel.js).
const edEl = id => document.getElementById(id);

function creer(balise, proprietes = {}, ...enfants) {
  const element = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(proprietes)) {
    if (cle.startsWith("on")) element.addEventListener(cle.slice(2).toLowerCase(), valeur);
    else if (cle === "classe") element.className = valeur;
    else element[cle] = valeur;
  }
  element.append(...enfants.filter(e => e != null));
  return element;
}

let histoire = null;
let majHistoire = null;
let modifie = false;
let selection = { chapitre: null, sc: null, panneau: null };
let persoChoisi = 0;

const nouvelId = prefixe => `${prefixe}${Math.random().toString(36).slice(2, 10)}`;
const chapitreChoisi = () => histoire.chapitres.find(c => c.id === selection.chapitre);
const scChoisi = () => chapitreChoisi()?.sous_chapitres.find(s => s.id === selection.sc);
const panneauChoisi = () => scChoisi()?.panneaux.find(p => p.id === selection.panneau);

function marquerModifie() {
  modifie = true;
  edEl("ed-etat").textContent = "Modifications non enregistrées";
}

// Déplace un élément d'une liste d'un cran (sens : -1 ou +1).
function deplacer(liste, element, sens) {
  const i = liste.indexOf(element);
  const j = i + sens;
  if (j < 0 || j >= liste.length) return;
  [liste[i], liste[j]] = [liste[j], liste[i]];
  marquerModifie();
}

function resumePanneau(panneau, numero) {
  const texte = decouperTexteVn(panneau.texte).map(m => m.texte).join("");
  return `${numero}. ${panneau.nom ? `${panneau.nom} : ` : ""}${texte || "(vide)"}`;
}

// ---- Création ----
// Nouveau panneau : mêmes fond, personnages et police que le modèle, comme
// pour la suite d'une même scène.
function creerPanneau(modele) {
  return {
    id: nouvelId("p"),
    fond: modele?.fond || null,
    nom: "",
    texte: "",
    persos: structuredClone(modele?.persos || []),
    police: structuredClone(modele?.police || lirePoliceVn()),
    ensuite: { type: "suite" }
  };
}

const creerSousChapitre = (titre, modele) => ({ id: nouvelId("s"), titre, panneaux: [creerPanneau(modele)] });

function choisir(chapitreId, scId, panneauId) {
  selection = { chapitre: chapitreId, sc: scId, panneau: panneauId };
  persoChoisi = 0;
  rendreTout();
}

function choisirPremier(chapitre) {
  const sc = chapitre.sous_chapitres[0];
  choisir(chapitre.id, sc.id, sc.panneaux[0].id);
}

// ---- Plan de l'histoire ----
function boutonsDeplacement(liste, element, { apresSuppression, confirmation }) {
  return [
    creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "↑", title: "Monter", onclick: () => { deplacer(liste, element, -1); rendreArbre(); } }),
    creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "↓", title: "Descendre", onclick: () => { deplacer(liste, element, 1); rendreArbre(); } }),
    creer("button", {
      type: "button",
      classe: "ed-bouton ed-mini",
      textContent: "×",
      title: liste.length > 1 ? "Supprimer" : "Il en faut au moins un",
      disabled: liste.length <= 1,
      onclick: () => {
        const message = confirmation();
        if (message && !confirm(message)) return;
        liste.splice(liste.indexOf(element), 1);
        marquerModifie();
        apresSuppression();
      }
    })
  ];
}

function rendreArbre() {
  edEl("ed-arbre").replaceChildren(...histoire.chapitres.map(chapitre => {
    const nbPanneaux = chapitre.sous_chapitres.reduce((total, sc) => total + sc.panneaux.length, 0);
    const actif = chapitre.id === selection.chapitre;
    return creer("div", { classe: "ed-chapitre" },
      creer("div", { classe: "ed-noeud" },
        creer("button", { type: "button", classe: `ed-noeud-nom${actif ? " ed-actif" : ""}`, textContent: chapitre.titre, title: chapitre.titre, onclick: () => choisirPremier(chapitre) }),
        ...boutonsDeplacement(histoire.chapitres, chapitre, {
          confirmation: () => `Supprimer « ${chapitre.titre} » et ses ${nbPanneaux} panneaux ?`,
          apresSuppression: () => choisirPremier(histoire.chapitres[0])
        })
      ),
      actif ? rendreChapitre(chapitre) : null
    );
  }));
}

function rendreChapitre(chapitre) {
  return creer("div", {},
    creer("div", { classe: "ed-reglages" },
      creer("input", { type: "text", maxLength: 80, value: chapitre.titre, ariaLabel: "Titre du chapitre", oninput: e => { chapitre.titre = e.target.value; marquerModifie(); }, onchange: rendreArbre }),
      chapitre.namecard ? creer("img", { src: imageVn(chapitre.namecard), alt: "" }) : null,
      creer("button", { type: "button", classe: "ed-bouton", textContent: "Namecard du chapitre", onclick: () => ouvrirImages("namecard", chemin => { chapitre.namecard = chemin; marquerModifie(); rendreArbre(); }) })
    ),
    ...chapitre.sous_chapitres.map(sc => rendreSousChapitre(chapitre, sc)),
    creer("button", {
      type: "button",
      classe: "ed-bouton ed-large",
      textContent: "+ Sous-chapitre",
      onclick: () => {
        const sc = creerSousChapitre(`Sous-chapitre ${chapitre.sous_chapitres.length + 1}`, panneauChoisi());
        chapitre.sous_chapitres.push(sc);
        marquerModifie();
        choisir(chapitre.id, sc.id, sc.panneaux[0].id);
      }
    })
  );
}

function rendreSousChapitre(chapitre, sc) {
  const actif = sc.id === selection.sc;
  return creer("div", { classe: "ed-sous-chapitre" },
    creer("div", { classe: "ed-noeud" },
      creer("button", { type: "button", classe: "ed-noeud-nom", textContent: sc.titre, title: sc.titre, onclick: () => choisir(chapitre.id, sc.id, sc.panneaux[0].id) }),
      ...boutonsDeplacement(chapitre.sous_chapitres, sc, {
        confirmation: () => `Supprimer « ${sc.titre} » et ses ${sc.panneaux.length} panneaux ?`,
        apresSuppression: () => choisirPremier(chapitre)
      })
    ),
    actif ? creer("div", { classe: "ed-reglages" },
      creer("input", { type: "text", maxLength: 80, value: sc.titre, ariaLabel: "Titre du sous-chapitre", oninput: e => { sc.titre = e.target.value; marquerModifie(); }, onchange: rendreArbre })
    ) : null,
    actif ? creer("div", { classe: "ed-panneaux" },
      ...sc.panneaux.map((panneau, i) => rendrePanneauArbre(chapitre, sc, panneau, i)),
      creer("div", { classe: "ed-ligne" },
        creer("button", { type: "button", classe: "ed-bouton", textContent: "+ Panneau", onclick: () => ajouterPanneau(chapitre, sc) }),
        creer("button", { type: "button", classe: "ed-bouton", textContent: "Dupliquer", title: "Copie ce panneau, texte compris", onclick: () => dupliquerPanneau(chapitre, sc) })
      )
    ) : null
  );
}

const BADGES = { choix: "choix", fin: "fin" };

function rendrePanneauArbre(chapitre, sc, panneau, i) {
  const resume = resumePanneau(panneau, i + 1);
  const badge = BADGES[panneau.ensuite.type];
  return creer("div", { classe: "ed-noeud" },
    creer("button", { type: "button", classe: `ed-noeud-nom${panneau.id === selection.panneau ? " ed-actif" : ""}`, textContent: resume, title: resume, onclick: () => choisir(chapitre.id, sc.id, panneau.id) }),
    badge ? creer("span", { classe: "ed-badge", textContent: badge }) : null,
    ...boutonsDeplacement(sc.panneaux, panneau, {
      confirmation: () => (panneau.texte ? "Supprimer ce panneau ?" : null),
      apresSuppression: () => choisir(chapitre.id, sc.id, sc.panneaux[Math.max(0, i - 1)].id)
    })
  );
}

function insererApres(sc, panneau, reference) {
  const i = sc.panneaux.indexOf(reference);
  sc.panneaux.splice(i === -1 ? sc.panneaux.length : i + 1, 0, panneau);
  marquerModifie();
}

function ajouterPanneau(chapitre, sc) {
  const reference = panneauChoisi();
  const panneau = creerPanneau(reference);
  insererApres(sc, panneau, reference);
  choisir(chapitre.id, sc.id, panneau.id);
  edEl("ed-texte").focus();
}

function dupliquerPanneau(chapitre, sc) {
  const reference = panneauChoisi();
  // La copie ne reprend pas la suite : deux fois la même fin ou les mêmes
  // réponses n'auraient pas de sens.
  const panneau = { ...structuredClone(reference), id: nouvelId("p"), ensuite: { type: "suite" } };
  insererApres(sc, panneau, reference);
  choisir(chapitre.id, sc.id, panneau.id);
}

// ---- Panneau : aperçu et texte ----
function rendreApercu() {
  const panneau = panneauChoisi();
  dessinerSceneVn(panneau);
  [...edEl("vn-persos").children].forEach((image, i) => {
    image.classList.toggle("ed-selection", i === persoChoisi);
    image.addEventListener("pointerdown", event => commencerGlissement(event, i));
  });
}

function commencerGlissement(event, index) {
  event.preventDefault();
  const panneau = panneauChoisi();
  const perso = panneau.persos[index];
  const image = event.currentTarget;
  const scene = edEl("vn-persos").getBoundingClientRect();
  const depart = { clientX: event.clientX, clientY: event.clientY, x: perso.x, y: perso.y };
  if (persoChoisi !== index) {
    persoChoisi = index;
    [...edEl("vn-persos").children].forEach((e, i) => e.classList.toggle("ed-selection", i === index));
    rendrePersos();
  }
  image.setPointerCapture(event.pointerId);
  const bouger = e => {
    perso.x = Math.round(Math.min(130, Math.max(-30, depart.x + (e.clientX - depart.clientX) / scene.width * 100)) * 10) / 10;
    perso.y = Math.round(Math.min(100, Math.max(-100, depart.y - (e.clientY - depart.clientY) / scene.height * 100)) * 10) / 10;
    image.style.left = `${perso.x}%`;
    image.style.bottom = `${perso.y}%`;
    marquerModifie();
  };
  const finir = () => {
    image.removeEventListener("pointermove", bouger);
    image.removeEventListener("pointerup", finir);
    image.removeEventListener("pointercancel", finir);
  };
  image.addEventListener("pointermove", bouger);
  image.addEventListener("pointerup", finir);
  image.addEventListener("pointercancel", finir);
}

function rendreFormulaire() {
  const panneau = panneauChoisi();
  edEl("ed-nom").value = panneau.nom;
  edEl("ed-texte").value = panneau.texte;
  const police = panneau.police = lirePoliceVn(panneau.police);
  edEl("ed-police").value = police.famille;
  edEl("ed-taille").value = police.taille;
  edEl("ed-gras").checked = police.gras;
  edEl("ed-italique").checked = police.italique;
}

// Ajoute (ou retire) la marque autour de la sélection du texte.
function appliquerMarque(marque) {
  const zone = edEl("ed-texte");
  const { selectionStart: debut, selectionEnd: fin, value } = zone;
  const choisi = value.slice(debut, fin);
  const dejaAutour = value.slice(debut - marque.length, debut) === marque && value.slice(fin, fin + marque.length) === marque;
  if (dejaAutour) {
    zone.value = value.slice(0, debut - marque.length) + choisi + value.slice(fin + marque.length);
    zone.setSelectionRange(debut - marque.length, fin - marque.length);
  } else {
    zone.value = value.slice(0, debut) + marque + choisi + marque + value.slice(fin);
    zone.setSelectionRange(debut + marque.length, fin + marque.length);
  }
  zone.focus();
  panneauChoisi().texte = zone.value;
  marquerModifie();
  rendreApercu();
  rendreArbre();
}

// ---- Panneau : personnages ----
const nomImage = chemin => chemin.split("/").pop().replace(/\.\w+$/, "");

function rendrePersos() {
  const panneau = panneauChoisi();
  edEl("ed-persos").replaceChildren(...panneau.persos.map((perso, i) => creer("div", { classe: `ed-carte${i === persoChoisi ? " ed-selection" : ""}` },
    creer("div", { classe: "ed-carte-haut" },
      creer("img", { src: imageVn(perso.image), alt: "", onclick: () => { persoChoisi = i; rendrePersos(); rendreApercu(); } }),
      creer("span", { classe: "ed-pousse", textContent: perso.image.startsWith("vn/") ? "Image importée" : nomImage(perso.image) }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "↑", title: "Plus en arrière", onclick: () => { deplacer(panneau.persos, perso, -1); persoChoisi = panneau.persos.indexOf(perso); rendrePersos(); rendreApercu(); } }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "↓", title: "Plus en avant", onclick: () => { deplacer(panneau.persos, perso, 1); persoChoisi = panneau.persos.indexOf(perso); rendrePersos(); rendreApercu(); } }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Retirer", onclick: () => { panneau.persos.splice(i, 1); persoChoisi = 0; marquerModifie(); rendrePersos(); rendreApercu(); } })
    ),
    creer("label", { classe: "ed-champ" }, "Taille",
      creer("input", { type: "range", min: 5, max: 250, value: perso.hauteur, oninput: e => { perso.hauteur = Number(e.target.value); marquerModifie(); rendreApercu(); } })
    ),
    creer("label", {}, creer("input", { type: "checkbox", checked: perso.miroir === true, onchange: e => { perso.miroir = e.target.checked; marquerModifie(); rendreApercu(); } }), " Miroir")
  )));
}

// ---- Panneau : suite ----
// Panneaux du chapitre, regroupés par sous-chapitre, pour les destinations.
function listeDestinations(valeur, { libelleVide, avecNouveau = true, onChange }) {
  const chapitre = chapitreChoisi();
  const liste = creer("select", { ariaLabel: "Destination", onchange: e => onChange(e.target.value) },
    creer("option", { value: "", textContent: libelleVide }),
    avecNouveau ? creer("option", { value: "__nouveau", textContent: "+ Nouveau panneau" }) : null,
    ...chapitre.sous_chapitres.map(sc => creer("optgroup", { label: sc.titre },
      ...sc.panneaux.map((p, i) => creer("option", { value: p.id, textContent: resumePanneau(p, i + 1).slice(0, 60) }))
    ))
  );
  liste.value = valeur || "";
  return liste;
}

// Destination choisie, panneau créé juste après celui en cours si demandé.
function destination(valeur) {
  if (valeur !== "__nouveau") return valeur || null;
  const panneau = panneauChoisi();
  const nouveau = creerPanneau(panneau);
  insererApres(scChoisi(), nouveau, panneau);
  return nouveau.id;
}

const TYPES_SUITE = [
  ["suite", "Passer à un panneau"],
  ["choix", "Choix du joueur"],
  ["fin", "Fin du chapitre"]
];

function rendreSuite() {
  const panneau = panneauChoisi();
  const { ensuite } = panneau;
  const apres = () => { marquerModifie(); rendreSuite(); rendreArbre(); };
  const contenu = [creer("select", {
    ariaLabel: "Ce qui suit ce panneau",
    onchange: e => {
      const type = e.target.value;
      panneau.ensuite = type === "choix"
        ? { type, options: [{ id: nouvelId("o"), texte: "", vers: null }, { id: nouvelId("o"), texte: "", vers: null }] }
        : type === "fin" ? { type, id: nouvelId("f"), nom: "Fin" } : { type };
      apres();
    }
  }, ...TYPES_SUITE.map(([value, textContent]) => creer("option", { value, textContent, selected: value === ensuite.type })))];

  if (ensuite.type === "suite") {
    contenu.push(listeDestinations(ensuite.vers, {
      libelleVide: "Panneau suivant dans la liste",
      onChange: valeur => { const vers = destination(valeur); if (vers) ensuite.vers = vers; else delete ensuite.vers; apres(); }
    }));
  } else if (ensuite.type === "fin") {
    contenu.push(creer("label", {}, "Nom de la fin",
      creer("input", { type: "text", maxLength: 60, value: ensuite.nom, oninput: e => { ensuite.nom = e.target.value; marquerModifie(); } })
    ));
  } else {
    ensuite.options.forEach((option, i) => {
      contenu.push(creer("div", { classe: "ed-carte" },
        creer("div", { classe: "ed-carte-haut" },
          creer("span", { classe: "ed-pousse", textContent: `Réponse ${i + 1}` }),
          creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Retirer", onclick: () => { ensuite.options.splice(i, 1); apres(); } })
        ),
        creer("input", { type: "text", maxLength: 300, value: option.texte, placeholder: "Texte de la réponse", ariaLabel: `Texte de la réponse ${i + 1}`, oninput: e => { option.texte = e.target.value; marquerModifie(); } }),
        listeDestinations(option.vers, { libelleVide: "Destination à choisir", onChange: valeur => { option.vers = destination(valeur); apres(); } })
      ));
    });
    contenu.push(creer("button", {
      type: "button",
      classe: "ed-bouton ed-large",
      textContent: "+ Réponse",
      disabled: ensuite.options.length >= 8,
      onclick: () => { ensuite.options.push({ id: nouvelId("o"), texte: "", vers: null }); apres(); }
    }));
  }
  edEl("ed-suite").replaceChildren(...contenu);
}

function rendreEntete() {
  edEl("ed-namecard-event").hidden = !histoire.namecard;
  if (histoire.namecard) edEl("ed-namecard-event").src = imageVn(histoire.namecard);
}

function rendreTout() {
  rendreArbre();
  rendreFormulaire();
  rendreApercu();
  rendrePersos();
  rendreSuite();
}

// ---- Choix et import d'images ----
let catalogueImages = null;

async function chargerCatalogue() {
  if (catalogueImages) return catalogueImages;
  const [cosmetiques, persos] = await Promise.all([
    fetch("/DB/images/cosmetiques.json").then(r => r.json()),
    fetch("/DB/characters.json").then(r => r.json())
  ]);
  catalogueImages = {
    fonds: cosmetiques.fonds.map(f => ({ chemin: f.image, miniature: f.miniature })),
    namecards: cosmetiques.bannieres.map(chemin => ({ chemin })),
    persos: [...new Set(persos.map(p => p.image.replace(/^images\//, "")))].map(chemin => ({ chemin }))
  };
  return catalogueImages;
}

async function chargerImportees() {
  const reponse = await fetch("/api/points?vn_images=1", { credentials: "include" });
  const data = await reponse.json();
  if (!reponse.ok) throw new Error(data.error || "Images importées introuvables");
  return data;
}

// Réduction selon l'usage de l'image, pour ménager le stockage.
const IMPORTS = {
  fond: { titre: "Choisir un fond", onglets: [["fonds", "Fonds du site"], ["namecards", "Namecards"], ["importees", "Images importées"]], largeur: 1920, hauteur: 1080 },
  perso: { titre: "Choisir un personnage", onglets: [["persos", "Personnages du site"], ["importees", "Images importées"]], largeur: 1600, hauteur: 1600 },
  namecard: { titre: "Choisir une namecard", onglets: [["namecards", "Namecards"], ["importees", "Images importées"]], largeur: 1200, hauteur: 600 }
};
const POIDS_MAX_IMPORT = 3 * 1024 * 1024;

let fenetreImages = { genre: null, onglet: null, surChoix: null };

async function ouvrirImages(genre, surChoix) {
  fenetreImages = { genre, onglet: IMPORTS[genre].onglets[0][0], surChoix };
  edEl("ed-images-titre").textContent = IMPORTS[genre].titre;
  edEl("ed-images-recherche").value = "";
  edEl("ed-images-etat").textContent = "";
  edEl("ed-images").showModal();
  await rendreImages();
}

async function rendreImages() {
  const { genre, onglet } = fenetreImages;
  edEl("ed-images-onglets").replaceChildren(...IMPORTS[genre].onglets.map(([id, nom]) => creer("button", {
    type: "button",
    classe: `ed-bouton${id === onglet ? " ed-onglet-actif" : ""}`,
    textContent: nom,
    onclick: () => { fenetreImages.onglet = id; rendreImages().catch(afficherErreurImages); }
  })));
  let images;
  if (onglet === "importees") {
    const { images: importees, poids, poids_max: poidsMax } = await chargerImportees();
    images = importees.map(chemin => ({ chemin }));
    edEl("ed-images-etat").textContent = `${Math.round(poids / 1048576)} Mo utilisés sur ${Math.round(poidsMax / 1048576)} Mo`;
  } else {
    images = (await chargerCatalogue())[onglet];
    edEl("ed-images-etat").textContent = "";
  }
  const recherche = edEl("ed-images-recherche").value.trim().toLowerCase();
  edEl("ed-images-grille").replaceChildren(...images
    .filter(image => !recherche || image.chemin.toLowerCase().includes(recherche))
    .map(image => creer("div", { classe: "ed-image", title: nomImage(image.chemin), tabIndex: 0, role: "button",
      onclick: event => { if (!event.target.closest(".ed-image-supprimer")) choisirImage(image.chemin); },
      onkeydown: event => { if (event.key === "Enter" && event.target === event.currentTarget) choisirImage(image.chemin); } },
      creer("img", { src: imageVn(image.miniature || image.chemin), alt: "", loading: "lazy" }),
      onglet === "importees" ? creer("button", { type: "button", classe: "ed-bouton ed-mini ed-image-supprimer", textContent: "×", title: "Supprimer du stockage", onclick: () => supprimerImportee(image.chemin) }) : null
    )));
}

function afficherErreurImages(erreur) {
  console.error(erreur);
  edEl("ed-images-etat").textContent = erreur.message || "Erreur";
}

function choisirImage(chemin) {
  edEl("ed-images").close();
  fenetreImages.surChoix(chemin);
}

async function supprimerImportee(chemin) {
  if (!confirm("Supprimer cette image du stockage ?")) return;
  // Un panneau pas encore enregistré peut s'en servir : l'enregistré est vérifié par le serveur.
  if (JSON.stringify(histoire).includes(chemin)) {
    edEl("ed-images-etat").textContent = "Cette histoire se sert de cette image.";
    return;
  }
  const reponse = await envoyer({ vn_image_suppression: { chemin } });
  if (reponse) await rendreImages().catch(afficherErreurImages);
}

async function imageEnWebp(fichier, { largeur, hauteur }) {
  if (!["image/png", "image/webp", "image/jpeg"].includes(fichier.type)) throw new Error("Formats acceptés : PNG, WebP, JPEG.");
  if (fichier.size > 20 * 1024 * 1024) throw new Error("Image trop lourde (20 Mo au plus).");
  const bitmap = await createImageBitmap(fichier);
  const echelle = Math.min(1, largeur / bitmap.width, hauteur / bitmap.height);
  const canvas = creer("canvas", { width: Math.round(bitmap.width * echelle), height: Math.round(bitmap.height * echelle) });
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const qualite of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL("image/webp", qualite);
    if (!url.startsWith("data:image/webp")) throw new Error("Ce navigateur ne sait pas créer de WebP : utilise Chrome, Firefox ou Edge.");
    if (url.length * 0.75 <= POIDS_MAX_IMPORT) return url;
  }
  throw new Error("Image trop lourde, même réduite.");
}

async function importerFichier(fichier) {
  edEl("ed-images-etat").textContent = "Envoi…";
  try {
    const data = await imageEnWebp(fichier, IMPORTS[fenetreImages.genre]);
    const reponse = await envoyer({ vn_import: { data } });
    if (reponse) choisirImage(reponse.chemin);
    else edEl("ed-images-etat").textContent = "Envoi refusé.";
  } catch (erreur) {
    afficherErreurImages(erreur);
  }
}

// ---- Serveur ----
async function envoyer(corps) {
  const reponse = await fetch("/api/points", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps)
  });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    alert(data.error || "Échec de l'enregistrement.");
    return null;
  }
  return data;
}

function afficherAvertissements(liste) {
  const zone = edEl("ed-avertissements");
  zone.hidden = !liste.length;
  zone.replaceChildren(...liste.map(texte => creer("li", { textContent: texte })));
}

async function enregistrer() {
  const bouton = edEl("ed-enregistrer");
  bouton.disabled = true;
  edEl("ed-etat").textContent = "Enregistrement…";
  try {
    const reponse = await envoyer({ vn_sauvegarde: { histoire, maj: majHistoire } });
    if (!reponse) {
      edEl("ed-etat").textContent = "Pas enregistré";
      return false;
    }
    majHistoire = reponse.maj;
    modifie = false;
    edEl("ed-essai").hidden = true;
    afficherAvertissements(reponse.avertissements);
    edEl("ed-etat").textContent = "Enregistré";
    return true;
  } catch (erreur) {
    console.error(erreur);
    edEl("ed-etat").textContent = "Connexion perdue : pas enregistré";
    return false;
  } finally {
    bouton.disabled = false;
  }
}

async function tester() {
  // Onglet ouvert tout de suite : sinon le navigateur le bloque après l'attente.
  const onglet = window.open("", "_blank");
  if (modifie && !await enregistrer()) {
    onglet?.close();
    return;
  }
  const adresse = `/visual_novel/lecteur?chapitre=${encodeURIComponent(selection.chapitre)}&panneau=${encodeURIComponent(selection.panneau)}`;
  if (onglet) onglet.location = adresse;
  else location.href = adresse;
}

// ---- Démarrage ----
function brancherFormulaire() {
  const surPanneau = (id, evenement, appliquer) => edEl(id).addEventListener(evenement, event => {
    appliquer(panneauChoisi(), event.target);
    marquerModifie();
    rendreApercu();
  });
  surPanneau("ed-nom", "input", (p, e) => { p.nom = e.value; });
  surPanneau("ed-texte", "input", (p, e) => { p.texte = e.value; });
  surPanneau("ed-police", "change", (p, e) => { p.police.famille = e.value; });
  surPanneau("ed-taille", "input", (p, e) => { p.police.taille = Number(e.value); });
  surPanneau("ed-gras", "change", (p, e) => { p.police.gras = e.checked; });
  surPanneau("ed-italique", "change", (p, e) => { p.police.italique = e.checked; });
  ["ed-nom", "ed-texte"].forEach(id => edEl(id).addEventListener("change", rendreArbre));

  edEl("ed-police").replaceChildren(...POLICES_VN.map(p => creer("option", { value: p.id, textContent: p.nom })));
  edEl("ed-taille").min = TAILLE_TEXTE_VN.min;
  edEl("ed-taille").max = TAILLE_TEXTE_VN.max;

  document.querySelectorAll("[data-marque]").forEach(bouton => {
    bouton.addEventListener("click", () => appliquerMarque(bouton.dataset.marque));
  });
  edEl("ed-nom-histoire").addEventListener("input", e => { histoire.nom = e.target.value; marquerModifie(); });
  edEl("ed-choisir-namecard-event").addEventListener("click", () => ouvrirImages("namecard", chemin => { histoire.namecard = chemin; marquerModifie(); rendreEntete(); }));
  edEl("ed-ajouter-chapitre").addEventListener("click", () => {
    const chapitre = { id: nouvelId("c"), titre: `Chapitre ${histoire.chapitres.length + 1}`, namecard: null, sous_chapitres: [creerSousChapitre("Sous-chapitre 1")] };
    histoire.chapitres.push(chapitre);
    marquerModifie();
    choisirPremier(chapitre);
  });
  edEl("ed-choisir-fond").addEventListener("click", () => ouvrirImages("fond", chemin => { panneauChoisi().fond = chemin; marquerModifie(); rendreApercu(); }));
  edEl("ed-retirer-fond").addEventListener("click", () => { panneauChoisi().fond = null; marquerModifie(); rendreApercu(); });
  edEl("ed-ajouter-perso").addEventListener("click", () => ouvrirImages("perso", chemin => {
    const { persos } = panneauChoisi();
    persos.push({ image: chemin, x: 50, y: 30, hauteur: 42, miroir: false });
    persoChoisi = persos.length - 1;
    marquerModifie();
    rendrePersos();
    rendreApercu();
  }));
  edEl("ed-enregistrer").addEventListener("click", enregistrer);
  edEl("ed-tester").addEventListener("click", tester);
  edEl("ed-reinitialiser").addEventListener("click", async () => {
    if (!confirm("Effacer ta progression de lecture sur tous les chapitres ?")) return;
    if (await envoyer({ vn_reinitialiser: true })) edEl("ed-etat").textContent = "Progression effacée";
  });
  edEl("ed-images-fermer").addEventListener("click", () => edEl("ed-images").close());
  edEl("ed-images-recherche").addEventListener("input", () => rendreImages().catch(afficherErreurImages));
  edEl("ed-images-import").addEventListener("change", event => {
    const [fichier] = event.target.files;
    event.target.value = "";
    if (fichier) importerFichier(fichier);
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      enregistrer();
    }
  });
  window.addEventListener("beforeunload", event => {
    if (modifie) event.preventDefault();
  });
}

async function demarrerEditeur() {
  const chargement = edEl("ed-chargement");
  try {
    const reponse = await fetch("/api/points?vn_edition=1", { credentials: "include" });
    const data = await reponse.json().catch(() => ({}));
    if (reponse.status === 401) { chargement.textContent = "Connecte-toi avec Discord pour écrire l'histoire."; return; }
    if (!reponse.ok) { chargement.textContent = data.error || "Éditeur indisponible."; return; }
    histoire = data.histoire;
    majHistoire = data.maj;
    edEl("ed-essai").hidden = data.maj !== null;
    afficherAvertissements(data.avertissements);
    edEl("ed-nom-histoire").value = histoire.nom;
    brancherFormulaire();
    rendreEntete();
    chargement.hidden = true;
    edEl("ed-zone").hidden = false;
    choisirPremier(histoire.chapitres[0]);
  } catch (erreur) {
    console.error(erreur);
    chargement.textContent = "Connexion perdue : recharge la page.";
  }
}

demarrerEditeur();
