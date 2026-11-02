// Administration : event Little Cup (config.little_cup, cf. api/points.js) :
// nom, ouverture à tous, trophées à part, boss présents. Enregistré avec le
// bouton de la fenêtre ; le serveur refuse les mini admins.

function initialiserLittleCup() {
  const modal = document.getElementById("modal-little-cup");
  const zoneBoss = document.getElementById("cup-boss");
  const message = (texte, type = "") => {
    const e = document.getElementById("message-cup");
    e.textContent = texte;
    e.className = `message-ajout${type ? ` ${type}` : ""}`;
  };
  const cases = () => [...zoneBoss.querySelectorAll("input")];
  const majCompte = () => {
    document.getElementById("cup-compte").textContent = `(${cases().filter(c => c.checked).length} / ${cases().length})`;
  };
  const fermer = () => modal.classList.remove("active");

  async function ouvrir() {
    modal.classList.add("active");
    message("Chargement…");
    try {
      const [config, boss] = await Promise.all([chargerPointsAdmin(), chargerBoss()]);
      const cup = config?.little_cup || {};
      document.getElementById("cup-nom").value = cup.nom || "Little Cup";
      document.getElementById("cup-public").checked = cup.public === true;
      document.getElementById("cup-trophees").checked = cup.trophees === true;
      // Pas encore réglé : tous les boss cochés (ceux du tirage habituel).
      const coches = cup.boss ? new Set(cup.boss) : null;
      zoneBoss.innerHTML = boss.filter(b => !b.world_boss_seulement).map(b => `
        <label class="cup-un-boss">
          <input type="checkbox" value="${echapper(b.id)}"${!coches || coches.has(b.id) ? " checked" : ""}>
          <img src="/DB/${echapper(b.image)}" alt="" loading="lazy">
          <span>${echapper(b.nom)}</span>
        </label>`).join("");
      majCompte();
      message("");
    } catch (erreur) {
      console.error(erreur);
      message("Impossible de charger l'event.", "erreur");
    }
  }

  async function enregistrer() {
    const bouton = document.getElementById("enregistrer-cup");
    bouton.disabled = true;
    message("Enregistrement…");
    try {
      const config = await envoyerAjout({
        little_cup: {
          nom: document.getElementById("cup-nom").value,
          public: document.getElementById("cup-public").checked,
          trophees: document.getElementById("cup-trophees").checked,
          boss: cases().filter(c => c.checked).map(c => c.value)
        }
      });
      promessePointsAdmin = null;
      document.getElementById("titre-tuile-little-cup").textContent = config?.little_cup?.nom || "Little Cup";
      message("Enregistré.", "succes");
    } catch (erreur) {
      console.error(erreur);
      message(erreur.message, "erreur");
    }
    bouton.disabled = false;
  }

  chargerPointsAdmin().then(config => {
    if (config?.little_cup?.nom) document.getElementById("titre-tuile-little-cup").textContent = config.little_cup.nom;
  }).catch(console.error);
  document.getElementById("ouvrir-little-cup").addEventListener("click", ouvrir);
  document.getElementById("fermer-little-cup").addEventListener("click", fermer);
  document.getElementById("enregistrer-cup").addEventListener("click", enregistrer);
  document.getElementById("cup-tout").addEventListener("click", () => { cases().forEach(c => { c.checked = true; }); majCompte(); });
  document.getElementById("cup-aucun").addEventListener("click", () => { cases().forEach(c => { c.checked = false; }); majCompte(); });
  zoneBoss.addEventListener("change", majCompte);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
}

initialiserLittleCup();
