// Tournois : libellés, appels à l'API (/api/rooms/tournoi/<action>?id=, cf.
// api/_lib/tournois.js) et formulaire de création / modification, communs à
// tournois.js (liste) et tournoi.js (page d'un tournoi).

const MODES_TOURNOI = {
  auto: "Classique (draft du plus petit palier)",
  sardine: "Sardine",
  carpe: "Carpe",
  dauphin: "Dauphin",
  baleine: "Baleine",
  12: "Mêlée générale",
  carnage: "Carnage (sans équilibrage)"
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

function formatTournoi(tournoi) {
  return tournoi.format === "equipe" ? `En équipe ${tournoi.taille_equipe}v${tournoi.taille_equipe}` : "1v1";
}

function modeTournoi(tournoi) {
  return tournoi.format === "equipe" ? "Draft de la carpe (vitrines)" : MODES_TOURNOI[tournoi.mode] || tournoi.mode;
}

// Joueur (photo, pseudo) : joueurs = { id: { nom, avatar } }.
function htmlJoueurTournoi(joueurs, id) {
  const joueur = joueurs?.[id];
  const photo = joueur?.avatar ? `<img src="${echapperTournoi(joueur.avatar)}" alt="" loading="lazy">` : `<span class="sans-photo"></span>`;
  return `<span class="joueur-tournoi">${photo}<span>${echapperTournoi(joueur?.nom || "Joueur")}</span></span>`;
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
      ${verrouille ? `<p class="aide">Inscriptions fermées : seuls le nom, la description, la récompense et la fin se modifient encore.</p>` : ""}
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
        <label class="ligne"><input name="finale_bo5" type="checkbox"${c.finale_bo5 ? " checked" : ""}> La finale (dernier match) en best of 5</label>
        <p class="aide large" data-pour="equipe">En équipe : draft de la carpe avec les vitrines, comme le mode En équipe.</p>
      </fieldset>
      <fieldset${verrouille ? " disabled" : ""}>
        <legend>Participants</legend>
        <label>Participants maximum <span class="aide">(joueurs ou équipes)</span>
          <input name="max_participants" type="number" min="2" max="256" value="${c.max_participants || 16}">
        </label>
        <label>Phase finale à partir des
          <select name="arbre_max">${options(TAILLES_ARBRE_TOURNOI, c.arbre_max || 16)}</select>
        </label>
        <label>Matchs de qualification par participant
          <input name="qualif_matchs" type="number" min="1" max="10" value="${c.qualif_matchs || 3}">
        </label>
        <p class="aide large">Plus d'inscrits que de places dans la phase finale : qualifications d'abord (matchs en parallèle, temps saisis par les arbitres) ; les meilleurs en trophées vont dans l'arbre.</p>
      </fieldset>
      <fieldset>
        <legend>Dates</legend>
        <label${verrouille ? " hidden" : ""}>Fin des inscriptions <input name="verrouillage" type="datetime-local" value="${versChampDateTournoi(c.verrouillage)}"></label>
        <label${verrouille ? " hidden" : ""}>Début <input name="debut" type="datetime-local" required value="${versChampDateTournoi(c.debut)}"></label>
        <label>Fin <span class="aide">(si plusieurs jours)</span> <input name="fin" type="datetime-local" value="${versChampDateTournoi(c.fin)}"></label>
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
  const majVisibles = () => {
    const format = champ("format").value;
    fenetre.querySelectorAll("[data-pour]").forEach(el => { el.hidden = el.dataset.pour !== format; });
    fenetre.querySelectorAll("[data-chronos]").forEach(el => { el.hidden = !champ("chronos_actifs").checked; });
    fenetre.querySelector(".compteur-description").textContent = champ("description").value.length;
  };
  formulaire.addEventListener("input", majVisibles);
  formulaire.addEventListener("change", majVisibles);
  majVisibles();

  fenetre.querySelector('[data-action="annuler"]').addEventListener("click", () => fenetre.close());
  fenetre.addEventListener("close", () => fenetre.remove());
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
      finale_bo5: champ("finale_bo5").checked,
      max_participants: Number(champ("max_participants").value),
      arbre_max: Number(champ("arbre_max").value),
      qualif_matchs: Number(champ("qualif_matchs").value),
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
      const donnees = await appelTournoi(id ? "modifier" : "creer", { id, corps: { config: configEnvoyee } });
      fenetre.close();
      surSucces?.(id || donnees.id);
    } catch (erreur) {
      message.className = "message-tournoi erreur";
      message.textContent = erreur.message;
    }
  });
  document.body.appendChild(fenetre);
  fenetre.showModal();
}
