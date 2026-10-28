// Page d'un tournoi (/tournoi?id=) : présentation, inscriptions (1v1) ou
// équipes (création, demandes, capitaine), qualifications, arbre de la
// phase finale, gestion par son créateur (cf. api/_lib/tournois.js).
// Relue toutes les ACTUALISATION_MS tant que la page est visible.

const ID_TOURNOI = new URLSearchParams(window.location.search).get("id");
const ACTUALISATION_MS = 20 * 1000;
let vue = null; // { tournoi, joueurs, classement_qualifs, noms_tours, moi }
let placeChoisie = null; // échange de places dans l'arbre (gestionnaire)
let comptesTournoi = null; // [{ id, nom }] pour ajouter un arbitre

const $t = id => document.getElementById(id);

function nomParticipant(id) {
  if (!id) return null;
  const { tournoi, joueurs } = vue;
  if (tournoi.format === "equipe") return echapperTournoi(tournoi.equipes.find(e => e.id === id)?.nom || "Équipe");
  return htmlJoueurTournoi(joueurs, id);
}

function estMoi(participant) {
  const { tournoi, moi } = vue;
  if (!moi || !participant) return false;
  if (tournoi.format === "equipe") return !!tournoi.equipes.find(e => e.id === participant)?.membres.includes(moi.id);
  return participant === moi.id;
}

function lienRoom(roomId) {
  return `/${vue.tournoi.format === "equipe" ? "equipe" : "match"}?room=${encodeURIComponent(roomId)}`;
}

function message(zone, texte, type = "") {
  const el = $t(zone);
  el.textContent = texte;
  el.className = `message-tournoi ${type}`;
}

// Action envoyée au serveur, puis page rendue avec le tournoi renvoyé.
async function agirTournoi(action, corps = {}, zone = "message-gestion") {
  message(zone, "…");
  try {
    const donnees = await appelTournoi(action, { id: ID_TOURNOI, corps });
    if (donnees.room_id) {
      window.location.href = lienRoom(donnees.room_id);
      return;
    }
    if (donnees.tournoi) vue = donnees;
    message(zone, "");
    rendre();
  } catch (erreur) {
    message(zone, erreur.message, "erreur");
  }
}

// ---- Rendu ----

function rendre() {
  const { tournoi, joueurs, moi } = vue;
  document.title = `${tournoi.nom} — Tournoi`;
  $t("etat-tournoi").hidden = true;
  $t("contenu-tournoi").hidden = false;
  $t("nom-tournoi").textContent = tournoi.nom;
  $t("pastilles-tournoi").innerHTML = `
    <span class="pastille-tournoi statut-${tournoi.statut}">${STATUTS_TOURNOI[tournoi.statut] || tournoi.statut}</span>
    <span class="pastille-tournoi">${formatTournoi(tournoi)}</span>
    <span class="pastille-tournoi">${echapperTournoi(modeTournoi(tournoi))}</span>
    ${tournoi.affrontement === "bo3" ? `<span class="pastille-tournoi">Best of 3</span>` : ""}
    ${tournoi.finale_bo5 ? `<span class="pastille-tournoi">Finale en bo5</span>` : ""}`;
  $t("description-tournoi").textContent = tournoi.description || "Pas de description.";

  const infos = [
    ["Organisateur", htmlJoueurTournoi(joueurs, tournoi.createur)],
    ["Début", dateTournoi(tournoi.debut)],
    ...(tournoi.fin ? [["Fin", dateTournoi(tournoi.fin)]] : []),
    ["Fin des inscriptions", dateTournoi(tournoi.verrouillage)],
    ["Participants", `${tournoi.format === "equipe" ? tournoi.equipes.length : tournoi.inscrits.length} / ${tournoi.max_participants} ${tournoi.format === "equipe" ? "équipes" : "joueurs"}`],
    ["Phase finale", `${TAILLES_ARBRE_TOURNOI[tournoi.arbre_max] || tournoi.arbre_max} au plus (${tournoi.qualif_matchs} match${tournoi.qualif_matchs > 1 ? "s" : ""} de qualif si plus d'inscrits)`],
    ["Affrontements", `${tournoi.affrontement === "bo3" ? "Best of 3" : "Un seul match"}${tournoi.finale_bo5 ? ", finale en best of 5" : ""}`],
    ...(tournoi.format === "1v1" ? [["Box", tournoi.box === "full" ? "Full box imposée" : "Au choix (full / opti)"]] : []),
    ["Chronos", tournoi.chronos ? `analyse ${tournoi.chronos.analyse_s} s, ${tournoi.chronos.action_s} s par pick / ban, ${tournoi.chronos.ban_s} s par ban d'équilibrage` : "Sans chronos"],
    ["Récompense", `${RECOMPENSES_TOURNOI[tournoi.recompense?.type] || "—"}${tournoi.recompense?.texte ? ` : ${echapperTournoi(tournoi.recompense.texte)}` : ""}`],
    ...(tournoi.vainqueur ? [["🏆 Vainqueur", nomParticipant(tournoi.vainqueur)]] : [])
  ];
  $t("infos-tournoi").innerHTML = infos.map(([titre, valeur]) => `<dt>${titre}</dt><dd>${valeur}</dd>`).join("");

  rendreParticipants();
  rendreQualifs();
  rendreArbre();
  rendreMoi();
  rendreGestion();
  const arbitres = [tournoi.createur, ...(tournoi.arbitres || [])];
  $t("bloc-arbitres-public").hidden = !!moi?.gestionnaire;
  $t("arbitres-public").innerHTML = arbitres.map(id => `<li>${htmlJoueurTournoi(joueurs, id)}</li>`).join("");
}

function rendreParticipants() {
  const { tournoi, joueurs, moi } = vue;
  const zone = $t("participants-tournoi");
  if (tournoi.format === "1v1") {
    $t("titre-participants").textContent = `Inscrits (${tournoi.inscrits.length})`;
    zone.innerHTML = tournoi.inscrits.length
      ? `<ul class="liste-joueurs-tournoi">${tournoi.inscrits.map(id => `<li>${htmlJoueurTournoi(joueurs, id)}</li>`).join("")}</ul>`
      : `<p class="doux">Personne pour l'instant.</p>`;
    return;
  }
  $t("titre-participants").textContent = `Équipes (${tournoi.equipes.length})`;
  const ouvertes = tournoi.statut === "inscriptions";
  const maDemande = tournoi.equipes.find(e => e.demandes.includes(moi?.id));
  const monEquipe = tournoi.equipes.find(e => e.membres.includes(moi?.id));
  zone.innerHTML = tournoi.equipes.length ? `<div class="equipes-tournoi">${tournoi.equipes.map(equipe => {
    const capitaine = equipe.capitaine === moi?.id;
    const complete = equipe.membres.length >= tournoi.taille_equipe;
    return `
      <div class="equipe-tournoi${equipe === monEquipe ? " mienne" : ""}">
        <h3><span>${echapperTournoi(equipe.nom)}</span><span class="doux">${equipe.membres.length} / ${tournoi.taille_equipe}</span></h3>
        <ul>${equipe.membres.map(id => `<li>${htmlJoueurTournoi(joueurs, id)}${id === equipe.capitaine ? `<span class="badge-capitaine">capitaine</span>` : capitaine && ouvertes ? `<button type="button" class="bouton-tournoi petit danger" data-equipe-action="exclure" data-joueur="${id}">Exclure</button>` : ""}</li>`).join("")}</ul>
        ${capitaine && ouvertes && equipe.demandes.length ? `<p class="doux">Demandes :</p><ul>${equipe.demandes.map(id => `
          <li>${htmlJoueurTournoi(joueurs, id)}<span class="actions-match">
            <button type="button" class="bouton-tournoi petit" data-equipe-action="accepter" data-joueur="${id}"${complete ? " disabled" : ""}>Accepter</button>
            <button type="button" class="bouton-tournoi petit danger" data-equipe-action="refuser" data-joueur="${id}">Refuser</button>
          </span></li>`).join("")}</ul>` : ""}
        ${ouvertes && moi && !monEquipe && !complete ? (maDemande === equipe
          ? `<button type="button" class="bouton-tournoi petit" data-equipe-action="annuler_demande">Annuler ma demande</button>`
          : `<button type="button" class="bouton-tournoi petit" data-equipe-action="demander" data-equipe="${equipe.id}">${maDemande ? "Demander plutôt celle-ci" : "Demander à rejoindre"}</button>`) : ""}
      </div>`;
  }).join("")}</div>` : `<p class="doux">Aucune équipe pour l'instant.</p>`;
  if (tournoi.equipes_retirees?.length) {
    zone.insertAdjacentHTML("beforeend", `<p class="doux">Équipes incomplètes retirées au verrouillage : ${tournoi.equipes_retirees.map(echapperTournoi).join(", ")}.</p>`);
  }
}

function rendreMoi() {
  const { tournoi, moi } = vue;
  const bloc = $t("bloc-moi");
  const zone = $t("moi-tournoi");
  if (!moi) {
    bloc.hidden = false;
    zone.innerHTML = `<p class="doux">Connecte-toi pour participer.</p>`;
    return;
  }
  const boutons = [];
  const ouvertes = tournoi.statut === "inscriptions";
  if (tournoi.format === "1v1") {
    const inscrit = tournoi.inscrits.includes(moi.id);
    if (ouvertes) {
      boutons.push(inscrit
        ? `<span>✔ Tu es inscrit.</span><button type="button" class="bouton-tournoi danger" data-moi="desinscrire">Me désinscrire</button>`
        : `<button type="button" class="bouton-tournoi principal" data-moi="inscrire"${tournoi.inscrits.length >= tournoi.max_participants ? " disabled" : ""}>S'inscrire</button>`);
    } else if (inscrit) boutons.push(`<span>✔ Tu participes.</span>`);
  } else {
    const equipe = tournoi.equipes.find(e => e.membres.includes(moi.id));
    const demande = tournoi.equipes.find(e => e.demandes.includes(moi.id));
    if (equipe) {
      boutons.push(`<span>Équipe <strong>${echapperTournoi(equipe.nom)}</strong>${equipe.capitaine === moi.id ? " (capitaine)" : ""}</span>`);
      if (ouvertes) boutons.push(`<button type="button" class="bouton-tournoi danger" data-equipe-action="quitter">${equipe.capitaine === moi.id ? "Dissoudre l'équipe" : "Quitter l'équipe"}</button>`);
    } else if (ouvertes) {
      if (demande) boutons.push(`<span>Demande envoyée à <strong>${echapperTournoi(demande.nom)}</strong>.</span>`);
      boutons.push(`<input id="nom-equipe" class="bouton-tournoi" maxlength="30" placeholder="Nom de ton équipe"><button type="button" class="bouton-tournoi principal" data-equipe-action="creer"${tournoi.equipes.length >= tournoi.max_participants ? " disabled" : ""}>Créer une équipe</button>`);
      boutons.push(`<p class="doux">Ou demande à rejoindre une équipe (une seule demande à la fois) : le capitaine l'accepte.</p>`);
    }
  }
  // Matchs en cours où je joue : lien vers la room.
  const mesMatchs = matchsDuTournoi().filter(match => match.statut === "en_cours" && (estMoi(match.a) || estMoi(match.b)));
  mesMatchs.forEach(match => boutons.push(`<a class="bouton-tournoi principal" href="${lienRoom(match.room_id)}">▶ Rejoindre mon match</a>`));
  bloc.hidden = !boutons.length;
  zone.innerHTML = boutons.join("");
}

function matchsDuTournoi() {
  const { tournoi } = vue;
  return [...(tournoi.qualifs?.matchs || []), ...(tournoi.arbre?.tours.flat() || [])];
}

function scoreMatch(match) {
  const finale = vue.tournoi.arbre?.tours.at(-1)[0].id === match.id;
  if (!match.manches?.length || !(vue.tournoi.affrontement === "bo3" || (finale && vue.tournoi.finale_bo5))) return "";
  const gagnees = p => match.manches.filter(m => m.vainqueur === p).length;
  return ` <span class="score-arbre">${gagnees(match.a)} - ${gagnees(match.b)}</span>`;
}

function rendreQualifs() {
  const { tournoi, classement_qualifs: classement, moi } = vue;
  const bloc = $t("bloc-qualifs");
  bloc.hidden = !tournoi.qualifs;
  if (!tournoi.qualifs) return;
  const qualifies = new Set(tournoi.qualifies || []);
  $t("aide-qualifs").textContent = tournoi.statut === "qualifs"
    ? `${tournoi.qualif_matchs} match${tournoi.qualif_matchs > 1 ? "s" : ""} chacun, à lancer par un des joueurs quand vous êtes prêts ; un arbitre saisit les temps. Trophées comme en classé ; les ${tournoi.arbre_max} premiers vont en phase finale.`
    : "Qualifications terminées.";
  $t("classement-qualifs").innerHTML = `
    <table class="tableau-qualifs">
      <thead><tr><th>#</th><th>${tournoi.format === "equipe" ? "Équipe" : "Joueur"}</th><th>Trophées</th><th>V</th><th>Joués</th></tr></thead>
      <tbody>${classement.map((ligne, i) => `
        <tr class="${(qualifies.size ? qualifies.has(ligne.id) : i < tournoi.arbre_max) ? "qualifie" : ""}${i === tournoi.arbre_max - 1 ? " limite" : ""}">
          <td>${i + 1}</td><td>${nomParticipant(ligne.id)}</td><td>${ligne.trophees}</td><td>${ligne.victoires}</td><td>${ligne.joues}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  const enQualifs = tournoi.statut === "qualifs";
  $t("matchs-qualifs").innerHTML = tournoi.qualifs.matchs.map(match => {
    const mien = estMoi(match.a) || estMoi(match.b);
    let droite = "";
    if (match.statut === "termine") droite = `<span>${match.forfait ? "Victoire par forfait" : "Vainqueur"} : ${nomParticipant(match.vainqueur)} (${match.trophees} 🏆)</span>`;
    else if (match.statut === "en_cours") droite = `<a class="bouton-tournoi petit" href="${lienRoom(match.room_id)}">${mien || moi?.arbitre ? "Rejoindre" : "Regarder"}</a>`;
    else if (enQualifs && (mien || moi?.arbitre)) droite = `<button type="button" class="bouton-tournoi petit principal" data-lancer="${match.id}">Lancer</button>`;
    if (moi?.gestionnaire && enQualifs && match.statut !== "termine") droite += boutonsGestionMatch(match);
    return `<div class="match-qualif${mien ? " moi" : ""}"><span>Ronde ${match.ronde} · ${nomParticipant(match.a)} <span class="doux">vs</span> ${nomParticipant(match.b)}</span><span class="actions-match">${droite}</span></div>`;
  }).join("");
}

// Gestionnaire : forfait (vainqueur désigné), relance d'un match en cours.
// Dans un petit menu ⚙ (repliable) pour ne pas encombrer l'arbre.
function boutonsGestionMatch(match) {
  // Ses propres matchs : forfait déclaré par un autre admin.
  if (estMoi(match.a) || estMoi(match.b)) return "";
  const nom = id => vue.tournoi.format === "equipe" ? echapperTournoi(vue.tournoi.equipes.find(e => e.id === id)?.nom || "") : echapperTournoi(vue.joueurs[id]?.nom || "");
  const boutons = (match.statut === "en_cours" ? `<button type="button" class="bouton-tournoi petit" data-relancer="${match.id}" title="Room abandonnée ou annulée : remet le match à jouer">Remettre à jouer</button>` : "") +
    (match.a && match.b ? `<button type="button" class="bouton-tournoi petit danger" data-forfait="${match.id}" data-vainqueur="${match.a}" title="Victoire par forfait">Victoire par forfait → ${nom(match.a)}</button>
    <button type="button" class="bouton-tournoi petit danger" data-forfait="${match.id}" data-vainqueur="${match.b}" title="Victoire par forfait">Victoire par forfait → ${nom(match.b)}</button>` : "");
  return boutons ? `<details class="gestion-match"><summary title="Victoire par forfait, remettre à jouer">⚙</summary><div class="actions-match">${boutons}</div></details>` : "";
}

function rendreArbre() {
  const { tournoi, noms_tours: noms, moi } = vue;
  const bloc = $t("bloc-arbre");
  bloc.hidden = !tournoi.arbre;
  if (!tournoi.arbre) return;
  const modifiable = moi?.gestionnaire && tournoi.statut === "arbre" &&
    !tournoi.arbre.tours.flat().some(m => !m.exempt && (m.statut === "en_cours" || m.statut === "termine"));
  $t("aide-arbre").textContent = [
    tournoi.arbre_equilibre === false ? "⚠ Certaines paires du premier tour ne s'équilibrent pas en full box (aucun tirage n'a tout réussi)." : "",
    modifiable ? "Clique sur 2 participants du premier tour pour les échanger." : ""
  ].filter(Boolean).join(" ");
  $t("arbre-tournoi").innerHTML = tournoi.arbre.tours.map((tour, t) => `
    <div class="tour-arbre">
      <h3>${noms[t]}</h3>
      ${tour.map(match => {
        const camp = cote => {
          const id = match[cote];
          const classes = ["camp-arbre",
            match.statut === "termine" && id ? (match.vainqueur === id ? "gagnant" : "perdant") : "",
            modifiable && t === 0 && id ? "cliquable" : "",
            placeChoisie && placeChoisie === id ? "choisi" : ""].join(" ");
          return `<div class="${classes}"${modifiable && t === 0 && id ? ` data-place="${id}"` : ""}>${id ? nomParticipant(id) : `<span class="vide">${t === 0 && match.exempt ? "exempt" : "à venir"}</span>`}</div>`;
        };
        let actions = "";
        if (match.statut === "en_cours") actions += `<a class="bouton-tournoi petit principal" href="${lienRoom(match.room_id)}">${estMoi(match.a) || estMoi(match.b) ? "Rejoindre" : "Regarder"}</a>`;
        if (moi?.gestionnaire && tournoi.statut === "arbre" && match.statut === "pret") actions += `<button type="button" class="bouton-tournoi petit" data-lancer="${match.id}">Lancer ce match</button>`;
        if (moi?.gestionnaire && tournoi.statut === "arbre" && ["pret", "en_cours"].includes(match.statut)) actions += boutonsGestionMatch(match);
        return `
          <div class="match-arbre ${match.statut}">
            ${camp("a")}${camp("b")}
            ${scoreMatch(match) ? `<div class="doux">Manches :${scoreMatch(match)}</div>` : ""}
            ${match.forfait ? `<div class="doux">Victoire par forfait</div>` : ""}
            ${actions ? `<div class="actions-match">${actions}</div>` : ""}
          </div>`;
      }).join("")}
    </div>`).join("");
}

function rendreGestion() {
  const { tournoi, joueurs, moi } = vue;
  const bloc = $t("bloc-gestion");
  bloc.hidden = !moi?.gestionnaire;
  if (!moi?.gestionnaire) return;
  const boutons = [];
  if (["inscriptions", "verrouille", "qualifs", "arbre"].includes(tournoi.statut)) boutons.push(`<button type="button" class="bouton-tournoi" data-gestion="modifier">Modifier</button>`);
  if (tournoi.statut === "inscriptions") boutons.push(`<button type="button" class="bouton-tournoi" data-gestion="verrouiller">Fermer les inscriptions</button>`);
  if (tournoi.statut === "verrouille") {
    const n = tournoi.format === "equipe" ? tournoi.equipes.length : tournoi.inscrits.length;
    boutons.push(`<button type="button" class="bouton-tournoi principal" data-gestion="generer">${n > tournoi.arbre_max ? "Lancer les qualifications" : "Générer l'arbre"}</button>`);
  }
  if (tournoi.statut === "qualifs") boutons.push(`<button type="button" class="bouton-tournoi principal" data-gestion="terminer_qualifs">Terminer les qualifications</button>`);
  if (tournoi.statut === "arbre") {
    const enCours = tournoi.arbre.tours.flat().find(m => m.statut === "en_cours");
    boutons.push(enCours
      ? `<a class="bouton-tournoi principal" href="${lienRoom(enCours.room_id)}">▶ Match en cours</a>`
      : `<button type="button" class="bouton-tournoi principal" data-gestion="lancer"${tournoi.arbre.tours.flat().some(m => m.statut === "pret") ? "" : " disabled"}>▶ Prochain match</button>`);
  }
  if (!["termine", "annule"].includes(tournoi.statut)) boutons.push(`<button type="button" class="bouton-tournoi danger" data-gestion="annuler">Annuler le tournoi</button>`);
  if (["inscriptions", "verrouille", "annule"].includes(tournoi.statut)) boutons.push(`<button type="button" class="bouton-tournoi danger" data-gestion="supprimer">Supprimer</button>`);
  $t("gestion-tournoi").innerHTML = boutons.join("");
  // Créateur qui joue : il lui faut au moins un autre arbitre.
  const joue = tournoi.format === "equipe" ? tournoi.equipes.some(e => e.membres.includes(moi.id)) : tournoi.inscrits.includes(moi.id);
  if (joue && !(tournoi.arbitres || []).some(id => id !== moi.id)) {
    $t("gestion-tournoi").insertAdjacentHTML("beforeend", `<p class="message-tournoi erreur">Tu joues dans ce tournoi : ajoute au moins un autre arbitre, tu ne peux pas saisir les temps de tes propres matchs.</p>`);
  }
  $t("arbitres-tournoi").innerHTML = [
    `<li>${htmlJoueurTournoi(joueurs, tournoi.createur)} <span class="doux">(toi)</span></li>`,
    ...(tournoi.arbitres || []).map(id => `<li>${htmlJoueurTournoi(joueurs, id)} <button type="button" class="bouton-tournoi petit danger" data-retirer-arbitre="${id}">×</button></li>`)
  ].join("");
}

// ---- Événements ----

async function chargerComptesTournoi() {
  if (comptesTournoi) return comptesTournoi;
  const reponse = await fetch("/api/accounts", { credentials: "include" });
  const comptes = reponse.ok ? await reponse.json() : [];
  comptesTournoi = comptes.map(c => ({ id: c.discord_id, nom: c.discord_global_name || c.discord_username || c.discord_id }));
  $t("comptes-tournoi").innerHTML = comptesTournoi.map(c => `<option value="${echapperTournoi(c.nom)}"></option>`).join("");
  return comptesTournoi;
}

document.addEventListener("click", async event => {
  if (!vue) return;
  const cible = event.target;
  const moiAction = cible.closest("[data-moi]")?.dataset.moi;
  if (moiAction) return agirTournoi(moiAction, {}, "message-moi");

  const equipeAction = cible.closest("[data-equipe-action]");
  if (equipeAction) {
    const action = equipeAction.dataset.equipeAction;
    if (["quitter", "exclure", "refuser"].includes(action) && !confirm(action === "quitter" ? "Sûr ?" : "Confirmer ?")) return;
    return agirTournoi("equipe", {
      action,
      equipe: equipeAction.dataset.equipe,
      joueur: equipeAction.dataset.joueur,
      nom: $t("nom-equipe")?.value
    }, "message-moi");
  }

  const lancer = cible.closest("[data-lancer]");
  if (lancer) return agirTournoi("lancer", { match: lancer.dataset.lancer }, vue.moi?.gestionnaire ? "message-gestion" : "message-moi");
  const relancer = cible.closest("[data-relancer]");
  if (relancer) {
    if (!confirm("Remettre ce match à jouer ? La room en cours ne comptera plus.")) return;
    return agirTournoi("relancer", { match: relancer.dataset.relancer });
  }
  const forfait = cible.closest("[data-forfait]");
  if (forfait) {
    if (!confirm("Déclarer la victoire par forfait ?")) return;
    return agirTournoi("forfait", { match: forfait.dataset.forfait, vainqueur: forfait.dataset.vainqueur });
  }

  const place = cible.closest("[data-place]");
  if (place) {
    if (!placeChoisie) {
      placeChoisie = place.dataset.place;
      rendreArbre();
    } else {
      const a = placeChoisie;
      placeChoisie = null;
      if (a === place.dataset.place) return rendreArbre();
      return agirTournoi("echanger", { a, b: place.dataset.place });
    }
    return;
  }

  const gestion = cible.closest("[data-gestion]")?.dataset.gestion;
  if (gestion === "modifier") {
    return ouvrirFormulaireTournoi({ config: vue.tournoi, id: ID_TOURNOI, surSucces: () => chargerTournoi() });
  }
  if (gestion === "supprimer") {
    if (!confirm("Supprimer définitivement ce tournoi ?")) return;
    try {
      await appelTournoi("supprimer", { id: ID_TOURNOI, corps: {} });
      window.location.href = "/tournois";
    } catch (erreur) {
      message("message-gestion", erreur.message, "erreur");
    }
    return;
  }
  if (gestion) {
    const confirmations = {
      verrouiller: "Fermer les inscriptions maintenant ?",
      generer: "Lancer la suite du tournoi ? Les inscriptions ne pourront plus changer.",
      terminer_qualifs: "Terminer les qualifications ? Les meilleurs vont en phase finale.",
      annuler: "Annuler le tournoi ?"
    };
    if (confirmations[gestion] && !confirm(confirmations[gestion])) return;
    return agirTournoi(gestion);
  }

  const retirer = cible.closest("[data-retirer-arbitre]");
  if (retirer) return agirTournoi("arbitres", { arbitres: vue.tournoi.arbitres.filter(id => id !== retirer.dataset.retirerArbitre) });
});

$t("ajouter-arbitre").addEventListener("click", async () => {
  const comptes = await chargerComptesTournoi();
  const saisie = $t("nouvel-arbitre").value.trim().toLowerCase();
  const compte = comptes.find(c => c.nom.toLowerCase() === saisie) || comptes.find(c => c.id === saisie);
  if (!compte) return message("message-gestion", "Joueur introuvable : choisis un pseudo de la liste.", "erreur");
  $t("nouvel-arbitre").value = "";
  agirTournoi("arbitres", { arbitres: [...(vue.tournoi.arbitres || []), compte.id] });
});
$t("nouvel-arbitre").addEventListener("focus", chargerComptesTournoi, { once: true });

async function chargerTournoi() {
  if (!ID_TOURNOI) {
    $t("etat-tournoi").textContent = "Tournoi introuvable.";
    return;
  }
  try {
    vue = await appelTournoi("detail", { id: ID_TOURNOI });
    rendre();
  } catch (erreur) {
    console.error(erreur);
    if (!vue) $t("etat-tournoi").textContent = erreur.message || "Impossible de charger le tournoi.";
  }
}

chargerTournoi();
setInterval(() => {
  // Pas pendant une saisie ni un échange de places.
  if (document.visibilityState === "visible" && !placeChoisie && !document.querySelector("dialog[open]") &&
    !["nom-equipe", "nouvel-arbitre"].includes(document.activeElement?.id)) chargerTournoi();
}, ACTUALISATION_MS);
