// Administration : valeurs alternatives d'une arme (bouton de la colonne
// « Valeur alt. » du tableau des armes, cf. commun/synergies.js) : « le
// reste » (tous les persos qui peuvent la porter) et autant de valeurs
// alternatives que voulu, chacune pour des persos choisis sur leur icône.
// Dans l'état de la page (alternatives, cf. admin_ppc.js) : enregistrées
// avec le bouton Enregistrer, comme les points.

let armeAlternative = null;
let groupeOuvert = null; // index du groupe dont le choix des persos est ouvert

// Persos qui peuvent porter l'arme ouverte (même type), sans celui de sa
// signature : clé signature (Voyageur : "traveler"), nom, perso.
function candidatsAlternative() {
  const proprietaire = trouverPersonnageSignature(armes, personnages, armeAlternative.id);
  const exclue = proprietaire ? proprietaire.groupe || proprietaire.id : null;
  const parCle = new Map();
  personnages.forEach(p => {
    const cle = p.groupe || p.id;
    if (p.arme !== armeAlternative.type || cle === exclue || parCle.has(cle)) return;
    parCle.set(cle, { cle, nom: p.groupe ? p.nom.replace(/\s+\S+$/, "") : p.nom, perso: p });
  });
  return [...parCle.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
}

function ouvrirAlternative(id) {
  armeAlternative = armes.find(a => a.id === id);
  if (!armeAlternative) return;
  groupeOuvert = null;
  document.getElementById("alternative-titre").textContent = armeAlternative.nom;
  document.getElementById("alternative-image").src = `../DB/${armeAlternative.image}`;
  document.getElementById("alternative-miniature").className = `apercu-miniature ${classeFondRarete(armeAlternative.rarete)}`;
  rendreAlternative();
  document.getElementById("modal-alternative").classList.add("active");
}

function fermerAlternative() {
  document.getElementById("modal-alternative").classList.remove("active");
  armeAlternative = null;
  rendreCorps();
}

// Valeurs alternatives de l'arme ouverte (copie modifiable), puis écriture
// dans l'état de la page.
function alternativeOuverte() {
  const a = alternativeArme(armeAlternative.id);
  return { reste: a.reste, groupes: a.groupes.map(g => ({ pourcentage: g.pourcentage, persos: [...g.persos] })) };
}

function ecrireAlternative(alternative) {
  changerAlternative(armeAlternative.id, alternative);
  rendreAlternative();
  mettreAJourPied();
}

function optionsPourcentage(choisi) {
  return POURCENTAGES_ALTERNATIFS.map(p => `<option value="${p}"${p === choisi ? " selected" : ""}>${textePourcentageAlternatif(p)} %</option>`).join("");
}

function rendreAlternative() {
  const alternative = alternativeOuverte();
  const candidats = candidatsAlternative();
  const parCle = new Map(candidats.map(c => [c.cle, c]));
  const r1 = valeurs.weapons[armeAlternative.id]?.[0] ?? 0;
  const proprietaire = trouverPersonnageSignature(armes, personnages, armeAlternative.id);
  const miniature = (c, differe = false) => `<span class="miniature ${classeFondRarete(c.perso.rarete)}"><img src="../DB/${c.perso.image}" alt=""${differe ? ' loading="lazy"' : ""}></span>`;

  document.getElementById("contenu-alternative").innerHTML = `
    <p class="aide-apercu">
      ${proprietaire ? `Sur ${echapperHtml(proprietaire.nom)} (sa signature) : toujours 100 %. ` : ""}R1 : ${r1} points.
      Une copie en double, ou l'arme sans ${proprietaire ? "son perso" : "propriétaire"} dans la box, vaut le pourcentage du perso qui la porte :
      celui de sa valeur alternative, sinon « le reste ». Dans les points d'une box, le meilleur des persos de la box qui peuvent la porter.
    </p>
    ${alternative.groupes.map((groupe, index) => `
      <div class="groupe-alternative">
        <div class="entete-groupe-alternative">
          <strong>Valeur alternative ${index + 1}</strong>
          <select class="action-alternative pourcentage-groupe" data-groupe="${index}" aria-label="Pourcentage">${optionsPourcentage(groupe.pourcentage)}</select>
          <span class="doux">R1 : ${Math.round(r1 * groupe.pourcentage / 100)}</span>
          <button type="button" class="btn-masquer action-alternative choisir-persos-groupe" data-groupe="${index}">${groupeOuvert === index ? "Fermer" : "Choisir les persos"}</button>
          <button type="button" class="btn-masquer action-alternative retirer-groupe" data-groupe="${index}" title="Retirer cette valeur alternative">Retirer</button>
        </div>
        <div class="persos-groupe-alternative">
          ${groupe.persos.map(cle => parCle.get(cle)).filter(Boolean).map(c => `<span class="perso-groupe-alternative" title="${echapperHtml(c.nom)}">${miniature(c)}</span>`).join("") || `<span class="doux">Aucun perso : choisis-en au moins un (sinon ignorée).</span>`}
        </div>
        ${groupeOuvert === index ? `
          <div class="choix-persos-alternative">
            ${candidats.map(c => `<button type="button" class="action-alternative perso-alternative${groupe.persos.includes(c.cle) ? " choisi" : ""}" data-groupe="${index}" data-cle="${echapperHtml(c.cle)}" title="${echapperHtml(c.nom)}">${miniature(c, true)}<span>${echapperHtml(c.nom)}</span></button>`).join("")}
          </div>` : ""}
      </div>`).join("")}
    <button type="button" class="bouton-creer secondaire action-alternative" id="ajouter-groupe-alternative">+ Ajouter une valeur alternative</button>
    <div class="groupe-alternative reste-alternative">
      <div class="entete-groupe-alternative">
        <strong>Le reste</strong>
        <select class="action-alternative" id="pourcentage-reste" aria-label="Pourcentage du reste">${optionsPourcentage(alternative.reste)}</select>
        <span class="doux">R1 : ${Math.round(r1 * alternative.reste / 100)} · tous les autres persos qui peuvent la porter</span>
      </div>
    </div>`;
}

function initialiserAlternative() {
  const modal = document.getElementById("modal-alternative");
  document.getElementById("fermer-alternative").addEventListener("click", fermerAlternative);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermerAlternative();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermerAlternative();
  });
  const contenu = document.getElementById("contenu-alternative");
  contenu.addEventListener("change", event => {
    const alternative = alternativeOuverte();
    if (event.target.id === "pourcentage-reste") alternative.reste = Number(event.target.value);
    else if (event.target.classList.contains("pourcentage-groupe")) alternative.groupes[Number(event.target.dataset.groupe)].pourcentage = Number(event.target.value);
    else return;
    ecrireAlternative(alternative);
  });
  contenu.addEventListener("click", event => {
    const bouton = event.target.closest("button");
    if (!bouton) return;
    const alternative = alternativeOuverte();
    const index = Number(bouton.dataset.groupe);
    if (bouton.id === "ajouter-groupe-alternative") {
      alternative.groupes.push({ pourcentage: 100, persos: [] });
      groupeOuvert = alternative.groupes.length - 1;
    } else if (bouton.classList.contains("retirer-groupe")) {
      alternative.groupes.splice(index, 1);
      groupeOuvert = null;
    } else if (bouton.classList.contains("choisir-persos-groupe")) {
      groupeOuvert = groupeOuvert === index ? null : index;
      rendreAlternative();
      return;
    } else if (bouton.classList.contains("perso-alternative")) {
      const persos = alternative.groupes[index].persos;
      const cle = bouton.dataset.cle;
      alternative.groupes[index].persos = persos.includes(cle) ? persos.filter(c => c !== cle) : [...persos, cle];
    } else {
      return;
    }
    ecrireAlternative(alternative);
  });
}

initialiserAlternative();
