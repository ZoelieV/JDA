// Administration : méthode des bans d'équilibrage des drafts
// (config.equilibrage, cf. getModeEquilibrage dans api/_lib/personnages.js).
// Enregistrée dès le clic (administrateurs seulement ; mini admins : lecture
// seule, cf. passerEnLectureSeule dans admin_ppc.js).

// Dans les 2 méthodes, celui qui bannit peut échanger 5 bans contre 1 joker
// (une fois par draft, cf. echangerBansContreJoker dans api/_lib/draft.js).
const METHODES_EQUILIBRAGE = [
  { valeur: "ancien", titre: "Ancienne méthode", description: "Nombre de bans imposé : 1 ban tous les 200 points d'écart entre les box." },
  { valeur: "fixe_joker", titre: "Bans calculés + joker", description: "Verticalité = moyenne des 12 meilleurs persos (perso + signature). Le nombre de bans est calculé d'après les 2 box (sans plafond) : assez pour ramener l'écart d'équipe prévu (4 × écart de verticalité) à 25 pts ou moins. Si les bans n'y arrivent pas : 1 ban joker (interdit à l'adversaire seulement). Armes en double et signatures sans leur perso : attribuées à leur valeur alternative aux persos sans signature du même type (armes support : persos support ou sub-dps)." }
];

// Limites des bans calculés par palier (config.limites_equilibrage, cf.
// getLimitesEquilibrage dans api/_lib/personnages.js).
const PALIERS_LIMITES = { 1: "Sardine", 2: "Carpe", 3: "Dauphin", 4: "Baleine" };
const CHAMPS_LIMITES = [
  { cle: "min_persos", titre: "Persos min" },
  { cle: "seuil_bas", titre: "Seuil bas" },
  { cle: "seuil_haut", titre: "Seuil haut" },
  { cle: "plancher", titre: "Plancher" }
];

function rendreLimites(limites) {
  document.getElementById("limites-equilibrage").innerHTML = `
    <table class="tableau-boss tableau-limites">
      <thead><tr><th class="col-nom">Palier</th>${CHAMPS_LIMITES.map(c => `<th>${c.titre}</th>`).join("")}</tr></thead>
      <tbody>
        ${Object.entries(PALIERS_LIMITES).map(([palier, nom]) => `
          <tr>
            <td class="col-nom">${nom}</td>
            ${CHAMPS_LIMITES.map(c => `<td><input type="number" min="0" step="1" name="${palier}-${c.cle}" value="${limites?.[palier]?.[c.cle] ?? ""}" required></td>`).join("")}
          </tr>`).join("")}
      </tbody>
    </table>
    <button type="submit" class="bouton-creer">Enregistrer les limites</button>`;
}

function lireFormulaireLimites(formulaire) {
  return Object.fromEntries(Object.keys(PALIERS_LIMITES).map(palier => [
    palier,
    Object.fromEntries(CHAMPS_LIMITES.map(c => [c.cle, Number(formulaire.elements[`${palier}-${c.cle}`].value)]))
  ]));
}

function afficherMessageEquilibrage(texte, type = "") {
  const message = document.getElementById("message-equilibrage");
  message.className = `message-ajout${type ? ` ${type}` : ""}`;
  message.textContent = texte;
}

function rendreEquilibrage(actuelle) {
  document.getElementById("liste-equilibrage").innerHTML = METHODES_EQUILIBRAGE.map(({ valeur, titre, description }) => `
    <label class="choix-equilibrage${valeur === actuelle ? " active" : ""}">
      <input type="radio" name="methode-equilibrage" value="${valeur}"${valeur === actuelle ? " checked" : ""}>
      <span><strong>${titre}</strong><br><span class="details-boss">${description}</span></span>
    </label>`).join("");
}

function initialiserEquilibrage() {
  const modal = document.getElementById("modal-equilibrage");
  const liste = document.getElementById("liste-equilibrage");
  // Méthode enregistrée : lue une fois (chargerPointsAdmin garde la 1re
  // réponse), puis suivie à chaque enregistrement.
  let actuelle = null;
  let limites = null;
  const fermer = () => modal.classList.remove("active");

  document.getElementById("ouvrir-equilibrage").addEventListener("click", async () => {
    modal.classList.add("active");
    afficherMessageEquilibrage("");
    if (actuelle === null) {
      try {
        const config = await chargerPointsAdmin();
        actuelle = METHODES_EQUILIBRAGE.some(m => m.valeur === config?.equilibrage) ? config.equilibrage : "ancien";
        limites = config?.limites_equilibrage || null;
      } catch (erreur) {
        console.error(erreur);
        actuelle = "ancien";
      }
    }
    rendreEquilibrage(actuelle);
    rendreLimites(limites);
  });
  document.getElementById("fermer-equilibrage").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });

  document.getElementById("limites-equilibrage").addEventListener("submit", async event => {
    event.preventDefault();
    const formulaire = event.currentTarget;
    const bouton = formulaire.querySelector("button[type=submit]");
    bouton.disabled = true;
    afficherMessageEquilibrage("Enregistrement…");
    try {
      const config = await envoyerAjout({ limites_equilibrage: lireFormulaireLimites(formulaire) });
      limites = config.limites_equilibrage;
      afficherMessageEquilibrage("Limites enregistrées : elles s'appliquent aux prochaines drafts.", "succes");
    } catch (erreur) {
      console.error(erreur);
      afficherMessageEquilibrage(erreur.message, "erreur");
    }
    rendreLimites(limites);
  });

  liste.addEventListener("change", async event => {
    const choix = event.target.closest("input[name=methode-equilibrage]");
    if (!choix) return;
    liste.querySelectorAll("input").forEach(input => { input.disabled = true; });
    afficherMessageEquilibrage("Enregistrement…");
    try {
      await envoyerAjout({ equilibrage: choix.value });
      actuelle = choix.value;
      afficherMessageEquilibrage("Méthode enregistrée : elle s'applique aux prochaines drafts.", "succes");
    } catch (erreur) {
      console.error(erreur);
      afficherMessageEquilibrage(erreur.message, "erreur");
    }
    rendreEquilibrage(actuelle);
  });
}

initialiserEquilibrage();
