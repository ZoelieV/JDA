// Administration : temps minimum de chaque boss pour l'anti-triche
// (config.temps_suspects, cf. commun/temps_suspects.js). Temps suspect ->
// danger 1, triche confirmée -> danger 2. Le serveur refuse les mini admins.
// Défis (score "ennemis", ex. Mer d'Antan) dans une section à part : seuils en
// nombre d'ennemis éliminés, au-dessus desquels le score est suspect.

function initialiserTempsSuspects() {
  const modal = document.getElementById("modal-temps-suspects");
  const liste = document.getElementById("ts-liste");
  const recherche = document.getElementById("ts-recherche");
  const seulementRegles = document.getElementById("ts-seulement-regles");
  let tous = [];
  // { <boss>: { suspect, triche } } en texte, tel que saisi.
  let saisie = {};
  let personnalise = false;
  let remisAZero = false;
  let modifie = false;

  const message = (texte, type = "") => {
    const e = document.getElementById("message-ts");
    e.textContent = texte;
    e.className = `message-ajout${type ? ` ${type}` : ""}`;
  };
  const enTexte = secondes => (Number.isInteger(secondes) ? (secondes >= 60 ? `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}` : String(secondes)) : "");
  // "1:40" ou "100" -> 100 ; "" -> null ; illisible -> NaN.
  function enSecondes(texte) {
    const t = String(texte ?? "").trim();
    if (!t) return null;
    const m = t.match(/^(?:(\d+):)?(\d+)$/);
    if (!m || (m[1] && Number(m[2]) > 59)) return NaN;
    return Number(m[1] || 0) * 60 + Number(m[2]);
  }
  const estDefi = id => tous.some(b => b.id === id && b.score === "ennemis");
  // Défi : un nombre entier d'ennemis, jamais de minutes.
  const lireValeur = (id, texte) => {
    if (!estDefi(id)) return enSecondes(texte);
    const t = String(texte ?? "").trim();
    if (!t) return null;
    return /^\d+$/.test(t) ? Number(t) : NaN;
  };
  const versSaisie = reglage => Object.fromEntries(Object.entries(reglage).map(([id, s]) => [id, estDefi(id)
    ? { suspect: s.suspect != null ? String(s.suspect) : "", triche: s.triche != null ? String(s.triche) : "" }
    : { suspect: enTexte(s.suspect), triche: enTexte(s.triche) }]));
  const aUnTemps = id => !!(saisie[id]?.suspect || saisie[id]?.triche);

  function rendreEtat() {
    document.getElementById("ts-etat").textContent = remisAZero ? "Valeurs par défaut (à enregistrer)." : personnalise ? "Réglage personnalisé." : "Valeurs par défaut.";
  }

  function rendre() {
    const filtre = recherche.value.trim().toLocaleLowerCase("fr");
    const visibles = tous.filter(b => (!filtre || b.nom.toLocaleLowerCase("fr").includes(filtre)) && (!seulementRegles.checked || aUnTemps(b.id)));
    const defis = visibles.filter(b => b.score === "ennemis");
    const htmlDefis = defis.length ? `
        <h3 class="titre-section-ajout">Défis (nombre d'ennemis éliminés)</h3>
        <p class="aide-apercu">Le plus grand score gagne : au-dessus du seuil, le score est suspect.</p>
        <table class="tableau-ts">
          <thead><tr><th>Défi</th><th title="Danger 1">Suspect au-dessus de</th><th title="Danger 2">Triche confirmée au-dessus de</th></tr></thead>
          <tbody>
            ${defis.map(b => `
              <tr>
                <td><span class="ts-boss"><img src="/DB/${echapper(b.image)}" alt="" loading="lazy"><span>${echapper(b.nom)}</span></span></td>
                ${["suspect", "triche"].map(champ => `<td><input type="text" inputmode="numeric" class="texte-ajout" data-boss="${echapper(b.id)}" data-champ="${champ}" value="${echapper(saisie[b.id]?.[champ] || "")}" placeholder="—" aria-label="${echapper(b.nom)} : ${champ === "suspect" ? "ennemis, seuil suspect" : "ennemis, triche confirmée"}"></td>`).join("")}
              </tr>`).join("")}
          </tbody>
        </table>` : "";
    liste.innerHTML = TYPES_TIRAGE_BOSS.map(({ id: type, nom }) => {
      const boss = visibles.filter(b => typeTirageBoss(b) === type && b.score !== "ennemis");
      if (!boss.length) return "";
      return `
        <h3 class="titre-section-ajout">${echapper(nom)}</h3>
        <table class="tableau-ts">
          <thead><tr><th>Boss</th><th title="Danger 1">Temps suspect</th><th title="Danger 2">Triche confirmée</th></tr></thead>
          <tbody>
            ${boss.map(b => {
              const defaut = TEMPS_SUSPECTS_DEFAUT[b.id];
              return `
              <tr>
                <td><span class="ts-boss"><img src="/DB/${echapper(b.image)}" alt="" loading="lazy"><span>${echapper(b.nom)}${defaut ? `<br><span class="ts-defaut">Défaut : ${enTexte(defaut.suspect)} / ${enTexte(defaut.triche)}</span>` : ""}</span></span></td>
                ${["suspect", "triche"].map(champ => `<td><input type="text" inputmode="numeric" class="texte-ajout" data-boss="${echapper(b.id)}" data-champ="${champ}" value="${echapper(saisie[b.id]?.[champ] || "")}" placeholder="—" aria-label="${echapper(b.nom)} : ${champ === "suspect" ? "temps suspect" : "triche confirmée"}"></td>`).join("")}
              </tr>`;
            }).join("")}
          </tbody>
        </table>`;
    }).join("") + htmlDefis || `<p class="aide-apercu">Aucun boss.</p>`;
    liste.querySelectorAll("input").forEach(marquerInvalide);
    rendreEtat();
  }

  function marquerInvalide(champ) {
    const id = champ.dataset.boss;
    const defi = estDefi(id);
    const v = lireValeur(id, champ.value);
    const ligne = saisie[id] || {};
    const suspect = lireValeur(id, ligne.suspect);
    const triche = lireValeur(id, ligne.triche);
    const max = defi ? ENNEMIS_SUSPECT_MAX : TEMPS_SUSPECT_MAX;
    const invalide = Number.isNaN(v) || (v !== null && (v < 1 || v > max))
      || (Number.isInteger(suspect) && Number.isInteger(triche) && (defi ? triche < suspect : triche > suspect));
    champ.classList.toggle("ts-invalide", invalide);
  }

  async function ouvrir() {
    modal.classList.add("active");
    message("Chargement…");
    try {
      const [config, boss] = await Promise.all([chargerPointsAdmin(), chargerBoss()]);
      // Valeurs par défaut : envoyées par le serveur aux administrateurs.
      Object.assign(TEMPS_SUSPECTS_DEFAUT, config?.temps_suspects_defaut || {});
      tous = boss;
      personnalise = !!config?.temps_suspects;
      saisie = versSaisie(reglageTempsSuspects(config));
      remisAZero = false;
      modifie = false;
      rendre();
      message("");
    } catch (erreur) {
      console.error(erreur);
      message("Impossible de charger les boss.", "erreur");
    }
  }

  async function enregistrer() {
    if (!modifie) return message("Rien à enregistrer.");
    let temps_suspects = null;
    if (!remisAZero) {
      temps_suspects = {};
      for (const [id, ligne] of Object.entries(saisie)) {
        const suspect = lireValeur(id, ligne.suspect);
        const triche = lireValeur(id, ligne.triche);
        if (Number.isNaN(suspect) || Number.isNaN(triche)) {
          const nom = tous.find(b => b.id === id)?.nom || id;
          return message(estDefi(id) ? `${nom} : nombre d'ennemis illisible (ex. 35).` : `${nom} : temps illisible (ex. 45 ou 1:40).`, "erreur");
        }
        if (suspect !== null || triche !== null) temps_suspects[id] = { suspect, triche };
      }
    }
    const bouton = document.getElementById("enregistrer-ts");
    bouton.disabled = true;
    message("Enregistrement…");
    try {
      const config = await envoyerAjout({ temps_suspects });
      promessePointsAdmin = null;
      personnalise = !!config?.temps_suspects;
      saisie = versSaisie(reglageTempsSuspects(config));
      remisAZero = false;
      modifie = false;
      rendre();
      message("Enregistré.", "succes");
    } catch (erreur) {
      console.error(erreur);
      message(erreur.message, "erreur");
    }
    bouton.disabled = false;
  }

  document.getElementById("ouvrir-temps-suspects").addEventListener("click", ouvrir);
  document.getElementById("fermer-temps-suspects").addEventListener("click", () => modal.classList.remove("active"));
  document.getElementById("enregistrer-ts").addEventListener("click", enregistrer);
  recherche.addEventListener("input", rendre);
  seulementRegles.addEventListener("change", rendre);
  liste.addEventListener("input", event => {
    const { boss, champ } = event.target.dataset;
    if (!boss) return;
    saisie[boss] = { ...(saisie[boss] || {}), [champ]: event.target.value };
    modifie = true;
    remisAZero = false;
    liste.querySelectorAll(`input[data-boss="${CSS.escape(boss)}"]`).forEach(marquerInvalide);
    rendreEtat();
    message("");
  });
  document.getElementById("ts-defaut").addEventListener("click", () => {
    saisie = versSaisie(TEMPS_SUSPECTS_DEFAUT);
    modifie = true;
    remisAZero = true;
    rendre();
    message("Valeurs par défaut : pense à enregistrer.");
  });
  modal.addEventListener("click", event => {
    if (event.target === modal) modal.classList.remove("active");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) modal.classList.remove("active");
  });
}

initialiserTempsSuspects();
