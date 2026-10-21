// Administration : synergie d'un personnage (bouton "Synergie" du tableau,
// cf. commun/synergies.js) : persos en synergie et malus sans eux, dans
// l'état de la page (synergies, cf. admin_ppc.js) : enregistrés avec le
// bouton Enregistrer, comme les points.

let persoSynergie = null;
// Malus en cours de saisie : gardé même sans perso en synergie (la
// synergie n'est enregistrée qu'avec au moins un perso).
let malusSynergieSaisi = 0;

// Persos proposables : ids de la draft (Voyageur : un seul, "traveler").
function candidatsSynergie() {
  const parId = new Map();
  personnages.forEach(p => {
    const id = p.groupe || p.id;
    if (!parId.has(id)) parId.set(id, { id, nom: p.groupe ? p.nom.replace(/\s+\S+$/, "") : p.nom, perso: p });
  });
  return [...parId.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
}

function ouvrirSynergie(id) {
  persoSynergie = personnages.find(p => p.id === id);
  if (!persoSynergie) return;
  malusSynergieSaisi = synergies[id]?.malus ?? 0;
  document.getElementById("synergie-titre").textContent = persoSynergie.nom;
  document.getElementById("synergie-image").src = `../DB/${persoSynergie.image}`;
  document.getElementById("synergie-miniature").className = `apercu-miniature ${classeFondRarete(persoSynergie.rarete)}`;
  rendreSynergie();
  document.getElementById("modal-synergie").classList.add("active");
}

function fermerSynergie() {
  document.getElementById("modal-synergie").classList.remove("active");
  persoSynergie = null;
  rendreCorps();
}

// Persos en synergie du perso ouvert, puis enregistrement dans l'état (sans
// perso : synergie retirée).
function persosSynergie() {
  return synergies[persoSynergie.id]?.persos || [];
}

function ecrireSynergie(persos) {
  if (persos.length) synergies[persoSynergie.id] = { persos, malus: malusSynergieSaisi };
  else delete synergies[persoSynergie.id];
  rendreSynergie();
  mettreAJourPied();
}

function rendreSynergie() {
  const id = persoSynergie.id;
  const persos = persosSynergie();
  const candidats = candidatsSynergie();
  const parId = new Map(candidats.map(c => [c.id, c]));
  const soi = persoSynergie.groupe || id;

  const c0 = valeurs.characters[id]?.[0] ?? 0;
  const arme = armeSignature(persoSynergie);
  const signa = arme ? valeurs.weapons[arme.id]?.[0] ?? 0 : 0;
  const alternative = points => Math.max(0, points - malusSynergieSaisi);
  const parAbsent = persos.length ? Math.round(malusSynergieSaisi / persos.length) : 0;

  document.getElementById("contenu-synergie").innerHTML = `
    <table class="apercu-tableau tableau-synergie">
      <thead><tr><th></th><th>C0</th><th>C0R1${arme ? ` <span class="avec-theatre">(${echapperHtml(arme.nom)} R1 : ${signa})</span>` : ""}</th></tr></thead>
      <tbody>
        <tr><th>Normal</th><td>${c0}</td><td>${c0 + signa}</td></tr>
        <tr class="ligne-alternative"><th>Sans aucun perso en synergie</th><td>${alternative(c0)}</td><td>${alternative(c0) + signa}</td></tr>
      </tbody>
    </table>
    <label class="malus-synergie">Malus (sans aucun perso en synergie) :
      <input type="number" min="0" step="1" id="malus-synergie" value="${malusSynergieSaisi}">
    </label>
    <h3 class="titre-section-ajout">Persos en synergie (${persos.length})${persos.length ? ` <span class="facultatif">−${parAbsent} par perso absent de la box</span>` : ""}</h3>
    <ul class="liste-synergie">
      ${persos.map(p => {
        const c = parId.get(p);
        return `<li>
          ${c ? `<span class="miniature ${classeFondRarete(c.perso.rarete)}"><img src="../DB/${c.perso.image}" alt="" loading="lazy"></span>` : ""}
          <span class="nom-synergie">${echapperHtml(c?.nom || p)}</span>
          <button type="button" class="btn-masquer action-synergie retirer-synergie" data-id="${echapperHtml(p)}" title="Retirer de la synergie">Retirer</button>
        </li>`;
      }).join("") || `<li class="aucune-synergie">Aucun : le perso n'a pas de valeur alternative.</li>`}
    </ul>
    <div class="ajout-synergie">
      <select id="choix-synergie" aria-label="Perso à ajouter">
        ${candidats.filter(c => c.id !== soi && !persos.includes(c.id))
          .map(c => `<option value="${echapperHtml(c.id)}">${echapperHtml(c.nom)}</option>`).join("")}
      </select>
      <button type="button" class="bouton-creer action-synergie" id="ajouter-synergie">Ajouter</button>
    </div>`;
}

function initialiserSynergie() {
  const modal = document.getElementById("modal-synergie");
  document.getElementById("fermer-synergie").addEventListener("click", fermerSynergie);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermerSynergie();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermerSynergie();
  });

  const contenu = document.getElementById("contenu-synergie");
  contenu.addEventListener("click", event => {
    if (event.target.closest("#ajouter-synergie")) {
      const choix = document.getElementById("choix-synergie").value;
      if (choix) ecrireSynergie([...persosSynergie(), choix]);
      return;
    }
    const retirer = event.target.closest(".retirer-synergie");
    if (retirer) ecrireSynergie(persosSynergie().filter(p => p !== retirer.dataset.id));
  });
  // Malus : entier positif, appliqué à la sortie du champ (ou Entrée).
  contenu.addEventListener("keydown", event => {
    if (event.target.id === "malus-synergie" && event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
    }
  });
  contenu.addEventListener("focusout", event => {
    if (event.target.id !== "malus-synergie" || !persoSynergie) return;
    const malus = Math.round(Number(event.target.value));
    malusSynergieSaisi = Number.isFinite(malus) && malus >= 0 ? malus : malusSynergieSaisi;
    ecrireSynergie(persosSynergie());
  });
}
