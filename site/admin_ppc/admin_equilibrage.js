// Administration : méthode des bans d'équilibrage des drafts
// (config.equilibrage, cf. getModeEquilibrage dans api/_lib/personnages.js).
// Enregistrée dès le clic (administrateurs seulement ; mini admins : lecture
// seule, cf. passerEnLectureSeule dans admin_ppc.js).

const METHODES_EQUILIBRAGE = [
  { valeur: "ancien", titre: "Ancienne méthode", description: "Nombre de bans imposé : 1 ban tous les 200 points d'écart entre les box." },
  { valeur: "perso", titre: "Points du perso", description: "Bans libres : la box adverse perd les points du perso banni (sans les armes)." },
  { valeur: "perso_signature", titre: "Perso + arme signature", description: "Bans libres : la box adverse perd les points du perso banni et de son arme signature (meilleure copie de sa box)." },
  { valeur: "deux_box", titre: "Les 2 box", description: "Bans libres : chaque box perd les points du perso banni si elle l'a (celle de celui qui bannit aussi)." },
  { valeur: "vh_top4", titre: "Verticalité / horizontalité (4 meilleurs)", description: "Bans libres des 5★ adverses de 50 pts ou plus. Horizontalité : nombre de 5★ de 50 pts ou plus ; verticalité : moyenne des 4 meilleurs 5★. La box adverse ne passe sous la sienne sur aucune des 2." },
  { valeur: "vh_moy50", titre: "Verticalité / horizontalité (moyenne des 50+)", description: "Bans libres des 5★ adverses de 50 pts ou plus. Horizontalité : nombre de 5★ de 50 pts ou plus ; verticalité : moyenne de ces 5★. La box adverse ne passe sous la sienne sur aucune des 2." },
  { valeur: "fixe_joker", titre: "Bans calculés + joker", description: "Verticalité = moyenne des 12 meilleurs persos (perso + signature). Le nombre de bans est calculé d'après les 2 box (sans plafond) : assez pour ramener l'écart d'équipe prévu (4 × écart de verticalité) à 25 pts ou moins. Si les bans n'y arrivent pas : 1 ban joker (interdit à l'adversaire seulement)." },
  { valeur: "fixe_complet", titre: "Bans calculés + joker + draft", description: "Comme « Bans calculés + joker », et en dernier recours si ça ne suffit toujours pas : la box faible a 1 ban de draft en plus au 1er tour (comme le dauphin), et aussi au 2e tour (comme la baleine) si l'écart prévu dépasse encore 50." }
];

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
  const fermer = () => modal.classList.remove("active");

  document.getElementById("ouvrir-equilibrage").addEventListener("click", async () => {
    modal.classList.add("active");
    afficherMessageEquilibrage("");
    if (actuelle === null) {
      try {
        const config = await chargerPointsAdmin();
        actuelle = METHODES_EQUILIBRAGE.some(m => m.valeur === config?.equilibrage) ? config.equilibrage : "ancien";
      } catch (erreur) {
        console.error(erreur);
        actuelle = "ancien";
      }
    }
    rendreEquilibrage(actuelle);
  });
  document.getElementById("fermer-equilibrage").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
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
