// Random world boss : lobby (2 à 4 joueurs), boss et 4 persos tirés au
// hasard, déclaration des persos joués par chacun et du résultat (chef).
// Règles et état côté serveur : api/_lib/world_boss.js (routes
// /api/rooms/{room_id}/wb_*). La page relit l'état toutes les POLL_MS et le
// redessine s'il a changé.

const POLL_MS = 2500;
const TAILLE_MIN = 2;
const TAILLE_MAX = 4;

let roomId = null;
let moi = null; // { id, ... } (api/auth/me)
let draft = null;
let personnagesDraftParId = new Map(); // ids de la draft (Voyageur regroupé)
let bossParId = new Map();
let derniereCle = "";
let envoiEnCours = false;
// Persos cochés par le joueur connecté (pas encore envoyés), ou null :
// sa déclaration enregistrée.
let selectionPersos = null;

// ---- Utilitaires ----

const $ = id => document.getElementById(id);
const nomJoueur = id => draft?.infos?.[id]?.nom || "Joueur";
const suisMembre = () => !!moi && !!draft?.membres?.includes(moi.id);
const suisJoueur = () => !!moi && !!draft?.joueurs?.includes(moi.id);
const suisChef = () => !!moi && draft?.createur === moi.id;

async function appel(action, corps = null) {
  const reponse = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/${action}`, corps === null
    ? { credentials: "include" }
    : { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(data.error || "Erreur");
  return data;
}

// Action d'un bouton : état redessiné avec la réponse, erreur affichée.
async function agir(action, corps = {}) {
  if (envoiEnCours) return false;
  envoiEnCours = true;
  try {
    const data = await appel(action, corps);
    if (data.draft) definirDraft(data.draft);
    return true;
  } catch (erreur) {
    alert(erreur.message);
    return false;
  } finally {
    envoiEnCours = false;
  }
}

function htmlNom(id) {
  const infos = draft.infos?.[id] || {};
  return `${infos.avatar ? `<img class="avatar-mini" src="${echapperHtml(infos.avatar)}" alt="">` : ""}<span class="pseudo">${echapperHtml(infos.nom || "Joueur")}</span>`;
}

function badgesJoueur(id) {
  return [
    id === draft.createur ? `<span class="badge-equipe chef" title="Chef de la room : lance la partie et déclare le résultat">★ Chef</span>` : "",
    id === moi?.id ? `<span class="badge-equipe moi">toi</span>` : ""
  ].join("");
}

// Nom d'un perso tiré (Voyageur / Manekin : avec son élément ; le Voyageur
// regroupé garde le nom de son 1er élément, retiré d'abord).
function nomPerso(perso) {
  const nom = personnagesDraftParId.get(perso.perso_id)?.nom || perso.perso_id;
  if (!perso.element) return nom;
  const sansElement = nom.replace(new RegExp(` (${Object.values(NOMS_ELEMENTS).join("|")})$`), "");
  return `${sansElement} ${NOMS_ELEMENTS[perso.element] || ""}`;
}

// Persos que ce joueur peut déclarer en plus (cf. maxPersosJoueur côté
// serveur) : à 2, 2 ; à 4, 1 ; à 3, 2 si personne d'autre n'en a déclaré 2.
function maxPersosJoueur(id) {
  const taille = draft.joueurs.length;
  if (taille === 2) return 2;
  if (taille === 4) return 1;
  return draft.joueurs.some(autre => autre !== id && (draft.joues?.[autre] || []).length >= 2) ? 1 : 2;
}

// Joueur qui a déclaré ce perso, ou null.
function joueurDuPerso(persoId) {
  return (draft.joueurs || []).find(id => (draft.joues?.[id] || []).includes(persoId)) || null;
}

// ---- Rendu général ----

function definirDraft(nouveau) {
  const anciennePartie = draft && `${draft.phase}|${draft.boss_id}`;
  draft = nouveau;
  // Nouvelle partie : sélection repartie de la déclaration enregistrée.
  if (anciennePartie !== `${draft.phase}|${draft.boss_id}`) selectionPersos = null;
  const cle = JSON.stringify(draft);
  if (cle === derniereCle) return;
  derniereCle = cle;
  rendre();
}

function afficherPhase(id) {
  document.querySelectorAll(".phase-equipe").forEach(section => section.classList.toggle("cache", section.id !== id));
}

function rendre() {
  $("chargement").classList.add("cache");
  appliquerFond();
  switch (draft.phase) {
    case "lobby": afficherPhase("phase-lobby"); rendreLobby(); break;
    case "annule": afficherPhase("phase-annule"); rendreAnnule(); break;
    default: afficherPhase("phase-jeu"); rendreJeu();
  }
  rendreBulles();
}

// ---- Lobby ----

function rendreLobby() {
  const membres = draft.membres || [];
  const complet = membres.length >= TAILLE_MAX;
  const places = Array.from({ length: TAILLE_MAX - membres.length }, () => `<li class="place-libre">Place libre</li>`).join("");
  $("lobby-joueurs").innerHTML = `
    <div class="carte-equipe tous">
      <h2>Joueurs <span class="compte-equipe">${membres.length} / ${TAILLE_MAX}</span></h2>
      <ul>${membres.map(id => `<li>${htmlNom(id)}${badgesJoueur(id)}</li>`).join("")}${places}</ul>
      <p class="aide-equipe">Les persos seront tirés dans vos full box au lancement.</p>
    </div>`;

  $("btn-rejoindre").classList.toggle("cache", suisMembre() || complet || !moi);
  $("btn-quitter").classList.toggle("cache", !suisMembre() || suisChef());
  $("btn-lancer").classList.toggle("cache", !suisChef());
  $("btn-lancer").disabled = membres.length < TAILLE_MIN;
  $("aide-lobby").textContent = suisChef()
    ? (membres.length < TAILLE_MIN ? `Partage le lien : il faut au moins ${TAILLE_MIN} joueurs.` : "Lance la partie quand tout le monde est là.")
    : suisMembre() ? "Le chef lance la partie quand tout le monde est là."
      : complet ? `La room est complète (${TAILLE_MAX} joueurs).` : "Rejoins la room pour jouer.";
}

// ---- Partie ----

function rendreJeu() {
  rendreBoss();
  rendreResultat();
  rendrePersos();
  rendreZoneResultat();
  rendreEtatJoueurs();
}

function rendreResultat() {
  const zone = $("resultat-wb");
  const fini = draft.phase === "termine";
  zone.classList.toggle("cache", !fini);
  if (!fini) return;
  zone.classList.toggle("reussite", draft.reussite);
  zone.classList.toggle("echec", !draft.reussite);
  zone.innerHTML = `<p class="ligne-vainqueur"><span class="${draft.reussite ? "vainqueur" : "perdant"}">${draft.reussite ? "Défi réussi !" : "Échec"}</span></p>
    <p class="aide-equipe">Partie enregistrée dans l'historique (onglet Random world boss).</p>`;
}

// Cartes des 4 persos : qui les a dans sa full box (constellation), qui
// les a joués ; le joueur connecté coche les siens pendant la partie.
function rendrePersos() {
  const enJeu = draft.phase === "jeu" && suisJoueur();
  const mienne = draft.joues?.[moi?.id] || [];
  if (selectionPersos === null) selectionPersos = new Set(mienne);
  const max = enJeu ? maxPersosJoueur(moi.id) : 0;

  $("aide-persos").textContent = draft.phase !== "jeu" ? ""
    : !suisJoueur() ? "Les joueurs déclarent les persos qu'ils ont joués."
      : `Répartissez-vous les persos. Après le combat, coche ${max > 1 ? `les ${max} persos` : "le perso"} que tu as joué${max > 1 ? "s" : ""} puis valide.` +
        (draft.joueurs.length === 3 ? " À 3, un seul joueur joue 2 persos." : "");

  $("persos-tires").innerHTML = (draft.persos || []).map(perso => {
    const personnage = personnagesDraftParId.get(perso.perso_id);
    const versions = draft.versions?.[perso.perso_id] || {};
    const joueur = joueurDuPerso(perso.perso_id);
    const proprietaires = draft.joueurs.filter(id => versions[id]).map(id =>
      `<li class="${joueur === id ? "joue" : ""}">${echapperHtml(nomJoueur(id))} · C${versions[id].constellation}${versions[id].niveau ? ` · niv. ${versions[id].niveau}` : ""}${joueur === id ? " ✓" : ""}</li>`).join("");
    const possede = enJeu && !!versions[moi.id];
    const prisParAutre = joueur && joueur !== moi?.id;
    const coche = selectionPersos.has(perso.perso_id);
    return `
      <div class="carte-perso-wb${joueur ? " declare" : ""}${coche && enJeu ? " coche" : ""}">
        <img class="${classeFondRarete(personnage?.rarete)}" src="../DB/${personnage?.image || ""}" alt="">
        <span class="nom-perso-wb">${echapperHtml(nomPerso(perso))}</span>
        ${joueur ? `<span class="joue-par">Joué par ${echapperHtml(nomJoueur(joueur))}</span>` : ""}
        <ul class="proprietaires-wb" title="Full box qui ont ce perso">${proprietaires}</ul>
        ${possede ? `<button type="button" class="btn-equipe petit${coche ? " actif" : ""}" data-perso="${echapperHtml(perso.perso_id)}"${prisParAutre ? " disabled" : ""}>${coche ? "Je l'ai joué ✓" : "Je l'ai joué"}</button>` : ""}
      </div>`;
  }).join("");

  $("persos-tires").querySelectorAll("[data-perso]").forEach(bouton => {
    bouton.addEventListener("click", () => {
      const id = bouton.dataset.perso;
      if (selectionPersos.has(id)) selectionPersos.delete(id);
      else selectionPersos.add(id);
      derniereCle = "";
      rendre();
    });
  });

  const modifiee = enJeu && (selectionPersos.size !== mienne.length || mienne.some(id => !selectionPersos.has(id)));
  $("actions-declaration").classList.toggle("cache", !enJeu);
  $("btn-declarer").disabled = !modifiee || selectionPersos.size === 0;
  $("btn-declarer").textContent = mienne.length ? "Modifier mes persos" : "Valider mes persos";
}

// Réussite / échec : déclarés par le chef.
function rendreZoneResultat() {
  const zone = $("zone-resultat");
  const visible = draft.phase === "jeu";
  zone.classList.toggle("cache", !visible);
  if (!visible) return;
  const chef = suisChef();
  $("aide-resultat").textContent = chef
    ? (typeof draft.reussite === "boolean" ? `Déclaré : ${draft.reussite ? "réussite" : "échec"} (modifiable tant que tous les persos ne sont pas déclarés).` : "Après le combat, déclare si le défi est réussi.")
    : typeof draft.reussite === "boolean" ? `Le chef a déclaré : ${draft.reussite ? "réussite" : "échec"}.` : `${nomJoueur(draft.createur)} (chef) déclare le résultat.`;
  ["btn-reussite", "btn-echec"].forEach(id => $(id).classList.toggle("cache", !chef));
  $("btn-reussite").classList.toggle("actif", draft.reussite === true);
  $("btn-echec").classList.toggle("actif", draft.reussite === false);
}

// Où en sont les déclarations de chacun.
function rendreEtatJoueurs() {
  const zone = $("etat-joueurs");
  zone.classList.toggle("cache", draft.phase !== "jeu");
  if (draft.phase !== "jeu") return;
  zone.innerHTML = `
    <h3>Déclarations</h3>
    <ul class="membres-equipe etat-declarations">${draft.joueurs.map(id => {
      const persos = (draft.joues?.[id] || []).map(persoId => draft.persos.find(p => p.perso_id === persoId)).filter(Boolean);
      return `<li>${htmlNom(id)}${badgesJoueur(id)}<span class="aide-equipe">${persos.length ? persos.map(nomPerso).map(echapperHtml).join(", ") : "en attente…"}</span></li>`;
    }).join("")}</ul>`;
}

function rendreAnnule() {
  $("texte-annule").textContent = draft.annule_par
    ? `${nomJoueur(draft.annule_par)} a quitté la partie (autre match démarré) : elle est annulée.`
    : "La partie est annulée.";
}

// ---- Boss, fond d'écran, localisation des légendes ----

const ELEMENTS_RES_BOSS = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];
const FOND_DEFAUT = "/DB/images/bg_web/autres/default_bg.webp";
let fondsBoss = [];
let fondApplique = null;
let bossAffiche = null;

// Image cliquable (résistances), nom, et localisation d'une légende locale.
function rendreBoss() {
  const boss = bossParId.get(draft.boss_id);
  if (!boss || bossAffiche === boss.id) return;
  bossAffiche = boss.id;
  const res = ELEMENTS_RES_BOSS.map((element, i) => {
    const valeur = Number(boss.res?.[i] ?? 0);
    const nom = element.charAt(0).toUpperCase() + element.slice(1);
    return `<span class="res-boss${estImmunise(valeur) ? " immunise" : ""}" title="${estImmunise(valeur) ? `Immunisé ${nom}` : `Résistance ${nom}`}"><img src="${ICONES_ELEMENTS_TRI[element]}" alt="${nom}">${texteResistance(valeur, "")}</span>`;
  }).join("");
  $("boss-wb").innerHTML = `
    <button type="button" class="image-boss-res" title="Voir les résistances">
      ${htmlImagesBoss(boss)}
      <span class="resistances-boss">${res}</span>
    </button>
    <span class="indice-res-boss">Voir les Res</span>
    <span class="nom-boss">${echapperHtml(boss.nom)}</span>
    ${estLegendeLocale(boss) ? `<button type="button" class="btn-carte-legende" title="Où trouver cette légende locale"><img src="../DB/images/others/Icon_Map.webp" alt="">Localisation</button>` : ""}`;
}

function initialiserBoss() {
  $("boss-wb").addEventListener("click", event => {
    if (event.target.closest(".image-boss-res, .indice-res-boss")) {
      $("boss-wb").querySelector(".image-boss-res")?.classList.toggle("res-visibles");
    }
    if (event.target.closest(".btn-carte-legende")) ouvrirCarteLegende(bossParId.get(draft.boss_id));
  });
  const fenetre = $("carte-legende");
  fenetre.addEventListener("click", event => {
    if (event.target === fenetre || event.target.closest(".fermer-carte-legende")) fenetre.classList.add("cache");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") fenetre.classList.add("cache");
  });
}

// Carte : DB/images/boss/legend_local/carte/<id du boss>.webp.
function ouvrirCarteLegende(boss) {
  if (!boss) return;
  const fenetre = $("carte-legende");
  fenetre.querySelector(".titre-carte-legende").textContent = boss.nom;
  const image = fenetre.querySelector("img");
  const absente = fenetre.querySelector(".carte-absente");
  image.classList.remove("cache");
  absente.classList.add("cache");
  image.onerror = () => {
    image.classList.add("cache");
    absente.classList.remove("cache");
  };
  image.src = `../DB/images/boss/legend_local/carte/${boss.id}.webp`;
  image.alt = `Localisation de ${boss.nom}`;
  fenetre.classList.remove("cache");
}

// Fonds des boss (cosmetiques.json), comme le mode en équipe ; world boss :
// fond par défaut.
async function chargerFondsBoss() {
  try {
    const cosmetiques = await (await fetch("/DB/images/cosmetiques.json")).json();
    fondsBoss = cosmetiques.fonds.filter(fond => ["boss_hebdo", "legendes_locales", "carnage_chtonien"].includes(fond.categorie));
  } catch (erreur) {
    console.error(erreur);
    fondsBoss = [];
  }
}

function hashTexte(texte) {
  let h = 0;
  for (const caractere of texte) h = (h * 31 + caractere.charCodeAt(0)) >>> 0;
  return h;
}

// Fond du boss tiré (même choix pour tous les joueurs de la room).
function appliquerFond() {
  let url = FOND_DEFAUT;
  if (draft?.boss_id && draft.phase !== "lobby") {
    const prefixe = draft.boss_id.replace(/_boss$/, "");
    const nomFond = fond => fond.image.split("/").pop().replace(/\.webp$/, "");
    const supplementaires = bossParId.get(draft.boss_id)?.fonds_supplementaires || [];
    const images = fondsBoss.filter(fond => nomFond(fond) === prefixe || nomFond(fond).replace(/_\d+$/, "") === prefixe ||
      supplementaires.includes(nomFond(fond)));
    if (images.length) url = encodeURI(`/DB/images/${images[hashTexte(`${roomId}:${draft.boss_id}`) % images.length].image}`);
  }
  if (url !== fondApplique) {
    fondApplique = url;
    document.body.style.setProperty("--fond-ecran", `url("${url}")`);
  }
}

// ---- Bulles du bas ----

function rendreBulles() {
  const message = $("message-wb");
  message.textContent = "";
  if (draft.phase !== "lobby" && !suisJoueur()) message.textContent = "👁 Tu regardes cette partie en spectateur.";
  else if (draft.phase === "jeu") message.textContent = "Après le combat : chacun déclare ses persos, le chef déclare le résultat.";
  else if (draft.phase === "termine") message.textContent = suisChef() ? "Lance une nouvelle partie avec les mêmes joueurs." : "Le chef peut lancer une nouvelle partie.";

  // Chef : nouvelle partie (retour au lobby), aussi pendant une partie
  // (tirage abandonné, pas enregistré).
  const visible = suisChef() && draft.phase !== "lobby";
  $("actions-fin").classList.toggle("cache", !visible);
  $("btn-rejouer").textContent = draft.phase === "jeu" ? "Abandonner ce tirage" : "Nouvelle partie";
}

// ---- Démarrage ----

function initialiserBoutons() {
  $("btn-rejoindre").addEventListener("click", () => agir("wb_rejoindre", {}));
  $("btn-quitter").addEventListener("click", async () => {
    if (!confirm("Quitter la room ?")) return;
    try {
      await appel("wb_quitter", {});
      window.location.href = "matchmaking.html";
    } catch (erreur) {
      alert(erreur.message);
    }
  });
  $("btn-lancer").addEventListener("click", () => agir("wb_lancer", {}));
  $("btn-declarer").addEventListener("click", async () => {
    if (await agir("wb_declarer", { persos: [...selectionPersos] })) selectionPersos = null;
    derniereCle = "";
    rendre();
  });
  $("btn-reussite").addEventListener("click", () => agir("wb_resultat", { reussite: true }));
  $("btn-echec").addEventListener("click", () => agir("wb_resultat", { reussite: false }));
  $("btn-rejouer").addEventListener("click", () => {
    const texte = draft.phase === "jeu"
      ? "Abandonner ce tirage et retourner au lobby ? La partie ne sera pas enregistrée."
      : "Retourner au lobby pour une nouvelle partie avec les mêmes joueurs ?";
    if (confirm(texte)) agir("wb_rejouer", {});
  });

  const partager = $("btn-partager");
  const texte = partager.textContent;
  partager.addEventListener("click", async () => {
    const lien = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(lien);
      partager.textContent = "Lien copié ✓";
    } catch {
      window.prompt("Copie ce lien et envoie-le aux autres joueurs :", lien);
    }
    setTimeout(() => { partager.textContent = texte; }, 2000);
  });
}

async function rafraichir() {
  try {
    const data = await appel("wb_etat");
    definirDraft(data.draft);
  } catch (erreur) {
    console.error(erreur);
    if (!draft) $("chargement").textContent = erreur.message;
  }
}

async function demarrer() {
  roomId = new URLSearchParams(window.location.search).get("room");
  if (!roomId) {
    $("chargement").textContent = "Aucune room dans le lien.";
    return;
  }
  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });
    moi = reponse.ok ? (await reponse.json()).user : null;
  } catch {
    moi = null;
  }
  if (!moi) {
    $("chargement").textContent = "Connecte-toi avec Discord pour rejoindre cette partie.";
    return;
  }

  const [personnages, boss] = await Promise.all([chargerPersonnages(), chargerBoss(), chargerFondsBoss()]);
  personnagesDraftParId = new Map(regrouperPourDraft(personnages).map(p => [p.id, p]));
  bossParId = new Map(boss.map(b => [b.id, b]));

  initialiserBoutons();
  initialiserBoss();

  // Arrivée par le lien : on rejoint la room s'il reste de la place.
  await rafraichir();
  if (draft?.phase === "lobby" && !suisMembre() && (draft.membres || []).length < TAILLE_MAX) {
    try {
      const data = await appel("wb_rejoindre", {});
      definirDraft(data.draft);
    } catch (erreur) {
      alert(erreur.message);
    }
  }

  let intervalle = setInterval(rafraichir, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    clearInterval(intervalle);
    if (!document.hidden) {
      rafraichir();
      intervalle = setInterval(rafraichir, POLL_MS);
    }
  });
}

demarrer();
