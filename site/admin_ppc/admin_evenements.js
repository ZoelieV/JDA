// Événements : modes de la page Événements (evenements.html), toujours
// visibles par les administrateurs, activés pour tout le monde ou non.
// Random world boss (config.world_boss_public, cf.
// api/_lib/world_boss.js) : enregistré dès le clic. Mini admins : lecture
// seule (case verrouillée, cf. ZONES_MODIFIABLES, admin_ppc.js).
// Utilise envoyerAjout (admin_ajout.js).

function initialiserEvenements() {
  const modal = document.getElementById("modal-evenements");
  const caseWorldBoss = document.getElementById("world-boss-actif");
  const message = document.getElementById("message-world-boss");
  const fermer = () => modal.classList.remove("active");

  chargerPointsAdmin().then(config => { caseWorldBoss.checked = config?.world_boss_public === true; });
  document.getElementById("ouvrir-evenements").addEventListener("click", () => modal.classList.add("active"));
  document.getElementById("fermer-evenements").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });

  caseWorldBoss.addEventListener("change", async () => {
    const actif = caseWorldBoss.checked;
    caseWorldBoss.disabled = true;
    message.className = "message-ajout";
    message.textContent = "Enregistrement…";
    try {
      await envoyerAjout({ world_boss_public: actif });
      message.textContent = actif ? "Random world boss ouvert à tous." : "Random world boss réservé aux administrateurs.";
      message.classList.add("succes");
    } catch (erreur) {
      console.error(erreur);
      caseWorldBoss.checked = !actif;
      message.textContent = erreur.message;
      message.classList.add("erreur");
    } finally {
      caseWorldBoss.disabled = false;
    }
  });
}

initialiserEvenements();
