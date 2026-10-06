// Match en équipe (2v2, 3v3, 4v4) : lobby, vote des chefs, hôtes (3v3),
// draft sur les vitrines, déclaration de qui joue quoi, temps et résultat.
// Règles et état côté serveur : api/_lib/equipe.js (routes
// /api/rooms/{room_id}/equipe_*). La page relit l'état toutes les
// POLL_MS et le redessine s'il a changé.

const POLL_MS = 2500;
const ROLES = ["j1", "j2"];
const NOMS_EQUIPES = { j1: "Équipe 1", j2: "Équipe 2" };
const MODES = { 2: "2v2", 3: "3v3", 4: "4v4" };

let roomId = null;
let moi = null; // { id, ... } (api/auth/me)
let draft = null;
let decalageServeur = 0; // heure du serveur - heure de l'appareil (ms)
let personnagesParId = new Map(); // ids des comptes (Voyageur par élément)
let personnagesDraftParId = new Map(); // ids de la draft (Voyageur regroupé)
let bossParId = new Map();
let selection = null; // { perso_id, element } choisi dans les vitrines
let derniereCle = "";
let envoiEnCours = false;
// Déclaration en cours de saisie par le chef : { perso_id: discord_id }.
let declarationSaisie = {};

// ---- Utilitaires ----

const $ = id => document.getElementById(id);
const heureServeur = () => Date.now() + decalageServeur;
const nomJoueur = id => draft?.infos?.[id]?.nom || "Joueur";

function campDe(id) {
  return ROLES.find(role => draft.equipes?.[role]?.includes(id)) || null;
}

const monCamp = () => (moi && draft ? campDe(moi.id) : null);
const suisChef = () => !!monCamp() && draft.chefs?.[monCamp()] === moi.id;
const suisMembre = () => !!moi && !!draft?.membres?.includes(moi.id);

async function appel(action, corps = null) {
  const reponse = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/${action}`, corps === null
    ? { credentials: "include" }
    : { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(data.error || "Erreur");
  if (Number.isFinite(data.maintenant)) decalageServeur = data.maintenant - Date.now();
  return data;
}

// Action d'un bouton : état redessiné avec la réponse, erreur affichée.
async function agir(action, corps = {}) {
  if (envoiEnCours) return;
  envoiEnCours = true;
  try {
    const data = await appel(action, corps);
    if (data.draft) definirDraft(data.draft);
  } catch (erreur) {
    alert(erreur.message);
  } finally {
    envoiEnCours = false;
  }
}

// Pseudo seul (messages : bulles du bas, hôtes des mondes).
function htmlPseudoJoueur(id) {
  return `<span class="pseudo">${echapperHtml(nomJoueur(id))}</span>`;
}

function htmlNom(id) {
  const infos = draft.infos?.[id] || {};
  return `${infos.avatar ? `<img class="avatar-mini" src="${echapperHtml(infos.avatar)}" alt="">` : ""}<span class="pseudo">${echapperHtml(infos.nom || "Joueur")}</span>`;
}

function badgesJoueur(id, role) {
  return [
    draft.chefs?.[role] === id ? `<span class="badge-equipe chef" title="Chef de l'équipe">★ Chef</span>` : "",
    draft.hotes?.[role] === id ? `<span class="badge-equipe hote" title="Hôte du monde">🏠 Hôte</span>` : "",
    id === moi?.id ? `<span class="badge-equipe moi">toi</span>` : ""
  ].join("");
}

function secondesRestantes(fin) {
  return Math.max(0, Math.ceil((fin - heureServeur()) / 1000));
}

// ---- Rendu général ----

function definirDraft(nouveau) {
  draft = nouveau;
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
  const mode = MODES[draft.taille] || "";
  $("titre-equipe").textContent = `Match ${mode}`;
  const boss = draft.boss_impose && bossParId.get(draft.boss_impose);
  $("sous-titre-equipe").textContent = [
    draft.formation === "choix" ? "Équipes au choix" : "Équipes aléatoires (équilibrées)",
    "Théâtre 12",
    boss ? `Boss : ${boss.nom}` : null
  ].filter(Boolean).join(" · ");

  appliquerFond();
  rendreFinDeMatch();
  rendreInfoHotes();

  switch (draft.phase) {
    case "lobby": afficherPhase("phase-lobby"); rendreLobby(); break;
    case "chefs": afficherPhase("phase-chefs"); rendreChefs(); break;
    case "hotes": afficherPhase("phase-hotes"); rendreHotes(); break;
    case "annule": afficherPhase("phase-annule"); rendreAnnule(); break;
    default: afficherPhase("phase-match"); rendreMatch();
  }
  rendreBulles();
}

// Hôtes des mondes : inutile si tout le monde a le même niveau du monde.
function rendreInfoHotes() {
  const info = $("info-hotes");
  const niveaux = new Set((draft.membres || []).map(id => draft.infos?.[id]?.niveau_monde || ""));
  const memeNiveau = niveaux.size === 1 && !niveaux.has("");
  const visible = !!draft.hotes?.j1 && !memeNiveau && !["lobby", "chefs", "hotes"].includes(draft.phase);
  info.classList.toggle("cache", !visible);
  if (!visible) return;
  info.innerHTML = `Hôtes des mondes : ${htmlPseudoJoueur(draft.hotes.j1)} (${NOMS_EQUIPES.j1}) et ${htmlPseudoJoueur(draft.hotes.j2)} (${NOMS_EQUIPES.j2})` +
    (draft.legendes ? "" : " · pas de légende locale (niveaux du monde différents)");
}

// ---- Lobby ----

function rendreLobby() {
  const membres = draft.membres || [];
  const complet = membres.length >= draft.taille * 2;
  const zone = $("lobby-equipes");

  if (draft.formation === "choix") {
    const sansEquipe = membres.filter(id => !draft.camps?.[id]);
    zone.innerHTML = ROLES.map(role => {
      const joueurs = membres.filter(id => draft.camps?.[id] === role);
      const places = Array.from({ length: draft.taille - joueurs.length }, () => `<li class="place-libre">Place libre</li>`).join("");
      const peutRejoindre = suisMembre() && draft.camps?.[moi.id] !== role && joueurs.length < draft.taille;
      return `
        <div class="carte-equipe camp-${role}">
          <h2>${NOMS_EQUIPES[role]} <span class="compte-equipe">${joueurs.length} / ${draft.taille}</span></h2>
          <ul>${joueurs.map(id => `<li>${htmlNom(id)}${badgesJoueur(id, role)}</li>`).join("")}${places}</ul>
          ${peutRejoindre ? `<button type="button" class="btn-equipe" data-camp="${role}">Rejoindre ${NOMS_EQUIPES[role]}</button>` : ""}
          ${suisMembre() && draft.camps?.[moi.id] === role ? `<button type="button" class="btn-equipe secondaire" data-camp="">Sortir de l'équipe</button>` : ""}
        </div>`;
    }).join("") + (sansEquipe.length ? `
      <div class="carte-equipe sans-equipe">
        <h2>Sans équipe</h2>
        <ul>${sansEquipe.map(id => `<li>${htmlNom(id)}${id === moi?.id ? `<span class="badge-equipe moi">toi</span>` : ""}</li>`).join("")}</ul>
      </div>` : "");
  } else {
    const places = Array.from({ length: draft.taille * 2 - membres.length }, () => `<li class="place-libre">Place libre</li>`).join("");
    zone.innerHTML = `
      <div class="carte-equipe tous">
        <h2>Joueurs <span class="compte-equipe">${membres.length} / ${draft.taille * 2}</span></h2>
        <ul>${membres.map(id => `<li>${htmlNom(id)}${id === draft.createur ? `<span class="badge-equipe">créateur</span>` : ""}${id === moi?.id ? `<span class="badge-equipe moi">toi</span>` : ""}</li>`).join("")}${places}</ul>
        <p class="aide-equipe">Les équipes seront tirées au lancement, équilibrées sur la somme des full box.</p>
      </div>`;
  }
  zone.querySelectorAll("[data-camp]").forEach(bouton => {
    bouton.addEventListener("click", () => agir("equipe_camp", { camp: bouton.dataset.camp || null }));
  });

  const createur = draft.createur === moi?.id;
  $("btn-rejoindre").classList.toggle("cache", suisMembre() || complet || !moi);
  $("btn-quitter").classList.toggle("cache", !suisMembre() || createur);
  $("btn-lancer").classList.toggle("cache", !createur);
  const equipesCompletes = draft.formation !== "choix" ||
    ROLES.every(role => membres.filter(id => draft.camps?.[id] === role).length === draft.taille);
  $("btn-lancer").disabled = !(complet && equipesCompletes);
  $("aide-lobby").textContent = createur
    ? (!complet ? `Partage le lien : il faut ${draft.taille * 2} joueurs.` : !equipesCompletes ? "Les 2 équipes doivent être complètes." : "Tout le monde est là : lance le match quand vous êtes prêts.")
    : suisMembre() ? "Le créateur de la room lance le match quand tout le monde est prêt."
      : complet ? "Le lobby est complet : tu regardes en spectateur." : "Rejoins le lobby pour jouer (vitrine conforme obligatoire).";
}

// ---- Vote des chefs ----

function rendreChefs() {
  const monVote = draft.votes?.[moi?.id];
  $("votes-equipes").innerHTML = ROLES.map(role => {
    const peutVoter = monCamp() === role;
    return `
      <div class="carte-equipe camp-${role}">
        <h2>${NOMS_EQUIPES[role]}</h2>
        <ul>${draft.equipes[role].map(id => `
          <li>
            ${htmlNom(id)}${id === moi?.id ? `<span class="badge-equipe moi">toi</span>` : ""}
            ${draft.votes?.[id] ? `<span class="badge-equipe vote" title="A voté">✓ a voté</span>` : ""}
            ${peutVoter ? `<button type="button" class="btn-equipe petit${monVote === id ? " actif" : ""}" data-candidat="${echapperHtml(id)}">${monVote === id ? "Ton vote" : "Voter"}</button>` : ""}
          </li>`).join("")}</ul>
      </div>`;
  }).join("");
  $("votes-equipes").querySelectorAll("[data-candidat]").forEach(bouton => {
    bouton.addEventListener("click", () => agir("equipe_vote", { candidat: bouton.dataset.candidat }));
  });
}

// ---- 3v3 : hôtes ----

function rendreHotes() {
  $("hotes-equipes").innerHTML = ROLES.map(role => {
    const choisi = draft.hotes?.[role];
    const eligibles = draft.eligibles_hote?.[role] || [];
    const peutChoisir = suisChef() && monCamp() === role && !choisi;
    return `
      <div class="carte-equipe camp-${role}">
        <h2>${NOMS_EQUIPES[role]}</h2>
        <ul>${draft.equipes[role].map(id => `
          <li class="${eligibles.includes(id) || choisi === id ? "" : "non-eligible"}">
            ${htmlNom(id)}${badgesJoueur(id, role)}
            <span class="full-box" title="Full box">${draft.full_box?.[id] ?? "?"} pts</span>
            ${peutChoisir && eligibles.includes(id) ? `<button type="button" class="btn-equipe petit" data-hote="${echapperHtml(id)}">Hôte</button>` : ""}
          </li>`).join("")}</ul>
        <p class="aide-equipe">${choisi ? `Hôte : ${echapperHtml(nomJoueur(choisi))}` : "Le chef choisit l'hôte…"}</p>
      </div>`;
  }).join("");
  $("hotes-equipes").querySelectorAll("[data-hote]").forEach(bouton => {
    bouton.addEventListener("click", () => agir("equipe_hote", { hote: bouton.dataset.hote }));
  });
}

// ---- Draft et suite ----

const actionCourante = () => (draft.phase === "draft" ? draft.sequence?.[draft.sequence_index] || null : null);
const aMonTour = () => !!actionCourante() && actionCourante().joueur === monCamp() && suisChef();

function picksDe(role) {
  return (draft.actions || []).filter(a => a.type === "pick" && a.joueur === role);
}

function rendreMatch() {
  rendreBoss();
  ROLES.forEach(rendreTableau);
  rendreVitrines();
  rendreDeclaration();
  rendreTemps();
}

// Tableau d'une équipe : joueurs (chef, hôte), picks (et qui les joue une
// fois déclarés), bans.
function rendreTableau(role) {
  const tableau = $(`tableau-${role}`);
  const picks = picksDe(role);
  const declaration = draft[`declaration_${role}`];
  const nbBans = (draft.sequence || []).filter(a => a.type === "ban" && a.joueur === role).length;
  const bans = (draft.actions || []).filter(a => a.type === "ban" && a.joueur === role);
  const gagnant = draft.phase === "termine" && draft.vainqueur === role;

  const casePick = (action, i) => {
    if (!action) return `<div class="slot-pick vide">Pick ${i + 1}</div>`;
    if (!action.perso_id) return `<div class="slot-pick vide" title="Aucun pick possible pour l'équipe">Aucun pick possible</div>`;
    const perso = personnagesDraftParId.get(action.perso_id);
    const nom = action.element ? `${perso?.nom || action.perso_id} ${NOMS_ELEMENTS[action.element] || ""}` : perso?.nom || action.perso_id;
    const joueur = declaration && typeof declaration === "object" ? declaration[action.perso_id] : null;
    const version = joueur ? (draft.vitrines?.[joueur]?.persos || []).find(p => p.draft_id === action.perso_id && (!p.element || !action.element || p.element === action.element)) : null;
    return `
      <div class="slot-pick">
        <img src="../DB/${perso?.image || ""}" alt="">
        <span class="nom-slot">${echapperHtml(nom)}${joueur ? `<span class="joue-par">${echapperHtml(nomJoueur(joueur))}${version ? ` · C${version.constellation}` : ""}</span>` : ""}</span>
      </div>`;
  };

  tableau.classList.toggle("gagnant", gagnant);
  tableau.innerHTML = `
    <div class="entete-equipe camp-${role}">
      <h3>${NOMS_EQUIPES[role]}${gagnant ? " · Victoire" : draft.phase === "termine" && draft.vainqueur === "egalite" ? " · Égalité" : ""}</h3>
      <ul class="membres-equipe">${draft.equipes[role].map(id => `<li>${htmlNom(id)}${badgesJoueur(id, role)}</li>`).join("")}</ul>
    </div>
    <div class="trait-joueur trait-${role}"></div>
    <h4 class="titre-zone">Picks</h4>
    <div class="slots-pick">${Array.from({ length: 4 }, (_, i) => casePick(picks[i], i)).join("")}</div>
    <h4 class="titre-zone">Bans</h4>
    <div class="slots-ban">${Array.from({ length: nbBans }, (_, i) => {
      const perso = bans[i] && personnagesDraftParId.get(bans[i].perso_id);
      return perso
        ? `<div class="slot-pick slot-ban"><img src="../DB/${perso.image}" alt=""><span class="nom-slot">${echapperHtml(perso.nom)}</span></div>`
        : `<div class="slot-pick slot-ban vide">Ban ${i + 1}</div>`;
    }).join("")}</div>
  `;
}

// État d'un perso de la draft : "banni", "pick-j1" / "pick-j2", ou null.
function etatPerso(draftId) {
  const action = (draft.actions || []).find(a => a.perso_id === draftId);
  if (!action) return null;
  return action.type === "ban" ? "banni" : `pick-${action.joueur}`;
}

// Carte cliquable : à mon tour (chef), ban = tout perso encore disponible,
// pick = seulement ceux des vitrines de mon équipe.
function estCliquable(role, entree) {
  const action = actionCourante();
  if (!aMonTour() || envoiEnCours) return false;
  if (!draft.pool_disponible?.includes(entree.draft_id)) return false;
  return action.type === "ban" || role === monCamp();
}

function rendreVitrines() {
  const enDraft = draft.phase === "draft";
  ROLES.forEach(role => {
    const zone = $(`vitrines-${role}`);
    zone.innerHTML = draft.equipes[role].map(id => {
      const persos = draft.vitrines?.[id]?.persos || [];
      return `
        <div class="vitrine-joueur">
          <h4 class="nom-vitrine camp-${role}">${htmlNom(id)}${badgesJoueur(id, role)}</h4>
          <div class="grille-vitrine">${persos.map((entree, i) => {
            const perso = personnagesParId.get(entree.id);
            const etat = etatPerso(entree.draft_id);
            const choisi = selection && selection.perso_id === entree.draft_id && (!selection.element || !entree.element || selection.element === entree.element);
            const classes = ["character-card", "carte-vitrine",
              etat === "banni" ? "bannie" : "", etat?.startsWith("pick") ? `piquee ${etat}` : "",
              enDraft && estCliquable(role, entree) ? "selectionnable" : "",
              choisi ? "selectionnee" : ""].filter(Boolean).join(" ");
            return `
              <div class="${classes}" data-membre="${echapperHtml(id)}" data-index="${i}" title="${echapperHtml(perso?.nom || entree.id)}">
                <div class="character-visuel ${classeFondRarete(perso?.rarete)}">
                  <img src="../DB/${perso?.image || ""}" alt="${echapperHtml(perso?.nom || entree.id)}" loading="lazy" decoding="async">
                  <span class="character-constellation constellation-${role}">C${entree.constellation}</span>
                  ${entree.niveau ? `<span class="character-niveau niveau-${role}">${entree.niveau}</span>` : ""}
                  ${etat === "banni" ? `<span class="marque-carte">Banni</span>` : etat ? `<span class="marque-carte">Pick ${etat === "pick-j1" ? "É1" : "É2"}</span>` : ""}
                </div>
              </div>`;
          }).join("")}</div>
        </div>`;
    }).join("");
  });
}

// Clic sur une carte de vitrine : sélection (puis Confirmer).
function initialiserVitrines() {
  $("vitrines").addEventListener("click", event => {
    const carte = event.target.closest(".carte-vitrine.selectionnable");
    if (!carte) return;
    const entree = draft.vitrines?.[carte.dataset.membre]?.persos?.[Number(carte.dataset.index)];
    if (!entree) return;
    const action = actionCourante();
    // Manekin au pick : élément libre, choisi dans une fenêtre.
    if (action?.type === "pick" && ELEMENTS_LIBRES[entree.draft_id]) {
      choisirElement(element => {
        selection = { perso_id: entree.draft_id, element };
        rendreVitrines();
        rendreBulles();
      });
      return;
    }
    selection = { perso_id: entree.draft_id, element: action?.type === "pick" ? entree.element : null };
    rendreVitrines();
    rendreBulles();
  });
}

function choisirElement(valider) {
  const fenetre = $("fenetre-element");
  $("choix-elements").innerHTML = Object.entries(NOMS_ELEMENTS)
    .map(([element, nom]) => `<button type="button" class="btn-equipe" data-element="${element}">${nom}</button>`).join("");
  $("choix-elements").querySelectorAll("[data-element]").forEach(bouton => {
    bouton.addEventListener("click", () => {
      fenetre.classList.add("cache");
      valider(bouton.dataset.element);
    });
  });
  fenetre.classList.remove("cache");
}

async function confirmerAction() {
  if (!selection || !aMonTour()) return;
  const corps = { perso_id: selection.perso_id, element: selection.element || null };
  selection = null;
  await agir("equipe_action", corps);
  derniereCle = "";
  rendre();
}

// ---- Déclaration : qui joue quel pick ----

function versionsPossibles(role, pick) {
  return draft.equipes[role]
    .map(id => ({ id, version: (draft.vitrines?.[id]?.persos || []).find(p => p.draft_id === pick.perso_id && (!p.element || !pick.element || p.element === pick.element)) }))
    .filter(v => v.version);
}

function rendreDeclaration() {
  const zone = $("zone-declaration");
  zone.classList.toggle("cache", draft.phase !== "declaration");
  if (draft.phase !== "declaration") {
    declarationSaisie = {};
    return;
  }
  const camp = monCamp();
  const etatAutre = role => draft[`declaration_${role}`] ? "déclarée ✓" : "en attente…";

  if (!suisChef() || draft[`declaration_${camp}`] && typeof draft[`declaration_${camp}`] === "object" && !zone.dataset.modification) {
    zone.innerHTML = `
      <h3>Déclaration des persos</h3>
      <p class="aide-equipe">Chaque chef déclare quel joueur joue quel perso (sa version : constellation…).
        1 C6 et 2 C3+ de 5★ limités au maximum par équipe. Révélée quand les 2 équipes ont déclaré.</p>
      <p>${ROLES.map(role => `${NOMS_EQUIPES[role]} : ${etatAutre(role)}`).join(" · ")}</p>
      ${suisChef() ? `<button type="button" class="btn-equipe secondaire" id="btn-modifier-declaration">Modifier ma déclaration</button>` : ""}`;
    $("btn-modifier-declaration")?.addEventListener("click", () => {
      zone.dataset.modification = "1";
      declarationSaisie = { ...draft[`declaration_${camp}`] };
      rendreDeclaration();
    });
    return;
  }

  const picks = picksDe(camp).filter(a => a.perso_id);
  zone.innerHTML = `
    <h3>Qui joue quoi ?</h3>
    <p class="aide-equipe">${draft.taille === 2 ? "2 persos par joueur." : draft.taille === 4 ? "1 perso par joueur." : `L'hôte (${echapperHtml(nomJoueur(draft.hotes?.[camp]))}) joue 2 persos, les autres 1.`}
      1 C6 et 2 C3+ de 5★ limités au maximum.</p>
    <div class="lignes-declaration">${picks.map(pick => {
      const perso = personnagesDraftParId.get(pick.perso_id);
      const versions = versionsPossibles(camp, pick);
      // Un seul joueur a ce perso : choisi d'office.
      if (!declarationSaisie[pick.perso_id] && versions.length === 1) declarationSaisie[pick.perso_id] = versions[0].id;
      const options = versions.map(({ id, version }) =>
        `<option value="${echapperHtml(id)}"${declarationSaisie[pick.perso_id] === id ? " selected" : ""}>${echapperHtml(nomJoueur(id))} (C${version.constellation}${version.niveau ? `, niv. ${version.niveau}` : ""})</option>`).join("");
      return `
        <label class="ligne-declaration">
          <img src="../DB/${perso?.image || ""}" alt="">
          <span>${echapperHtml(perso?.nom || pick.perso_id)}${pick.element ? ` ${NOMS_ELEMENTS[pick.element] || ""}` : ""}</span>
          <select data-pick="${echapperHtml(pick.perso_id)}"><option value="">Choisir…</option>${options}</select>
        </label>`;
    }).join("")}</div>
    <button type="button" class="btn-equipe principal" id="btn-declarer">Valider la déclaration</button>`;
  zone.querySelectorAll("select[data-pick]").forEach(select => {
    select.addEventListener("change", () => { declarationSaisie[select.dataset.pick] = select.value; });
  });
  $("btn-declarer").addEventListener("click", async () => {
    await agir("equipe_declarer", { attributions: declarationSaisie });
    delete zone.dataset.modification;
    derniereCle = "";
    rendre();
  });
}

// ---- Temps, vérification, résultat ----

function texteTemps(role) {
  const temps = draft[`temps_${role}`];
  if (!temps) return "en attente…";
  if (temps.masque) return "saisi ✓";
  return temps.affiche;
}

function rendreTemps() {
  const zone = $("zone-temps");
  const phases = ["temps", "verification", "termine", "litige"];
  zone.classList.toggle("cache", !phases.includes(draft.phase));
  if (!phases.includes(draft.phase)) return;
  // Le champ garde ce qui est tapé entre deux rafraîchissements.
  const saisie = $("input-temps-equipe")?.value || "";
  const camp = monCamp();

  let contenu = `<p class="temps-equipes">${ROLES.map(role => `${NOMS_EQUIPES[role]} : <strong>${texteTemps(role)}</strong>`).join(" — ")}</p>`;
  if (draft.phase === "temps" && suisChef() && !draft[`temps_${camp}`]) {
    contenu += `
      <div class="ligne-saisie-temps">
        <input id="input-temps-equipe" type="text" placeholder="Temps de l'équipe (mm:ss)" inputmode="decimal" value="${echapperHtml(saisie)}">
        <button type="button" class="btn-equipe principal" id="btn-temps">Valider</button>
        <button type="button" class="btn-equipe secondaire" id="btn-abandon">Abandonner</button>
      </div>`;
  }
  if (draft.phase === "verification" && suisChef()) {
    contenu += draft[`temps_confirme_${camp}`]
      ? `<p>Temps confirmés. En attente du chef adverse…</p>`
      : `<div class="boutons-verification">
          <button type="button" class="btn-equipe principal" id="btn-confirmer-temps">Les temps sont corrects</button>
          <button type="button" class="btn-equipe secondaire" id="btn-litige">Litige</button>
        </div>`;
  }
  if (draft.phase === "termine") {
    contenu += `<p class="ligne-resultat">${draft.vainqueur === "egalite" ? "Égalité" : `Victoire de l'${NOMS_EQUIPES[draft.vainqueur]?.toLowerCase() || "équipe"}`}</p>`;
  }
  if (draft.phase === "litige") contenu += `<p class="ligne-resultat litige">Litige : match transmis aux administrateurs</p>`;

  zone.innerHTML = contenu;

  $("btn-temps")?.addEventListener("click", () => agir("equipe_temps", { temps: $("input-temps-equipe").value }));
  $("input-temps-equipe")?.addEventListener("keydown", event => {
    if (event.key === "Enter") agir("equipe_temps", { temps: event.target.value });
  });
  $("btn-abandon")?.addEventListener("click", () => {
    if (confirm("Abandonner à la place d'un temps ?")) agir("equipe_temps", { abandon: true });
  });
  $("btn-confirmer-temps")?.addEventListener("click", () => agir("equipe_confirmer", {}));
  $("btn-litige")?.addEventListener("click", () => $("fenetre-litige").classList.remove("cache"));
}

function rendreAnnule() {
  $("texte-annule").textContent = draft.annule_par
    ? `${nomJoueur(draft.annule_par)} a quitté le match (autre match démarré) : il est annulé et ne compte pas.`
    : "Le match est annulé.";
}

// ---- Boss (dès la draft), fond d'écran, localisation des légendes ----

const ELEMENTS_RES_BOSS = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];
const FOND_DEFAUT = "/DB/images/bg_web/autres/default_bg.webp";
let fondsBoss = [];
let fondApplique = null;
let bossAffiche = null;

// Image cliquable (résistances), nom, et localisation d'une légende locale.
function rendreBoss() {
  const boss = bossParId.get(draft.boss_id);
  $("zone-boss").classList.toggle("cache", !boss);
  if (!boss || bossAffiche === boss.id) return;
  bossAffiche = boss.id;
  const res = ELEMENTS_RES_BOSS.map((element, i) => {
    const valeur = Number(boss.res?.[i] ?? 0);
    const nom = element.charAt(0).toUpperCase() + element.slice(1);
    return `<span class="res-boss${estImmunise(valeur) ? " immunise" : ""}" title="${estImmunise(valeur) ? `Immunisé ${nom}` : `Résistance ${nom}`}"><img src="${ICONES_ELEMENTS_TRI[element]}" alt="${nom}">${texteResistance(valeur, "")}</span>`;
  }).join("");
  $("boss-equipe").innerHTML = `
    <button type="button" class="image-boss-res" title="Voir les résistances">
      ${htmlImagesBoss(boss)}
      <span class="resistances-boss">${res}</span>
    </button>
    <span class="indice-res-boss">Voir les Res</span>
    <span class="nom-boss">${echapperHtml(boss.nom)}</span>
    ${estLegendeLocale(boss) ? `<button type="button" class="btn-carte-legende" title="Où trouver cette légende locale"><img src="../DB/images/others/Icon_Map.webp" alt="">Localisation</button>` : ""}`;
}

function initialiserBoss() {
  $("boss-equipe").addEventListener("click", event => {
    if (event.target.closest(".image-boss-res, .indice-res-boss")) {
      $("boss-equipe").querySelector(".image-boss-res")?.classList.toggle("res-visibles");
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

// Fonds des boss (cosmetiques.json), comme la page du match 1v1.
async function chargerFondsBoss() {
  try {
    const cosmetiques = await (await fetch("/DB/images/cosmetiques.json")).json();
    fondsBoss = cosmetiques.fonds.filter(fond => fond.categorie === "boss_hebdo" || fond.categorie === "legendes_locales");
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
  if (draft?.boss_id && !["lobby", "chefs", "hotes"].includes(draft.phase)) {
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

// ---- Fin du match : revanche (chefs), retour au lobby (créateur) ----

function rendreFinDeMatch() {
  const fini = ["termine", "litige", "annule"].includes(draft.phase);
  const revanchePossible = ["termine", "litige"].includes(draft.phase) && suisChef();
  const createur = draft.createur === moi?.id;
  $("actions-fin").classList.toggle("cache", !fini || !(revanchePossible || createur));
  const bouton = $("btn-revanche");
  bouton.classList.toggle("cache", !revanchePossible);
  if (revanchePossible) {
    const demande = !!draft[`revanche_${monCamp()}`];
    bouton.textContent = demande ? "Annuler la revanche" : "Rejouer";
    bouton.classList.toggle("actif", demande);
  }
  $("btn-rejouer").classList.toggle("cache", !(fini && createur));
}

// ---- Bulles du bas ----

function rendreBulles() {
  const message = $("message-equipe");
  const tour = $("tour-equipe");
  const bouton = $("btn-confirmer");
  message.textContent = "";
  tour.textContent = "";
  bouton.classList.add("cache");

  if (!suisMembre() && draft.phase !== "lobby") message.textContent = "👁 Tu regardes ce match en spectateur.";

  if (draft.phase === "chefs") tour.textContent = `Vote du chef : ${secondesRestantes(draft.fin_vote)} s`;
  if (draft.phase === "hotes") tour.textContent = `Choix de l'hôte : ${secondesRestantes(draft.fin_hote)} s`;

  const action = actionCourante();
  if (action) {
    const verbe = action.type === "pick" ? "picker" : "bannir";
    if (aMonTour()) {
      tour.innerHTML = `À toi de <strong class="verbe-action">${verbe}</strong>${selection ? ` : <strong>${echapperHtml(personnagesDraftParId.get(selection.perso_id)?.nom || "")}${selection.element ? ` ${NOMS_ELEMENTS[selection.element] || ""}` : ""}</strong>` : ""}`;
      bouton.classList.remove("cache");
      bouton.className = `btn-confirmer-action a-mon-tour action-${action.type}${selection ? " pret" : ""}`;
      bouton.disabled = !selection;
    } else {
      const chef = draft.chefs?.[action.joueur];
      tour.innerHTML = `${NOMS_EQUIPES[action.joueur]} : ${htmlPseudoJoueur(chef)} doit <strong class="verbe-action">${verbe}</strong>`;
    }
  }
  if (draft.phase === "declaration") tour.textContent = "Déclaration : qui joue quel perso ?";
  if (draft.phase === "temps") tour.textContent = suisChef() ? "Saisis le temps de ton équipe." : "Les chefs saisissent le temps de leur équipe.";
  if (draft.phase === "verification") tour.textContent = "Vérification des temps par les chefs.";
  if (["termine", "litige"].includes(draft.phase)) {
    const demandes = ROLES.filter(role => draft[`revanche_${role}`]);
    tour.textContent = demandes.length === 1
      ? `${NOMS_EQUIPES[demandes[0]]} veut rejouer (mêmes équipes) : en attente de l'autre chef…`
      : "Les chefs peuvent relancer une revanche avec les mêmes équipes.";
  }
}

// ---- Litige ----

function initialiserLitige() {
  $("annuler-litige").addEventListener("click", () => $("fenetre-litige").classList.add("cache"));
  $("envoyer-litige").addEventListener("click", async () => {
    const commentaire = $("commentaire-litige").value.trim();
    if (!commentaire) return alert("Explique la raison du litige.");
    $("fenetre-litige").classList.add("cache");
    await agir("equipe_litige", { commentaire });
  });
  $("annuler-element").addEventListener("click", () => $("fenetre-element").classList.add("cache"));
}

// ---- Démarrage ----

function initialiserBoutons() {
  $("btn-rejoindre").addEventListener("click", () => agir("equipe_rejoindre", {}));
  $("btn-quitter").addEventListener("click", async () => {
    if (!confirm("Quitter le lobby ?")) return;
    try {
      await appel("equipe_quitter", {});
      window.location.href = "matchmaking.html";
    } catch (erreur) {
      alert(erreur.message);
    }
  });
  $("btn-lancer").addEventListener("click", () => agir("equipe_lancer", {}));
  $("btn-confirmer").addEventListener("click", confirmerAction);
  $("btn-rejouer").addEventListener("click", () => {
    if (confirm("Retourner au lobby (pour changer les équipes) ?")) agir("equipe_rejouer", {});
  });
  $("btn-revanche").addEventListener("click", () => agir("equipe_revanche", { rejouer: !draft[`revanche_${monCamp()}`] }));

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
    const data = await appel("equipe_etat");
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
    $("chargement").textContent = "Connecte-toi avec Discord pour rejoindre ce match.";
    return;
  }

  const [personnages, boss] = await Promise.all([chargerPersonnages(), chargerBoss(), chargerFondsBoss()]);
  personnagesParId = new Map(personnages.map(p => [p.id, p]));
  personnagesDraftParId = new Map(regrouperPourDraft(personnages).map(p => [p.id, p]));
  bossParId = new Map(boss.map(b => [b.id, b]));

  initialiserBoutons();
  initialiserBoss();
  initialiserVitrines();
  initialiserLitige();

  // Arrivée par le lien : on rejoint le lobby s'il reste de la place
  // (sinon spectateur, message du serveur affiché une fois).
  await rafraichir();
  if (draft?.phase === "lobby" && !suisMembre() && (draft.membres || []).length < draft.taille * 2) {
    try {
      const data = await appel("equipe_rejoindre", {});
      definirDraft(data.draft);
    } catch (erreur) {
      alert(erreur.message);
    }
  }

  let intervalle = setInterval(rafraichir, POLL_MS);
  // Comptes à rebours (vote, hôte) : bulles mises à jour chaque seconde.
  setInterval(() => { if (draft && ["chefs", "hotes"].includes(draft.phase)) rendreBulles(); }, 1000);
  document.addEventListener("visibilitychange", () => {
    clearInterval(intervalle);
    if (!document.hidden) {
      rafraichir();
      intervalle = setInterval(rafraichir, POLL_MS);
    }
  });
}

demarrer();
