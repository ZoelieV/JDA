// Administration : boss de chaque mode de jeu et chances de tirage
// (config.boss_modes, cf. commun/boss_modes.js). Les changements de tous les
// modes sont gardés jusqu'à Enregistrer ; le serveur refuse les mini admins.

function initialiserBossModes() {
  const modal = document.getElementById("modal-boss-modes");
  const zoneBoss = document.getElementById("bm-boss");
  const caseParType = document.getElementById("bm-par-type");
  const zoneProbas = document.getElementById("bm-probas");
  let tous = [];
  let brouillons = {};
  let modeActif = MODES_TIRAGE_BOSS[0].id;
  // Modes à envoyer (null : retour aux valeurs par défaut).
  let modifies = new Set();
  let remisAZero = new Set();

  const message = (texte, type = "") => {
    const e = document.getElementById("message-bm");
    e.textContent = texte;
    e.className = `message-ajout${type ? ` ${type}` : ""}`;
  };
  const nomMode = id => MODES_TIRAGE_BOSS.find(m => m.id === id)?.nom || id;
  const brouillon = () => brouillons[modeActif];
  const bossDuMode = () => tous.filter(b => modeActif !== "equipe" || b.coop !== false);
  const pourcent = chance => `${(100 * chance).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
  const marquer = () => {
    modifies.add(modeActif);
    remisAZero.delete(modeActif);
    message("");
  };
  const versBrouillon = (reglage, personnalise) => ({ boss: new Set(reglage.boss), probas: reglage.probas ? { ...reglage.probas } : null, personnalise });

  // Chance de chaque boss et total des probabilités, sans tout redessiner.
  function majChances() {
    const { boss, probas } = brouillon();
    const chances = chancesBoss(bossDuMode().filter(b => boss.has(b.id)), probas);
    zoneBoss.querySelectorAll("[data-chance]").forEach(e => {
      const chance = chances.get(e.dataset.chance) || 0;
      e.textContent = chance > 0 ? pourcent(chance) : "—";
    });
    zoneBoss.querySelectorAll("[data-compte]").forEach(e => {
      const liste = bossDuMode().filter(b => typeTirageBoss(b) === e.dataset.compte);
      e.textContent = `(${liste.filter(b => boss.has(b.id)).length} / ${liste.length})`;
    });
    const total = document.getElementById("bm-total");
    if (!probas) return;
    const somme = Math.round(Object.values(probas).reduce((a, b) => a + (Number(b) || 0), 0) * 100) / 100;
    total.textContent = `Total : ${somme.toLocaleString("fr-FR")} %`;
    total.classList.toggle("bm-total-faux", Math.abs(somme - 100) > 0.011);
  }

  function rendreProbas() {
    const { probas } = brouillon();
    caseParType.checked = !!probas;
    zoneProbas.hidden = !probas;
    if (!probas) return;
    document.getElementById("bm-champs").innerHTML = TYPES_TIRAGE_BOSS.map(({ id, nom }) => `
      <label class="champ-compte">${echapper(nom)}
        <span class="bm-champ"><input type="number" class="texte-ajout" data-type="${id}" min="0" max="100" step="any" value="${Number(probas[id]) || 0}"> %</span>
      </label>`).join("");
  }

  function rendreBoss() {
    const { boss } = brouillon();
    zoneBoss.innerHTML = TYPES_TIRAGE_BOSS.map(({ id, nom }) => {
      const liste = bossDuMode().filter(b => typeTirageBoss(b) === id);
      if (!liste.length) return "";
      return `
        <h3 class="titre-section-ajout">${echapper(nom)} <span class="facultatif" data-compte="${id}"></span></h3>
        <div class="sommaire-actions-cup">
          <button type="button" class="btn-ouvrir-ajout" data-tout="${id}">Tout cocher</button>
          <button type="button" class="btn-ouvrir-ajout" data-rien="${id}">Tout décocher</button>
        </div>
        <div class="cup-boss">
          ${liste.map(b => `
            <label class="cup-un-boss">
              <input type="checkbox" value="${echapper(b.id)}"${boss.has(b.id) ? " checked" : ""}>
              <img src="/DB/${echapper(b.image)}" alt="" loading="lazy">
              <span class="bm-nom-boss">${echapper(b.nom)}</span>
              <span class="bm-chance" data-chance="${echapper(b.id)}"></span>
            </label>`).join("")}
        </div>`;
    }).join("");
  }

  function rendre() {
    document.getElementById("bm-modes").innerHTML = MODES_TIRAGE_BOSS.map(({ id, nom }) => `
      <label class="bm-mode${id === modeActif ? " actif" : ""}">
        <input type="radio" name="bm-mode" value="${id}"${id === modeActif ? " checked" : ""}> ${echapper(nom)}${modifies.has(id) ? " *" : ""}
      </label>`).join("");
    document.getElementById("bm-etat").textContent = brouillon().personnalise ? "Réglage personnalisé." : "Valeurs par défaut.";
    rendreProbas();
    rendreBoss();
    majChances();
  }

  async function ouvrir() {
    modal.classList.add("active");
    message("Chargement…");
    try {
      const [config, boss] = await Promise.all([chargerPointsAdmin(), chargerBoss()]);
      tous = boss;
      brouillons = Object.fromEntries(MODES_TIRAGE_BOSS.map(({ id }) => [id,
        versBrouillon(reglageBossMode(id, config?.boss_modes, tous, config?.little_cup), !!config?.boss_modes?.[id])]));
      modifies = new Set();
      remisAZero = new Set();
      rendre();
      message("");
    } catch (erreur) {
      console.error(erreur);
      message("Impossible de charger les boss.", "erreur");
    }
  }

  async function enregistrer() {
    if (!modifies.size) return message("Rien à enregistrer.");
    const bouton = document.getElementById("enregistrer-bm");
    bouton.disabled = true;
    message("Enregistrement…");
    try {
      const boss_modes = Object.fromEntries([...modifies].map(id => [id, remisAZero.has(id) ? null : {
        boss: [...brouillons[id].boss],
        probas: brouillons[id].probas
      }]));
      const config = await envoyerAjout({ boss_modes });
      promessePointsAdmin = null;
      [...modifies].forEach(id => { brouillons[id] = versBrouillon(reglageBossMode(id, config?.boss_modes, tous, config?.little_cup), !!config?.boss_modes?.[id]); });
      modifies = new Set();
      remisAZero = new Set();
      rendre();
      message("Enregistré.", "succes");
    } catch (erreur) {
      console.error(erreur);
      message(erreur.message, "erreur");
    }
    bouton.disabled = false;
  }

  function cocherType(type, coche) {
    bossDuMode().filter(b => typeTirageBoss(b) === type).forEach(b => {
      if (coche) brouillon().boss.add(b.id);
      else brouillon().boss.delete(b.id);
    });
    zoneBoss.querySelectorAll("input").forEach(c => { c.checked = brouillon().boss.has(c.value); });
    marquer();
    majChances();
  }

  document.getElementById("ouvrir-boss-modes").addEventListener("click", ouvrir);
  document.getElementById("fermer-boss-modes").addEventListener("click", () => modal.classList.remove("active"));
  document.getElementById("enregistrer-bm").addEventListener("click", enregistrer);
  document.getElementById("bm-modes").addEventListener("change", event => {
    modeActif = event.target.value;
    rendre();
  });
  caseParType.addEventListener("change", () => {
    brouillon().probas = caseParType.checked ? { ...PROBAS_TIRAGE_DEFAUT } : null;
    marquer();
    rendreProbas();
    majChances();
  });
  document.getElementById("bm-champs").addEventListener("input", event => {
    brouillon().probas[event.target.dataset.type] = Number(event.target.value) || 0;
    marquer();
    majChances();
  });
  zoneBoss.addEventListener("change", event => {
    if (event.target.checked) brouillon().boss.add(event.target.value);
    else brouillon().boss.delete(event.target.value);
    marquer();
    majChances();
  });
  zoneBoss.addEventListener("click", event => {
    const { tout, rien } = event.target.dataset;
    if (tout) cocherType(tout, true);
    if (rien) cocherType(rien, false);
  });
  document.getElementById("bm-defaut").addEventListener("click", () => {
    brouillons[modeActif] = versBrouillon(reglageBossMode(modeActif, null, tous), false);
    modifies.add(modeActif);
    remisAZero.add(modeActif);
    rendre();
    message(`${nomMode(modeActif)} : valeurs par défaut, pense à enregistrer.`);
  });
  modal.addEventListener("click", event => {
    if (event.target === modal) modal.classList.remove("active");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) modal.classList.remove("active");
  });
}

initialiserBossModes();
