// Administration : méthode des bans d'équilibrage des drafts
// (config.equilibrage, cf. getModeEquilibrage dans api/_lib/personnages.js).
// Enregistrée dès le clic (administrateurs seulement ; mini admins : lecture
// seule, cf. passerEnLectureSeule dans admin_ppc.js).

const METHODES_EQUILIBRAGE = [
  { valeur: "ancien", titre: "Ancienne méthode", description: "Nombre de bans imposé : 1 ban tous les 200 points d'écart entre les box." },
  { valeur: "perso", titre: "Points du perso", description: "Bans libres : la box adverse perd les points du perso banni (sans les armes)." },
  { valeur: "perso_signature", titre: "Perso + arme signature", description: "Bans libres : la box adverse perd les points du perso banni et de son arme signature (meilleure copie de sa box)." },
  { valeur: "deux_box", titre: "Les 2 box", description: "Bans libres : chaque box perd les points du perso banni si elle l'a (celle de celui qui bannit aussi)." }
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
