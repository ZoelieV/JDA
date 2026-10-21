// Administration : recommandations de la box stuff (bouton Recommandations,
// cf. commun/recommandations_stuff.js) : une ligne par DPS, ses supports
// par priorité et leur constellation minimale. Tout se modifie ici puis
// s'enregistre d'un coup (config.recommandations_stuff, cf. api/points.js) ;
// "Valeurs par défaut" recharge DB/recommandations_stuff.json (tiré de la
// feuille "box stuff") sans enregistrer.

let reglesReco = [];        // règles en cours d'édition
let reglesRecoEnregistrees = "";
let dpsRecoOuverts = new Set();

const recoModifiees = () => JSON.stringify(reglesReco) !== reglesRecoEnregistrees;

function nomPersoReco(id) {
  return personnages.find(p => p.id === id)?.nom || id;
}

function miniatureReco(id) {
  const perso = personnages.find(p => p.id === id);
  return perso ? `<span class="miniature ${classeFondRarete(perso.rarete)}"><img src="../DB/${perso.image}" alt="" loading="lazy"></span>` : "";
}

// Persos proposables (tri par nom), sans ceux déjà pris.
function optionsPersosReco(exclus) {
  return [...personnages]
    .filter(p => !exclus.has(p.id))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }))
    .map(p => `<option value="${echapperHtml(p.id)}">${echapperHtml(p.nom)}</option>`).join("");
}

function messageReco(texte, type = "") {
  const message = document.getElementById("message-recommandations");
  message.className = `message-ajout${type ? ` ${type}` : ""}`;
  message.textContent = texte;
}

function rendreReco() {
  const options = c => `<option value="0"${!c ? " selected" : ""}>—</option>` +
    [1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${c === n ? " selected" : ""}>C${n}+</option>`).join("");

  document.getElementById("liste-recommandations").innerHTML = reglesReco.map((ligne, i) => `
    <details class="ligne-reco" data-ligne="${i}"${dpsRecoOuverts.has(ligne.dps) ? " open" : ""}>
      <summary>
        ${miniatureReco(ligne.dps)}
        <strong>${echapperHtml(nomPersoReco(ligne.dps))}</strong>
        <span class="details-boss">${ligne.supports.length} support${ligne.supports.length > 1 ? "s" : ""}</span>
        <button type="button" class="btn-masquer action-reco retirer-dps-reco" title="Retirer ce DPS et ses supports">Retirer le DPS</button>
      </summary>
      <ol class="supports-reco">
        ${ligne.supports.map((s, j) => `
          <li data-support="${j}">
            <span class="rang-reco">${j + 1}</span>
            ${miniatureReco(s.id)}
            <span class="nom-reco">${echapperHtml(nomPersoReco(s.id))}</span>
            <select class="constellation-reco" title="Constellation minimale : pas compté en dessous">${options(s.constellation_min)}</select>
            <button type="button" class="btn-masquer action-reco monter-reco" title="Monter en priorité"${j === 0 ? " disabled" : ""}>↑</button>
            <button type="button" class="btn-masquer action-reco descendre-reco" title="Descendre en priorité"${j === ligne.supports.length - 1 ? " disabled" : ""}>↓</button>
            <button type="button" class="btn-masquer action-reco retirer-reco" title="Retirer ce support">×</button>
          </li>`).join("")}
      </ol>
      <div class="ajout-synergie">
        <select class="choix-support-reco" aria-label="Support à ajouter">${optionsPersosReco(new Set([ligne.dps, ...ligne.supports.map(s => s.id)]))}</select>
        <button type="button" class="bouton-creer action-reco ajouter-support-reco">Ajouter le support</button>
      </div>
    </details>`).join("");

  document.getElementById("choix-dps-reco").innerHTML = optionsPersosReco(new Set(reglesReco.map(l => l.dps)));
  document.getElementById("compte-recommandations").textContent =
    `${reglesReco.length} DPS, ${reglesReco.reduce((n, l) => n + l.supports.length, 0)} supports`;
  document.getElementById("enregistrer-recommandations").disabled = !recoModifiees();
}

async function ouvrirReco() {
  document.getElementById("modal-recommandations").classList.add("active");
  messageReco("");
  if (!reglesRecoEnregistrees) {
    const config = await chargerPointsAdmin();
    reglesReco = lireRecommandationsStuff(config?.recommandations_stuff);
    reglesRecoEnregistrees = JSON.stringify(reglesReco);
  }
  rendreReco();
}

function fermerReco() {
  if (recoModifiees() && !confirm("Fermer sans enregistrer les recommandations ?")) return;
  if (recoModifiees()) reglesReco = JSON.parse(reglesRecoEnregistrees);
  document.getElementById("modal-recommandations").classList.remove("active");
}

function initialiserReco() {
  const modal = document.getElementById("modal-recommandations");
  document.getElementById("ouvrir-recommandations").addEventListener("click", ouvrirReco);
  document.getElementById("fermer-recommandations").addEventListener("click", fermerReco);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermerReco();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermerReco();
  });

  const liste = document.getElementById("liste-recommandations");
  // DPS dépliés gardés d'un rendu à l'autre.
  liste.addEventListener("toggle", event => {
    const ligne = reglesReco[Number(event.target.dataset.ligne)];
    if (!ligne) return;
    if (event.target.open) dpsRecoOuverts.add(ligne.dps);
    else dpsRecoOuverts.delete(ligne.dps);
  }, true);

  liste.addEventListener("click", event => {
    const bouton = event.target.closest(".action-reco");
    if (!bouton) return;
    event.preventDefault();
    const ligne = reglesReco[Number(bouton.closest(".ligne-reco").dataset.ligne)];
    const j = Number(bouton.closest("[data-support]")?.dataset.support);
    if (bouton.classList.contains("retirer-dps-reco")) {
      if (!confirm(`Retirer ${nomPersoReco(ligne.dps)} et ses supports ?`)) return;
      reglesReco = reglesReco.filter(l => l !== ligne);
    } else if (bouton.classList.contains("ajouter-support-reco")) {
      const id = bouton.parentElement.querySelector(".choix-support-reco").value;
      if (id) ligne.supports.push({ id });
    } else if (bouton.classList.contains("retirer-reco")) {
      ligne.supports.splice(j, 1);
    } else if (bouton.classList.contains("monter-reco") || bouton.classList.contains("descendre-reco")) {
      const k = bouton.classList.contains("monter-reco") ? j - 1 : j + 1;
      [ligne.supports[j], ligne.supports[k]] = [ligne.supports[k], ligne.supports[j]];
    }
    rendreReco();
  });

  liste.addEventListener("change", event => {
    const select = event.target.closest(".constellation-reco");
    if (!select) return;
    const ligne = reglesReco[Number(select.closest(".ligne-reco").dataset.ligne)];
    const support = ligne.supports[Number(select.closest("[data-support]").dataset.support)];
    const constellation = Number(select.value);
    if (constellation) support.constellation_min = constellation;
    else delete support.constellation_min;
    rendreReco();
  });

  document.getElementById("ajouter-dps-reco").addEventListener("click", () => {
    const id = document.getElementById("choix-dps-reco").value;
    if (!id) return;
    reglesReco.push({ dps: id, supports: [] });
    dpsRecoOuverts.add(id);
    rendreReco();
  });

  document.getElementById("defaut-recommandations").addEventListener("click", async () => {
    if (!confirm("Remplacer par les valeurs par défaut (feuille « box stuff ») ? Rien n'est enregistré avant « Enregistrer ».")) return;
    try {
      const reponse = await fetch("../DB/recommandations_stuff.json", { cache: "no-store" });
      reglesReco = lireRecommandationsStuff(await reponse.json());
      rendreReco();
      messageReco("Valeurs par défaut chargées : clique sur Enregistrer pour les appliquer.");
    } catch (erreur) {
      console.error(erreur);
      messageReco("Impossible de charger les valeurs par défaut.", "erreur");
    }
  });

  document.getElementById("enregistrer-recommandations").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    messageReco("Enregistrement…");
    try {
      const config = await envoyerAjout({ recommandations_stuff: reglesReco });
      reglesReco = lireRecommandationsStuff(config.recommandations_stuff);
      reglesRecoEnregistrees = JSON.stringify(reglesReco);
      messageReco("Recommandations enregistrées : elles s'appliquent à la box stuff de tous les joueurs.", "succes");
    } catch (erreur) {
      console.error(erreur);
      messageReco(erreur.message, "erreur");
    }
    rendreReco();
  });
}

initialiserReco();
