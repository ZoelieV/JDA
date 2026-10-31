// Tournois : libellés, appels à l'API (/api/rooms/tournoi/<action>?id=, cf.
// api/_lib/tournois.js) et formulaire de création / modification, communs à
// tournois.js (liste) et tournoi.js (page d'un tournoi).

const MODES_TOURNOI = {
  auto: "Full box (draft du plus petit palier)",
  sardine: "Sardine",
  carpe: "Classique",
  dauphin: "Dauphin",
  baleine: "Baleine",
  12: "Mêlée générale",
  carnage: "No ban (sans équilibrage)"
};
const RECOMPENSES_TOURNOI = {
  cosmetiques: "Cosmétiques du site",
  battle_pass: "Battle pass Genshin",
  faveur: "Faveur de l'astre (Genshin)",
  pack: "Pack Genshin",
  rien: "Pas de récompense"
};
const STATUTS_TOURNOI = {
  inscriptions: "Inscriptions ouvertes",
  verrouille: "Inscriptions fermées",
  qualifs: "Qualifications",
  arbre: "Phase finale",
  termine: "Terminé",
  annule: "Annulé"
};
const TAILLES_ARBRE_TOURNOI = { 2: "Finale", 4: "Demi-finales", 8: "Quarts de finale", 16: "8es de finale", 32: "16es de finale", 64: "32es de finale", 128: "64es de finale" };

function echapperTournoi(texte) {
  return String(texte ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function dateTournoi(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// « X remporte la faveur de l'astre ! » (nomHtml déjà échappé).
const PRIX_TOURNOI = {
  cosmetiques: "des cosmétiques du site",
  battle_pass: "le battle pass",
  faveur: "la faveur de l'astre",
  pack: "un pack Genshin"
};

function htmlVictoireTournoi(nomHtml, recompense) {
  return `🏆 ${nomHtml} remporte ${PRIX_TOURNOI[recompense?.type] || "le tournoi"} !`;
}

// Format de la finale (anciens tournois : finale_bo5, sinon comme l'arbre).
function finaleTournoi(tournoi) {
  return tournoi.finale_affrontement || (tournoi.finale_bo5 ? "bo5" : tournoi.affrontement);
}

const NOMS_AFFRONTEMENTS = { bo1: "un seul match", bo3: "best of 3", bo5: "best of 5" };

const LETTRES_POULES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const nomPouleTournoi = numero => `Poule ${numero < 26 ? LETTRES_POULES[numero] : numero + 1}`;

// Pastilles : format de l'arbre, et de la finale s'il est différent.
function htmlPastillesAffrontement(tournoi) {
  const finale = finaleTournoi(tournoi);
  return (tournoi.affrontement === "bo3" ? `<span class="pastille-tournoi">Best of 3</span>` : "") +
    (finale && finale !== tournoi.affrontement ? `<span class="pastille-tournoi">Finale en ${finale}</span>` : "");
}

function formatTournoi(tournoi) {
  return tournoi.format === "equipe" ? `En équipe ${tournoi.taille_equipe}v${tournoi.taille_equipe}` : "1v1";
}

function modeTournoi(tournoi) {
  return tournoi.format === "equipe" ? "Draft Classique (vitrines)" : MODES_TOURNOI[tournoi.mode] || tournoi.mode;
}

// Joueur (photo, pseudo) : joueurs = { id: { nom, avatar } }.
function htmlJoueurTournoi(joueurs, id) {
  const joueur = joueurs?.[id];
  const photo = joueur?.avatar ? `<img src="${echapperTournoi(joueur.avatar)}" alt="" loading="lazy">` : `<span class="sans-photo"></span>`;
  return `<span class="joueur-tournoi">${photo}<span>${echapperTournoi(joueur?.nom || "Joueur")}</span></span>`;
}

// ---- Image du tournoi (cf. changerImage dans api/_lib/tournois.js) ----

const IMAGE_TOURNOI_DEFAUT = "/DB/images/namecards/Namecard_Background_Travel_Notes_Simulnation.webp";

function urlImageTournoi(tournoi) {
  const image = typeof tournoi?.image === "string" ? tournoi.image : "";
  if (image.startsWith("site:")) return `/DB/images/${image.slice(5)}`;
  if (image.startsWith("upload:")) return `/api/rooms/tournoi/image?id=${tournoi.id}&v=${image.slice(7)}`;
  return IMAGE_TOURNOI_DEFAUT;
}

// Pour un attribut style (adresse encodée : pas de guillemets ni de
// parenthèses qui sortiraient du url()).
function styleImageTournoi(tournoi, url = urlImageTournoi(tournoi)) {
  return `background-image: url(${encodeURI(url).replace(/['()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)})`;
}

// "namecards/Namecard_Background_Hu_Tao_Lingering.webp" -> "Hu Tao Lingering"
function nomImageTournoi(chemin) {
  return chemin.split("/").pop().replace(/^Namecard_Background_/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " ");
}

let promesseImagesTournoi = null;

// Namecards et fonds d'écran du site, cachés à part (cosmétiques cachés de
// cosmetiques.json) -> { namecards, caches, fonds } : [{ chemin, miniature, nom }].
function chargerImagesTournoi() {
  promesseImagesTournoi ??= fetch("/DB/images/cosmetiques.json")
    .then(reponse => reponse.json())
    .then(cosmetiques => {
      const caches = new Set(cosmetiques.caches || []);
      const namecards = cosmetiques.bannieres.map(chemin => ({ chemin, miniature: chemin, nom: nomImageTournoi(chemin), cache: caches.has(`banniere:${chemin}`) }));
      const fonds = cosmetiques.fonds.map(fond => ({ chemin: fond.image, miniature: fond.miniature, nom: nomImageTournoi(fond.image), cache: caches.has(`fond:${fond.id}`) }));
      return {
        namecards: namecards.filter(image => !image.cache),
        caches: [...namecards, ...fonds].filter(image => image.cache),
        fonds: fonds.filter(image => !image.cache)
      };
    })
    .catch(erreur => { promesseImagesTournoi = null; throw erreur; });
  return promesseImagesTournoi;
}

// Fenêtre de choix parmi les images du site -> Promise<chemin | null>.
function choisirImageSiteTournoi() {
  return new Promise(resoudre => {
    const fenetre = document.createElement("dialog");
    fenetre.className = "fenetre-images-tournoi";
    fenetre.innerHTML = `
      <h2>Image du tournoi</h2>
      <div class="onglets-images-tournoi">
        <button type="button" class="bouton-tournoi petit principal" data-onglet="namecards">Namecards</button>
        <button type="button" class="bouton-tournoi petit" data-onglet="caches">Cachés</button>
        <button type="button" class="bouton-tournoi petit" data-onglet="fonds">Fonds d'écran</button>
        <input type="search" class="bouton-tournoi" placeholder="Rechercher…">
      </div>
      <div class="grille-images-tournoi"><p class="doux">Chargement…</p></div>
      <div class="pied-formulaire"><button type="button" class="bouton-tournoi" data-action="annuler">Annuler</button></div>`;
    let choix = null;
    let images = null;
    let onglet = "namecards";
    const recherche = fenetre.querySelector("input");
    const afficher = () => {
      if (!images) return;
      const filtre = recherche.value.trim().toLowerCase();
      const liste = images[onglet].filter(image => !filtre || image.nom.toLowerCase().includes(filtre));
      fenetre.querySelector(".grille-images-tournoi").innerHTML = liste.map(image => `
        <button type="button" class="image-tournoi-choix" data-chemin="${echapperTournoi(image.chemin)}" title="${echapperTournoi(image.nom)}">
          <img src="${echapperTournoi(encodeURI(`/DB/images/${image.miniature}`))}" alt="" loading="lazy">
          <span>${echapperTournoi(image.nom)}</span>
        </button>`).join("") || `<p class="doux">Aucune image.</p>`;
    };
    fenetre.addEventListener("click", event => {
      const bouton = event.target.closest("[data-onglet]");
      if (bouton) {
        onglet = bouton.dataset.onglet;
        fenetre.querySelectorAll("[data-onglet]").forEach(b => b.classList.toggle("principal", b === bouton));
        afficher();
      }
      const image = event.target.closest("[data-chemin]");
      if (image) { choix = image.dataset.chemin; fenetre.close(); }
      if (event.target.closest('[data-action="annuler"]')) fenetre.close();
    });
    recherche.addEventListener("input", afficher);
    fenetre.addEventListener("close", () => { fenetre.remove(); resoudre(choix); });
    document.body.appendChild(fenetre);
    fenetre.showModal();
    chargerImagesTournoi().then(donnees => { images = donnees; afficher(); }).catch(() => {
      fenetre.querySelector(".grille-images-tournoi").innerHTML = `<p class="message-tournoi erreur">Images indisponibles.</p>`;
    });
  });
}

// Image importée -> data URL compressée (1680 × 600 au plus, 400 Ko au plus).
async function preparerImageTournoi(fichier) {
  if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(fichier.type)) throw new Error("Choisis une image (png, jpeg, webp).");
  const bitmap = await createImageBitmap(fichier).catch(() => { throw new Error("Image illisible."); });
  const echelle = Math.min(1, 1680 / bitmap.width, 600 / bitmap.height);
  const toile = document.createElement("canvas");
  toile.width = Math.max(1, Math.round(bitmap.width * echelle));
  toile.height = Math.max(1, Math.round(bitmap.height * echelle));
  toile.getContext("2d").drawImage(bitmap, 0, 0, toile.width, toile.height);
  bitmap.close?.();
  const limite = 400 * 1024 * 4 / 3; // en base64
  for (const [type, qualite] of [["image/webp", 0.85], ["image/webp", 0.7], ["image/jpeg", 0.85], ["image/jpeg", 0.7], ["image/jpeg", 0.5]]) {
    const url = toile.toDataURL(type, qualite);
    if (url.startsWith(`data:${type};`) && url.length < limite) return url;
  }
  throw new Error("Image trop lourde, même compressée.");
}

// Appel de l'API -> données, ou erreur levée (message du serveur).
async function appelTournoi(action, { id = null, corps = null } = {}) {
  const url = `/api/rooms/tournoi/${action}${id ? `?id=${encodeURIComponent(id)}` : ""}`;
  const reponse = await fetch(url, corps ? {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps)
  } : { credentials: "include" });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.error || "Erreur du serveur.");
  return donnees;
}

// "2026-10-28T18:00:00.000Z" <-> champ datetime-local (heure locale).
function versChampDateTournoi(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function depuisChampDateTournoi(valeur) {
  return valeur ? new Date(valeur).toISOString() : null;
}

// ---- Formulaire (création si id absent, sinon modification) ----
// config : tournoi existant (modification). Après l'enregistrement :
// surSucces(id).
function ouvrirFormulaireTournoi({ config = null, id = null, surSucces }) {
  const verrouille = !!config && config.statut !== "inscriptions";
  const c = config || {};
  const options = (valeurs, choisie) => Object.entries(valeurs)
    .map(([valeur, libelle]) => `<option value="${valeur}"${String(valeur) === String(choisie) ? " selected" : ""}>${libelle}</option>`).join("");
  const fenetre = document.createElement("dialog");
  fenetre.className = "fenetre-formulaire-tournoi";
  fenetre.innerHTML = `
    <h2>${id ? "Modifier le tournoi" : "Créer un tournoi"}</h2>
    <form class="formulaire-tournoi" novalidate>
      ${verrouille ? `<p class="aide">Inscriptions fermées : seuls le nom, la description, la récompense, la fin, les dates des phases et les matchs en parallèle se modifient encore.</p>` : ""}
      <fieldset>
        <legend>Présentation</legend>
        <label class="large">Nom <input name="nom" maxlength="60" required value="${echapperTournoi(c.nom || "")}"></label>
        <label class="large">Description (principe, règles particulières…)
          <textarea name="description" maxlength="1000">${echapperTournoi(c.description || "")}</textarea>
          <span class="aide"><span class="compteur-description">0</span> / 1000</span>
        </label>
      </fieldset>
      <fieldset${verrouille ? " disabled" : ""}>
        <legend>Format</legend>
        <label>Type
          <select name="format">${options({ "1v1": "1v1", equipe: "En équipe" }, c.format || "1v1")}</select>
        </label>
        <label data-pour="equipe">Joueurs par équipe
          <select name="taille_equipe">${options({ 2: "2v2", 3: "3v3", 4: "4v4" }, c.taille_equipe || 2)}</select>
        </label>
        <label data-pour="1v1">Mode de draft
          <select name="mode">${options(MODES_TOURNOI, c.mode || "auto")}</select>
        </label>
        <label data-pour="1v1">Box
          <select name="box">${options({ full: "Full box imposée", libre: "Au choix des joueurs (full / opti)" }, c.box || "full")}</select>
        </label>
        <label>Affrontements de la phase finale
          <select name="affrontement">${options({ bo1: "Un seul match", bo3: "Best of 3" }, c.affrontement || "bo1")}</select>
        </label>
        <label>La finale (dernier match)
          <select name="finale_affrontement">${options({ bo1: "Un seul match", bo3: "Best of 3", bo5: "Best of 5" }, finaleTournoi(c) || "bo1")}</select>
        </label>
        <p class="aide large" data-pour="equipe">En équipe : draft Classique avec les vitrines, comme le mode En équipe.</p>
      </fieldset>
      <fieldset${verrouille ? " disabled" : ""}>
        <legend>Participants</legend>
        <label>Participants maximum <span class="aide">(joueurs ou équipes)</span>
          <input name="max_participants" type="number" min="2" max="256" value="${c.max_participants || 16}">
        </label>
        <label>Phase finale à partir des
          <select name="arbre_max">${options(TAILLES_ARBRE_TOURNOI, c.arbre_max || 16)}</select>
        </label>
        <div class="large qualifs-formulaire" data-qualifs>
          <p class="aide">Plus d'inscrits que de places dans la phase finale : qualifications d'abord (matchs en parallèle, temps saisis par les arbitres, trophées comme en classé).</p>
          <label>Qualifications
            <select name="qualifs_format">${options({ rondes: "Rondes (adversaires au hasard)", poules: "Poules (tous contre tous)" }, c.qualifs_format || "rondes")}</select>
          </label>
          <label data-qualifs-format="rondes">Matchs par participant
            <input name="qualif_matchs" type="number" min="1" max="10" value="${c.qualif_matchs || 3}">
          </label>
          <label data-qualifs-format="poules">Nombre de poules
            <input name="poules_nombre" type="number" min="2" max="64" value="${c.poules?.nombre || ""}">
          </label>
          <label data-qualifs-format="poules">Participants par poule (au plus)
            <input name="poules_taille" type="number" min="3" max="16" value="${c.poules?.taille || ""}">
          </label>
          <label data-qualifs-format="poules">Qualifiés par poule
            <input name="poules_qualifies" type="number" min="1" max="15" value="${c.poules?.qualifies || ""}">
          </label>
          <label data-qualifs-format="poules">Matchs de poule
            <select name="poules_affrontement">${options({ bo1: "Un seul match", bo3: "Best of 3" }, c.poules_affrontement || "bo1")}</select>
          </label>
          <button type="button" class="bouton-tournoi petit" data-qualifs-format="poules" data-action="proposer-poules">Proposer des poules</button>
        </div>
        <p class="large coherence-tournoi"></p>
      </fieldset>
      <fieldset>
        <legend>Dates</legend>
        <label${verrouille ? " hidden" : ""}>Fin des inscriptions <input name="verrouillage" type="datetime-local" value="${versChampDateTournoi(c.verrouillage)}"></label>
        <label${verrouille ? " hidden" : ""}>Début <input name="debut" type="datetime-local" required value="${versChampDateTournoi(c.debut)}"></label>
        <label>Fin <span class="aide">(si plusieurs jours)</span> <input name="fin" type="datetime-local" value="${versChampDateTournoi(c.fin)}"></label>
      </fieldset>
      <fieldset>
        <legend>Dates des phases</legend>
        <p class="aide large">Facultatives, affichées sur la page du tournoi ; modifiables à tout moment.</p>
        <div class="large dates-phases-formulaire"></div>
      </fieldset>
      <fieldset>
        <legend>Image</legend>
        <div class="large choix-image-formulaire">
          <div class="apercu-image-tournoi" style="${styleImageTournoi(c)}"></div>
          <div class="actions-match">
            <button type="button" class="bouton-tournoi petit" data-action="image-site">Namecards et fonds d'écran du site</button>
            <button type="button" class="bouton-tournoi petit" data-action="image-importer">Importer une image</button>
            <button type="button" class="bouton-tournoi petit" data-action="image-defaut">Image par défaut</button>
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-image-fichier>
          </div>
          <p class="aide">Affichée recadrée (format namecard) ; image importée compressée automatiquement.</p>
        </div>
      </fieldset>
      <fieldset>
        <legend>Phase finale</legend>
        <label class="ligne large"><input name="arbre_parallele" type="checkbox"${c.arbre_parallele ? " checked" : ""}> Matchs en parallèle <span class="aide">(lancés par les joueurs du match ou un arbitre ; sinon un match à la fois, lancé par toi)</span></label>
      </fieldset>
      <fieldset${verrouille ? " disabled" : ""}>
        <legend>Chronos de la draft</legend>
        <label class="ligne large"><input name="chronos_actifs" type="checkbox"${c.chronos ? " checked" : ""}> Draft chronométrée</label>
        <label data-chronos>Analyse des box (s) <input name="analyse_s" type="number" min="30" max="600" value="${c.chronos?.analyse_s || 120}"></label>
        <label data-chronos>Par pick / ban (s) <input name="action_s" type="number" min="10" max="120" value="${c.chronos?.action_s || 30}"></label>
        <label data-chronos>Par ban d'équilibrage (s) <input name="ban_s" type="number" min="5" max="60" value="${c.chronos?.ban_s || 15}"></label>
      </fieldset>
      <fieldset>
        <legend>Récompenses</legend>
        <label>Type <select name="recompense_type">${options(RECOMPENSES_TOURNOI, c.recompense?.type || "rien")}</select></label>
        <label class="large">Détail <input name="recompense_texte" maxlength="300" placeholder="Ex. 1er : battle pass, 2e : namecard exclusive" value="${echapperTournoi(c.recompense?.texte || "")}"></label>
      </fieldset>
      <div class="pied-formulaire">
        <p class="message-tournoi"></p>
        <button type="button" class="bouton-tournoi" data-action="annuler">Annuler</button>
        <button type="submit" class="bouton-tournoi principal">${id ? "Enregistrer" : "Créer le tournoi"}</button>
      </div>
    </form>`;
  const formulaire = fenetre.querySelector("form");
  const champ = nom => formulaire.elements[nom];
  // Mêmes règles que erreurCoherence (api/_lib/tournois.js) : phase finale
  // pas plus grande que le tournoi, poules qui remplissent exactement la
  // phase finale et accueillent tout le monde.
  const puissance2 = n => { let t = 2; while (t < n) t *= 2; return t; };
  const lirePoules = () => ({
    nombre: Number(champ("poules_nombre").value),
    taille: Number(champ("poules_taille").value),
    qualifies: Number(champ("poules_qualifies").value)
  });
  const coherence = () => {
    const max = Number(champ("max_participants").value);
    const places = Number(champ("arbre_max").value);
    const phase = TAILLES_ARBRE_TOURNOI[places]?.toLowerCase() || "";
    if (!(max >= 2)) return { erreur: "Au moins 2 participants." };
    if (places > puissance2(max)) return { erreur: `Phase finale à ${places} places (${phase}) pour ${max} participants au plus : impossible.` };
    if (max <= places) return { info: `Pas de qualifications : tous les inscrits vont directement en phase finale (${phase}).` };
    if (champ("qualifs_format").value !== "poules") {
      return { info: `Si plus de ${places} inscrits : ${champ("qualif_matchs").value} match(s) de qualification chacun, les ${places} meilleurs en ${phase}.` };
    }
    const { nombre, taille, qualifies } = lirePoules();
    if (!(nombre >= 2 && nombre <= 64)) return { erreur: "Entre 2 et 64 poules." };
    if (!(taille >= 3 && taille <= 16)) return { erreur: "Entre 3 et 16 participants par poule." };
    if (!(qualifies >= 1 && qualifies < taille)) return { erreur: `Entre 1 et ${taille - 1} qualifiés par poule.` };
    if (nombre * qualifies !== places) return { erreur: `${nombre} poules × ${qualifies} qualifiés = ${nombre * qualifies} : il en faut exactement ${places} pour les ${phase}.` };
    if (nombre * taille < max) return { erreur: `${nombre} poules de ${taille} = ${nombre * taille} places pour ${max} participants : pas assez.` };
    if ((nombre - 1) * taille >= max) return { erreur: `${max} participants tiennent dans ${nombre - 1} poules de ${taille} : une poule de trop.` };
    return { info: `${nombre} poules de ${taille} au plus, les ${qualifies} meilleurs de chaque poule en ${phase} (${places} qualifiés) ✓` };
  };
  // Poules proposées : 2 qualifiés par poule (1 si les poules seraient trop
  // grandes), poules de la taille juste suffisante.
  const proposerPoules = () => {
    const max = Number(champ("max_participants").value);
    const places = Number(champ("arbre_max").value);
    for (const qualifies of [2, 1, 3, 4]) {
      const nombre = places / qualifies;
      if (!Number.isInteger(nombre) || nombre < 2) continue;
      const taille = Math.max(qualifies + 1, 3, Math.ceil(max / nombre));
      if (taille > 16 || (nombre - 1) * taille >= max) continue;
      champ("poules_nombre").value = nombre;
      champ("poules_taille").value = taille;
      champ("poules_qualifies").value = qualifies;
      return;
    }
  };
  fenetre.querySelector('[data-action="proposer-poules"]').addEventListener("click", () => {
    proposerPoules();
    majVisibles();
  });
  // Dates des phases : qualifications (rondes) ou une par poule, puis une par
  // tour de la phase finale ; champs refaits selon les réglages, valeurs
  // gardées (clé data-date).
  const datesSaisies = new Map([
    ["qualifs", versChampDateTournoi(c.dates_phases?.qualifs)],
    ...(c.dates_phases?.poules || []).map((valeur, numero) => [`poule:${numero}`, versChampDateTournoi(valeur)]),
    ...Object.entries(c.dates_phases?.tours || {}).map(([places, valeur]) => [`tour:${places}`, versChampDateTournoi(valeur)])
  ]);
  const zoneDates = fenetre.querySelector(".dates-phases-formulaire");
  let signatureDates = "";
  const majDates = qualifs => {
    zoneDates.querySelectorAll("[data-date]").forEach(champDate => datesSaisies.set(champDate.dataset.date, champDate.value));
    const lignes = [];
    if (qualifs && champ("qualifs_format").value === "poules") {
      const nombre = Math.min(64, Number(champ("poules_nombre").value) || 0);
      for (let numero = 0; numero < nombre; numero++) lignes.push([`poule:${numero}`, nomPouleTournoi(numero)]);
    } else if (qualifs) {
      lignes.push(["qualifs", "Qualifications"]);
    }
    for (let places = Number(champ("arbre_max").value); places >= 2; places /= 2) lignes.push([`tour:${places}`, TAILLES_ARBRE_TOURNOI[places]]);
    const signature = lignes.map(([cle]) => cle).join(",");
    if (signature === signatureDates) return;
    signatureDates = signature;
    zoneDates.innerHTML = lignes.map(([cle, libelle]) =>
      `<label>${libelle} <input type="datetime-local" data-date="${cle}" value="${echapperTournoi(datesSaisies.get(cle) || "")}"></label>`).join("");
  };
  const lireDatesPhases = () => {
    zoneDates.querySelectorAll("[data-date]").forEach(champDate => datesSaisies.set(champDate.dataset.date, champDate.value));
    const visibles = new Set([...zoneDates.querySelectorAll("[data-date]")].map(champDate => champDate.dataset.date));
    const valeur = cle => (visibles.has(cle) ? depuisChampDateTournoi(datesSaisies.get(cle)) : null);
    const poules = [...visibles].filter(cle => cle.startsWith("poule:")).map(valeur);
    return {
      qualifs: valeur("qualifs"),
      poules,
      tours: Object.fromEntries([...visibles].filter(cle => cle.startsWith("tour:")).map(cle => [cle.slice(5), valeur(cle)]).filter(([, v]) => v))
    };
  };
  const majVisibles = () => {
    // Phases finales plus grandes que le tournoi : grisées.
    const max = Number(champ("max_participants").value) || 2;
    const selectArbre = champ("arbre_max");
    [...selectArbre.options].forEach(option => { option.disabled = Number(option.value) > puissance2(max); });
    if (selectArbre.selectedOptions[0]?.disabled) {
      selectArbre.value = [...selectArbre.options].filter(o => !o.disabled).at(-1).value;
    }
    const qualifs = max > Number(selectArbre.value);
    fenetre.querySelector("[data-qualifs]").hidden = !qualifs;
    if (qualifs && champ("qualifs_format").value === "poules" && !champ("poules_nombre").value) proposerPoules();
    fenetre.querySelectorAll("[data-qualifs-format]").forEach(el => { el.hidden = el.dataset.qualifsFormat !== champ("qualifs_format").value; });
    majDates(qualifs);
    const etat = coherence();
    const zone = fenetre.querySelector(".coherence-tournoi");
    zone.textContent = etat.erreur || etat.info;
    zone.className = `large coherence-tournoi ${etat.erreur ? "erreur" : "ok"}`;
    fenetre.querySelector('button[type="submit"]').disabled = !!etat.erreur && !verrouille;
    const format = champ("format").value;
    fenetre.querySelectorAll("[data-pour]").forEach(el => { el.hidden = el.dataset.pour !== format; });
    fenetre.querySelectorAll("[data-chronos]").forEach(el => { el.hidden = !champ("chronos_actifs").checked; });
    fenetre.querySelector(".compteur-description").textContent = champ("description").value.length;
  };
  // Image choisie : envoyée après l'enregistrement du tournoi (undefined :
  // inchangée ; { site } / { upload } / { aucune: true }, cf. changerImage).
  let imageChoisie;
  const apercu = fenetre.querySelector(".apercu-image-tournoi");
  const fichier = fenetre.querySelector("[data-image-fichier]");
  const choisirImage = (corps, url) => {
    imageChoisie = corps;
    apercu.setAttribute("style", styleImageTournoi(null, url));
  };
  fenetre.querySelector('[data-action="image-site"]').addEventListener("click", async () => {
    const chemin = await choisirImageSiteTournoi();
    if (chemin) choisirImage({ site: chemin }, `/DB/images/${chemin}`);
  });
  fenetre.querySelector('[data-action="image-importer"]').addEventListener("click", () => fichier.click());
  fenetre.querySelector('[data-action="image-defaut"]').addEventListener("click", () => choisirImage({ aucune: true }, IMAGE_TOURNOI_DEFAUT));
  fichier.addEventListener("change", async () => {
    const message = fenetre.querySelector(".message-tournoi");
    if (!fichier.files[0]) return;
    try {
      const url = await preparerImageTournoi(fichier.files[0]);
      choisirImage({ upload: url }, url);
      message.textContent = "";
    } catch (erreur) {
      message.className = "message-tournoi erreur";
      message.textContent = erreur.message;
    }
    fichier.value = "";
  });
  formulaire.addEventListener("input", majVisibles);
  formulaire.addEventListener("change", majVisibles);
  majVisibles();

  fenetre.querySelector('[data-action="annuler"]').addEventListener("click", () => fenetre.close());
  fenetre.addEventListener("close", () => fenetre.remove());
  // Tournoi enregistré mais image refusée : un nouvel essai ne renvoie que
  // l'image.
  let enregistre = false;
  formulaire.addEventListener("input", () => { enregistre = false; });
  formulaire.addEventListener("submit", async event => {
    event.preventDefault();
    const message = fenetre.querySelector(".message-tournoi");
    const configEnvoyee = {
      nom: champ("nom").value,
      description: champ("description").value,
      format: champ("format").value,
      taille_equipe: Number(champ("taille_equipe").value),
      mode: champ("mode").value,
      box: champ("box").value,
      affrontement: champ("affrontement").value,
      finale_affrontement: champ("finale_affrontement").value,
      arbre_parallele: champ("arbre_parallele").checked,
      max_participants: Number(champ("max_participants").value),
      arbre_max: Number(champ("arbre_max").value),
      qualif_matchs: Number(champ("qualif_matchs").value),
      qualifs_format: champ("qualifs_format").value,
      poules: champ("qualifs_format").value === "poules" ? lirePoules() : null,
      poules_affrontement: champ("poules_affrontement").value,
      dates_phases: lireDatesPhases(),
      verrouillage: depuisChampDateTournoi(champ("verrouillage").value),
      debut: depuisChampDateTournoi(champ("debut").value),
      fin: depuisChampDateTournoi(champ("fin").value),
      chronos: champ("chronos_actifs").checked ? {
        analyse_s: Number(champ("analyse_s").value),
        action_s: Number(champ("action_s").value),
        ban_s: Number(champ("ban_s").value)
      } : null,
      recompense: { type: champ("recompense_type").value, texte: champ("recompense_texte").value }
    };
    message.className = "message-tournoi";
    message.textContent = "Enregistrement…";
    try {
      if (!enregistre) {
        const donnees = await appelTournoi(id ? "modifier" : "creer", { id, corps: { config: configEnvoyee } });
        // Créé : un nouvel essai (image refusée) le modifie au lieu d'en recréer un.
        id ||= donnees.id;
        enregistre = true;
      }
      if (imageChoisie) {
        message.textContent = "Envoi de l'image…";
        await appelTournoi("image", { id, corps: imageChoisie });
      }
      fenetre.close();
      surSucces?.(id);
    } catch (erreur) {
      message.className = "message-tournoi erreur";
      message.textContent = erreur.message;
    }
  });
  document.body.appendChild(fenetre);
  fenetre.showModal();
}
