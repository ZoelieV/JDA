// Administration : event Little Cup (config.little_cup, cf. api/points.js) :
// nom, namecard, ouverture à tous, trophées à part (boss : admin_boss_modes.js). Enregistré avec le
// bouton de la fenêtre ; le serveur refuse les mini admins.

const NAMECARD_LITTLE_CUP_DEFAUT = "namecards/Namecard_Background_Achievement_Orbits.webp";

function initialiserLittleCup() {
  let namecard = NAMECARD_LITTLE_CUP_DEFAUT;
  const majNamecard = () => { document.getElementById("cup-namecard").src = encodeURI(`/DB/images/${namecard}`); };
  const modal = document.getElementById("modal-little-cup");
  const message = (texte, type = "") => {
    const e = document.getElementById("message-cup");
    e.textContent = texte;
    e.className = `message-ajout${type ? ` ${type}` : ""}`;
  };
  const fermer = () => modal.classList.remove("active");

  async function ouvrir() {
    modal.classList.add("active");
    message("Chargement…");
    try {
      const config = await chargerPointsAdmin();
      const cup = config?.little_cup || {};
      document.getElementById("cup-nom").value = cup.nom || "Little Cup";
      document.getElementById("cup-public").checked = cup.public === true;
      document.getElementById("cup-trophees").checked = cup.trophees === true;
      namecard = cup.namecard || NAMECARD_LITTLE_CUP_DEFAUT;
      majNamecard();
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
          namecard
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
  document.getElementById("cup-choisir-namecard").addEventListener("click", async () => {
    const choix = await choisirCosmetiques({ titre: "Namecard de l'event", multiple: false, onglets: ["banniere"], selection: [idCosmetique("banniere", namecard)] });
    if (!choix?.length) return;
    namecard = choix[0].replace(/^banniere:/, "");
    majNamecard();
    message("Namecard choisie : pense à enregistrer.");
  });
  document.getElementById("ouvrir-little-cup").addEventListener("click", ouvrir);
  document.getElementById("fermer-little-cup").addEventListener("click", fermer);
  document.getElementById("enregistrer-cup").addEventListener("click", enregistrer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
}

initialiserLittleCup();
