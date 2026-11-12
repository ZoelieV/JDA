// Administration : raretés du tirage (config.cosmetiques_raretes : rare,
// épique ; légendaire = cosmétiques focus, config.cosmetiques_tirage ; chances :
// config.probas_tirage) et tri des fonds d'écran (config.cosmetiques_retires :
// fonds plus utilisables, même par ceux qui les possèdent ; cf. api/_lib/koyns.js).
// Mini admins : le serveur refuse.

function initialiserRaretes() {
  const NOMS = { commun: "Commun", rare: "Rare", epique: "Épique", legendaire: "Légendaire" };
  const modal = document.getElementById("modal-raretes");
  const champRare = document.getElementById("proba-rare");
  const champEpique = document.getElementById("proba-epique");
  const champLegendaire = document.getElementById("proba-legendaire");
  let raretes = {};
  // Focus du tirage : légendaires (rareté enregistrée ignorée tant qu'ils le sont).
  let focus = [];
  const rareteDe = id => (focus.includes(id) ? "legendaire" : raretes[id] || "commun");

  const message = (texte, type = "") => {
    const e = document.getElementById("message-raretes");
    e.textContent = texte;
    e.className = `message-ajout${type ? ` ${type}` : ""}`;
  };
  const majCommun = () => {
    const reste = 100 - Number(champRare.value) - Number(champEpique.value) - Number(champLegendaire.value);
    document.getElementById("proba-commun").textContent = `${Math.round(reste * 100) / 100} %`;
  };
  const deRarete = niveau => Object.keys(raretes).filter(id => raretes[id] === niveau && !focus.includes(id));
  const majBoutons = () => {
    document.getElementById("choisir-rares").textContent = `Choisir les rares (${deRarete("rare").length})`;
    document.getElementById("choisir-epiques").textContent = `Choisir les épiques (${deRarete("epique").length})`;
    document.getElementById("choisir-legendaires").textContent = `Choisir les légendaires, focus (${focus.length})`;
  };
  const relire = donnees => {
    raretes = { ...(donnees.cosmetiques_raretes || {}) };
    focus = [...(donnees.cosmetiques_tirage || [])];
    promessePointsAdmin = null;
    promesseCatalogueChoix = null;
    catalogueChoixCosmetiques = null;
    majBoutons();
  };

  async function ouvrir() {
    modal.classList.add("active");
    message("Chargement…");
    try {
      const config = await chargerPointsAdmin();
      raretes = { ...(config?.cosmetiques_raretes || {}) };
      focus = [...(config?.cosmetiques_tirage || [])];
      champRare.value = config?.probas_tirage?.rare ?? 25;
      champEpique.value = config?.probas_tirage?.epique ?? 10;
      champLegendaire.value = config?.probas_tirage?.legendaire ?? 3.33;
      majCommun();
      majBoutons();
      message("");
    } catch (erreur) {
      console.error(erreur);
      message("Impossible de charger les réglages.", "erreur");
    }
  }

  async function choisir(niveau) {
    const choix = await choisirCosmetiques({
      titre: `Sélectionne les cosmétiques ${niveau === "rare" ? "rares" : "épiques"}`,
      selection: deRarete(niveau),
      onglets: ["banniere", "banniere2", "fond"],
      exclure: id => focus.includes(id),
      etiquette: id => NOMS[rareteDe(id)],
      rarete: rareteDe
    });
    if (!choix) return;
    message("Enregistrement…");
    try {
      relire(await envoyerAjout({ cosmetiques_raretes: { niveau, ids: choix } }));
      message("Enregistré.", "succes");
    } catch (erreur) {
      message(erreur.message, "erreur");
    }
  }

  document.getElementById("ouvrir-raretes").addEventListener("click", ouvrir);
  document.getElementById("fermer-raretes").addEventListener("click", () => modal.classList.remove("active"));
  modal.addEventListener("click", event => { if (event.target === modal) modal.classList.remove("active"); });
  champRare.addEventListener("input", majCommun);
  champEpique.addEventListener("input", majCommun);
  champLegendaire.addEventListener("input", majCommun);
  document.getElementById("choisir-rares").addEventListener("click", () => choisir("rare"));
  document.getElementById("choisir-epiques").addEventListener("click", () => choisir("epique"));
  // Légendaires = focus du tirage (mêmes que la sélection des focus de la fenêtre Rikoyns).
  document.getElementById("choisir-legendaires").addEventListener("click", async () => {
    const choix = await choisirCosmetiques({
      titre: "Sélectionne les cosmétiques légendaires (focus du tirage)",
      selection: focus,
      onglets: ["banniere", "banniere2", "fond"],
      etiquette: id => NOMS[rareteDe(id)],
      rarete: rareteDe
    });
    if (!choix) return;
    message("Enregistrement…");
    try {
      relire(await envoyerAjout({ cosmetiques_tirage: choix }));
      message("Enregistré.", "succes");
    } catch (erreur) {
      message(erreur.message, "erreur");
    }
  });
  document.getElementById("enregistrer-probas").addEventListener("click", async () => {
    message("Enregistrement…");
    try {
      relire(await envoyerAjout({ probas_tirage: { rare: Number(champRare.value), epique: Number(champEpique.value), legendaire: Number(champLegendaire.value) } }));
      message("Enregistré.", "succes");
    } catch (erreur) {
      message(erreur.message, "erreur");
    }
  });

  // Tri des fonds d'écran.
  const texteTri = document.getElementById("texte-tri-fonds");
  document.getElementById("ouvrir-tri-fonds").addEventListener("click", async () => {
    const config = await chargerPointsAdmin().catch(() => null);
    if (!config) return void (texteTri.textContent = "Impossible de charger les fonds d'écran.");
    const choix = await choisirCosmetiques({
      titre: "Sélectionne les fonds d'écran à retirer du site",
      selection: config.cosmetiques_retires || [],
      onglets: ["fond"],
      avecRetires: true,
      apercu: true
    });
    if (!choix) return;
    texteTri.textContent = "Enregistrement…";
    try {
      relire(await envoyerAjout({ cosmetiques_retires: choix }));
      texteTri.textContent = `${choix.length} fond${choix.length > 1 ? "s" : ""} d'écran retiré${choix.length > 1 ? "s" : ""}.`;
    } catch (erreur) {
      texteTri.textContent = erreur.message;
    }
  });
}

initialiserRaretes();
