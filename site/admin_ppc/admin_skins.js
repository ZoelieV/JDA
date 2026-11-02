// Administration : skins de personnages (tuile Skins). Un administrateur
// ajoute un skin (personnage, nom, images), masqué s'il le veut jusqu'au jour
// voulu, sans passer par le code ni la base (cf. api/points.js, _lib/skins.js).
// Images converties ici en WebP à la bonne taille, comme les skins de base.
// Mini admins : consultation seulement (le serveur refuse de toute façon).

const TAILLES_IMAGES_SKIN = { image: 256, side: 128, item: 256 };
const FORMATS_IMAGES_SKIN = ["image/png", "image/webp", "image/jpeg"];
const POIDS_MAX_FICHIER_SKIN = 10 * 1024 * 1024;
const APERCU_ARME_SKIN = "vesna_w";

let nomsPersosSkins = new Map();
// Skin en cours de modification dans le formulaire (id), ou null : ajout.
let skinEnEdition = null;
// Images de la liste rechargées après un remplacement (même adresse).
let versionImagesSkins = Date.now();

function messageSkin(texte, type = "") {
  const message = document.getElementById("message-skin");
  message.textContent = texte;
  message.className = `message-ajout${type ? ` ${type}` : ""}`;
}

// Image entière, centrée dans un carré transparent (jamais déformée).
async function imageSkinEnWebp(fichier, taille) {
  if (!FORMATS_IMAGES_SKIN.includes(fichier.type)) throw new Error("Formats acceptés : PNG, WebP, JPEG.");
  if (fichier.size > POIDS_MAX_FICHIER_SKIN) throw new Error("Image trop lourde (10 Mo au plus).");
  const bitmap = await createImageBitmap(fichier);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = taille;
  const echelle = Math.min(taille / bitmap.width, taille / bitmap.height);
  const largeur = bitmap.width * echelle;
  const hauteur = bitmap.height * echelle;
  canvas.getContext("2d").drawImage(bitmap, (taille - largeur) / 2, (taille - hauteur) / 2, largeur, hauteur);
  bitmap.close();
  const url = canvas.toDataURL("image/webp", 0.9);
  if (!url.startsWith("data:image/webp")) throw new Error("Ce navigateur ne sait pas créer de WebP : utilise Chrome, Firefox ou Edge.");
  return url;
}

// Aperçu du formulaire : les images telles qu'elles seront envoyées (même
// conversion), aux tailles où elles apparaissent sur le site. Sans fichier :
// image actuelle du skin modifié ; à l'ajout, tirée du portrait.
let raretesPersosSkins = new Map();
let numeroApercuSkin = 0;

async function majApercuSkin() {
  const numero = ++numeroApercuSkin;
  const zone = document.getElementById("apercu-skin");
  const portrait = document.getElementById("skin-image").files[0];
  const urls = {};
  const notes = {};
  try {
    for (const [cle, champ] of [["image", "skin-image"], ["side", "skin-side"], ["item", "skin-item"]]) {
      const fichier = document.getElementById(champ).files[0];
      if (fichier) {
        urls[cle] = await imageSkinEnWebp(fichier, TAILLES_IMAGES_SKIN[cle]);
      } else if (skinEnEdition) {
        urls[cle] = `/DB/${imagesSkin(skinEnEdition)[cle]}?t=${versionImagesSkins}`;
        notes[cle] = "image actuelle";
      } else if (portrait) {
        urls[cle] = await imageSkinEnWebp(portrait, TAILLES_IMAGES_SKIN[cle]);
        notes[cle] = "tirée du portrait";
      }
    }
  } catch (erreur) {
    if (numero === numeroApercuSkin) messageSkin(erreur.message, "erreur");
    return;
  }
  if (numero !== numeroApercuSkin) return; // un autre fichier a été choisi entre-temps
  zone.classList.toggle("cache", !urls.image);
  if (!urls.image) return;
  const perso = document.getElementById("skin-perso").value;
  const fond = classeFondRarete(raretesPersosSkins.get(perso) || "5");
  const note = cle => (notes[cle] ? `<small>${notes[cle]}</small>` : "");
  zone.innerHTML = `
    <h3 class="titre-section-ajout">Aperçu</h3>
    <div class="apercu-skin-liste">
      <figure>
        <div class="apercu-skin-portrait ${fond}"><img src="${echapper(urls.image)}" alt=""></div>
        <figcaption>Portrait<small>carte du perso (box, draft)</small>${note("image")}</figcaption>
      </figure>
      <figure>
        <div class="apercu-skin-arme fond-5">
          <img class="apercu-skin-arme-image" src="/DB/images/weapons/${APERCU_ARME_SKIN}.webp" alt="">
          <img class="apercu-skin-side" src="${echapper(urls.side)}" alt="">
        </div>
        <figcaption>Icône de profil<small>en bas à droite de son arme signature</small>${note("side")}</figcaption>
      </figure>
      <figure>
        <div class="apercu-skin-choix"><img src="${echapper(urls.item)}" alt=""></div>
        <figcaption>Image du choix<small>activé (Personnalisation)</small>${note("item")}</figcaption>
      </figure>
      <figure>
        <div class="apercu-skin-choix eteint"><img src="${echapper(urls.item)}" alt=""></div>
        <figcaption>Image du choix<small>pas activé</small></figcaption>
      </figure>
    </div>`;
}

// Toute modification : réponse = config complète ; caches de la page vidés
// (catalogue des cosmétiques des autres fenêtres de l'admin).
async function envoyerSkin(corps) {
  const reponse = await fetch("/api/points", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps)
  });
  const resultat = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(resultat.error || "Erreur d'enregistrement.");
  promessePointsAdmin = null;
  promesseCatalogueChoix = null;
  catalogueChoixCosmetiques = null;
  // Fenêtre Rikoyns : elle renvoie tous les prix en enregistrant.
  prixKoyns = { ...(resultat.prix_cosmetiques || {}) };
  afficherSkinsAjoutes(resultat.skins_ajoutes || [], resultat.prix_cosmetiques);
}

// Prix saisi : entier, ou null si le champ est vide (prix par défaut).
function lirePrixSkin(champ) {
  if (champ.value.trim() === "") return null;
  const prix = Number(champ.value);
  if (!Number.isInteger(prix) || prix < 0 || prix > PRIX_COSMETIQUE_MAX) throw new Error(`Prix : entier de 0 à ${PRIX_COSMETIQUE_MAX}.`);
  return prix;
}

// Champ du prix du formulaire : prix par défaut du personnage choisi.
function majPrixDefautSkin() {
  const perso = document.getElementById("skin-perso").value;
  document.getElementById("skin-prix").placeholder = perso
    ? `Par défaut : ${prixParDefautCosmetique(idCosmetique("skin", `${perso}__skin`))}`
    : "Par défaut";
}

function afficherSkinsAjoutes(skins, prix = {}) {
  definirSkinsAjoutes(skins);
  const lectureSeule = document.body.classList.contains("lecture-seule");
  const liste = document.getElementById("liste-skins");
  if (!skins.length) {
    liste.innerHTML = `<p class="aide-apercu">Aucun skin ajouté pour l'instant.</p>`;
    return;
  }
  liste.innerHTML = [...skins].reverse().map(skin => {
    const cosmetique = idCosmetique("skin", skin.id);
    const regle = Number.isInteger(prix?.[cosmetique]) ? prix[cosmetique] : "";
    return `
    <div class="skin-ajoute${skin.masque ? " masque" : ""}" data-id="${echapper(skin.id)}">
      <img src="/DB/${echapper(imagesSkin(skin.id).item)}?t=${versionImagesSkins}" alt="">
      <span class="skin-ajoute-nom">${echapper(nomSkin(skin.id, nomsPersosSkins.get(skin.perso) || skin.perso))}</span>
      <span class="skin-ajoute-statut">${skin.masque ? "Masqué" : "Visible"}</span>
      <label class="champ-prix-skin">Prix <input type="number" class="texte-ajout" data-prix min="0" max="${PRIX_COSMETIQUE_MAX}" step="1" value="${regle}" placeholder="${prixParDefautCosmetique(cosmetique)}"${lectureSeule ? " disabled" : ""}></label>
      ${lectureSeule ? "" : `
        <button type="button" class="btn-ouvrir-ajout" data-action="modifier">Modifier</button>
        <button type="button" class="btn-ouvrir-ajout" data-action="masque">${skin.masque ? "Afficher" : "Masquer"}</button>
        <button type="button" class="btn-ouvrir-ajout" data-action="supprimer">Supprimer</button>`}
    </div>`;
  }).join("");
}

// Formulaire en mode modification (skin) ou ajout (null) : personnage figé
// (il fait partie de l'id du skin), prix et masquage réglés dans la liste,
// images facultatives (seules celles choisies sont remplacées).
function preparerFormulaireSkin(skin) {
  skinEnEdition = skin?.id || null;
  const choix = document.getElementById("skin-perso");
  choix.disabled = !!skin;
  if (skin) choix.value = skin.perso;
  document.getElementById("skin-nom").value = skin?.nom || "";
  ["skin-image", "skin-side", "skin-item", "skin-prix"].forEach(champ => { document.getElementById(champ).value = ""; });
  document.getElementById("skin-prix").closest("label").classList.toggle("cache", !!skin);
  document.getElementById("skin-masque").closest("label").classList.toggle("cache", !!skin);
  document.getElementById("creer-skin").textContent = skin ? "Enregistrer" : "Ajouter le skin";
  document.getElementById("annuler-modif-skin").classList.toggle("cache", !skin);
  document.getElementById("aide-modif-skin").classList.toggle("cache", !skin);
  majPrixDefautSkin();
  majApercuSkin();
}

async function modifierSkin() {
  const nom = document.getElementById("skin-nom").value.trim();
  if (!nom) {
    messageSkin("Nom obligatoire.", "erreur");
    return;
  }
  const bouton = document.getElementById("creer-skin");
  bouton.disabled = true;
  messageSkin("Envoi…");
  try {
    const images = {};
    for (const [cle, champ] of [["image", "skin-image"], ["side", "skin-side"], ["item", "skin-item"]]) {
      const fichier = document.getElementById(champ).files[0];
      if (fichier) images[cle] = await imageSkinEnWebp(fichier, TAILLES_IMAGES_SKIN[cle]);
    }
    versionImagesSkins = Date.now();
    await envoyerSkin({ skin_modification: { id: skinEnEdition, nom, images } });
    preparerFormulaireSkin(null);
    messageSkin(Object.keys(images).length ? "Skin modifié. Les nouvelles images arrivent chez les joueurs sous quelques minutes." : "Skin modifié.", "succes");
  } catch (erreur) {
    console.error(erreur);
    messageSkin(erreur.message, "erreur");
  }
  bouton.disabled = false;
}

async function creerSkin() {
  if (skinEnEdition) return modifierSkin();
  const perso = document.getElementById("skin-perso").value;
  const nom = document.getElementById("skin-nom").value.trim();
  const fichierImage = document.getElementById("skin-image").files[0];
  if (!perso || !nom || !fichierImage) {
    messageSkin("Personnage, nom et portrait obligatoires.", "erreur");
    return;
  }
  const bouton = document.getElementById("creer-skin");
  bouton.disabled = true;
  messageSkin("Envoi…");
  try {
    // Icône et image du choix facultatives : à partir du portrait sinon.
    const images = {};
    for (const [cle, champ] of [["image", "skin-image"], ["side", "skin-side"], ["item", "skin-item"]]) {
      images[cle] = await imageSkinEnWebp(document.getElementById(champ).files[0] || fichierImage, TAILLES_IMAGES_SKIN[cle]);
    }
    const masque = document.getElementById("skin-masque").checked;
    const prix = lirePrixSkin(document.getElementById("skin-prix"));
    await envoyerSkin({ skin_ajout: { perso, nom, masque, prix, images } });
    document.getElementById("skin-nom").value = "";
    document.getElementById("skin-prix").value = "";
    ["skin-image", "skin-side", "skin-item"].forEach(champ => { document.getElementById(champ).value = ""; });
    majApercuSkin();
    messageSkin(masque ? "Skin ajouté, masqué : affiche-le le moment venu." : "Skin ajouté, visible par les joueurs.", "succes");
  } catch (erreur) {
    console.error(erreur);
    messageSkin(erreur.message, "erreur");
  }
  bouton.disabled = false;
}

async function ouvrirSkins() {
  document.getElementById("modal-skins").classList.add("active");
  preparerFormulaireSkin(null);
  document.getElementById("formulaire-skin").classList.toggle("cache", document.body.classList.contains("lecture-seule"));
  messageSkin("Chargement…");
  try {
    const [personnages, points] = await Promise.all([chargerPersonnages(true), chargerPointsAdmin()]);
    nomsPersosSkins = new Map(personnages.map(perso => [perso.id, perso.nom]));
    Object.entries(PERSOS_SKIN_VOYAGEUR).forEach(([id, nom]) => nomsPersosSkins.set(id, nom));
    raretesPersosSkins = new Map(personnages.map(perso => [perso.id, perso.rarete]));
    const choix = document.getElementById("skin-perso");
    if (choix.options.length <= 1) {
      // Voyageur : un skin par apparence ; Manekin : variantes seulement (cf.
      // appliquerVariante).
      [
        ...personnages.filter(perso => !perso.groupe && !VARIANTES_PERSONNAGES[perso.id]),
        ...Object.entries(PERSOS_SKIN_VOYAGEUR).map(([id, nom]) => ({ id, nom: `${nom} (Voyageur)` }))
      ].sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
        .forEach(perso => choix.add(new Option(perso.nom, perso.id)));
    }
    majPrixDefautSkin();
    afficherSkinsAjoutes(points.skins_ajoutes || [], points.prix_cosmetiques);
    messageSkin("");
  } catch (erreur) {
    console.error(erreur);
    messageSkin("Impossible de charger les skins.", "erreur");
  }
}

function initialiserSkins() {
  const modal = document.getElementById("modal-skins");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-skins").addEventListener("click", ouvrirSkins);
  document.getElementById("fermer-skins").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.getElementById("creer-skin").addEventListener("click", creerSkin);
  document.getElementById("annuler-modif-skin").addEventListener("click", () => {
    preparerFormulaireSkin(null);
    messageSkin("");
  });
  document.getElementById("skin-perso").addEventListener("change", () => {
    majPrixDefautSkin();
    majApercuSkin();
  });
  ["skin-image", "skin-side", "skin-item"].forEach(champ => document.getElementById(champ).addEventListener("change", majApercuSkin));
  // Prix d'un skin de la liste : enregistré dès qu'il change (vide : défaut).
  document.getElementById("liste-skins").addEventListener("change", async event => {
    if (!event.target.matches("[data-prix]")) return;
    try {
      const prix = lirePrixSkin(event.target);
      await envoyerSkin({ skin_prix: { id: event.target.closest(".skin-ajoute").dataset.id, prix } });
      messageSkin("Prix enregistré.", "succes");
    } catch (erreur) {
      console.error(erreur);
      messageSkin(erreur.message, "erreur");
    }
  });
  document.getElementById("liste-skins").addEventListener("click", async event => {
    const bouton = event.target.closest("[data-action]");
    if (!bouton) return;
    const id = bouton.closest(".skin-ajoute").dataset.id;
    const skin = SKINS_AJOUTES.find(s => s.id === id);
    if (bouton.dataset.action === "modifier") {
      preparerFormulaireSkin(skin);
      messageSkin("");
      document.querySelector("#modal-skins .modal-apercu-contenu").scrollTo({ top: 0 });
      return;
    }
    if (bouton.dataset.action === "supprimer" && !window.confirm(`Supprimer le skin « ${skin.nom} » ? Les joueurs qui l'ont le perdent, et ceux qui l'ont acheté sont remboursés. C'est définitif.`)) return;
    bouton.disabled = true;
    try {
      await envoyerSkin(bouton.dataset.action === "masque"
        ? { skin_masque: { id, masque: !skin.masque } }
        : { skin_suppression: { id } });
      if (id === skinEnEdition && bouton.dataset.action === "supprimer") preparerFormulaireSkin(null);
      messageSkin(bouton.dataset.action === "supprimer" ? "Skin supprimé." : "");
    } catch (erreur) {
      console.error(erreur);
      messageSkin(erreur.message, "erreur");
      bouton.disabled = false;
    }
  });
}

initialiserSkins();
