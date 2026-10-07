// Comparateur : combos "personnage + arme" (constellation, niveau, buff
// théâtre, arme du type du personnage et raffinement au choix), total des
// points de chaque combo et écart avec le meilleur. Points et modes en cours
// d'édition sur la page (valeurs, modes : admin_ppc.js), même calcul que sur
// le reste du site (cf. pointsPersonnage, commun/cartes.js).
// Utilise echapper (admin_ajout.js).

const NIVEAUX_COMPARATEUR = [90, 95, 100];

let combos = [];

// Bonus en multiplication à 0 : pas de bonus (comme commun/cartes.js).
function bonusComparateur(points, cle, valeur) {
  const bonus = Number(valeur ?? 0);
  if (modes[cle] === "multiplication") return bonus ? points * bonus : points;
  return points + bonus;
}

function pointsPersoCombo(combo) {
  const liste = valeurs.characters[combo.perso] || [];
  let points = Number(liste[combo.constellation] ?? 0);
  if (combo.niveau === 95) points = bonusComparateur(points, "niveau95", liste[7]);
  if (combo.niveau === 100) points = bonusComparateur(points, "niveau100", liste[8]);
  if (combo.theatre) points = bonusComparateur(points, "theatre", liste[9]);
  return Math.round(points);
}

function pointsArmeCombo(combo) {
  return Number(valeurs.weapons[combo.arme]?.[combo.raffinement] ?? 0);
}

function totalCombo(combo) {
  return pointsPersoCombo(combo) + pointsArmeCombo(combo);
}

const parNom = (a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" });

// Armes du type du personnage : 5★, puis 4★, 3★..., par nom.
function armesDuType(type) {
  return armes
    .filter(arme => arme.type === type)
    .sort((a, b) => (Number(b.rarete) - Number(a.rarete)) || parNom(a, b));
}

// Arme par défaut d'un personnage : sa signature, sinon la 1re de son type.
function armeParDefaut(perso) {
  const signature = trouverArmeSignature(armes, perso);
  if (signature && signature.type === perso.arme) return signature.id;
  return armesDuType(perso.arme)[0]?.id ?? null;
}

function nouveauCombo(perso) {
  return { perso: perso.id, constellation: 0, niveau: 90, theatre: false, arme: armeParDefaut(perso), raffinement: 0 };
}

// Combos dont le personnage ou l'arme n'existe plus : retirés / corrigés.
function nettoyerCombos() {
  combos = combos.filter(combo => personnages.some(p => p.id === combo.perso));
  combos.forEach(combo => {
    const perso = personnages.find(p => p.id === combo.perso);
    if (!armes.some(a => a.id === combo.arme && a.type === perso.arme)) combo.arme = armeParDefaut(perso);
  });
  const premier = [...personnages].sort(parNom)[0];
  while (premier && combos.length < 2) combos.push(nouveauCombo(premier));
}

function boutonsChoix(index, champ, options) {
  return options.map(([valeur, libelle]) => `
    <button type="button" class="mode-modificateur${combos[index][champ] === valeur ? " active" : ""}" data-index="${index}" data-champ="${champ}" data-valeur="${valeur}">${libelle}</button>`).join("");
}

function formaterEcart(ecart, meilleur) {
  const pourcentage = meilleur ? Math.round((ecart / meilleur) * 1000) / 10 : null;
  return `−${ecart} pts${pourcentage !== null ? ` (−${String(pourcentage).replace(".", ",")} %)` : ""}`;
}

function rendreComparateur() {
  const totaux = combos.map(totalCombo);
  const meilleur = Math.max(...totaux);
  const persosTries = [...personnages].sort(parNom);

  document.getElementById("liste-comparateur").innerHTML = combos.map((combo, index) => {
    const perso = personnages.find(p => p.id === combo.perso);
    const arme = armes.find(a => a.id === combo.arme);
    const ecart = meilleur - totaux[index];
    return `
      <div class="combo-comparateur${ecart === 0 && combos.length > 1 ? " meilleur" : ""}">
        <div class="entete-combo">
          <span class="miniature-combo ${classeFondRarete(perso.rarete)}"><img src="../DB/${echapper(perso.image)}" alt=""></span>
          <select class="champ-comparateur" data-index="${index}" data-champ="perso" title="Personnage">
            ${persosTries.map(p => `<option value="${echapper(p.id)}"${p.id === perso.id ? " selected" : ""}>${echapper(p.nom)}</option>`).join("")}
          </select>
          <button type="button" class="retirer-combo" data-index="${index}" title="Retirer ce combo" ${combos.length > 1 ? "" : "disabled"}>×</button>
        </div>
        <div class="choix-combo">${boutonsChoix(index, "constellation", [0, 1, 2, 3, 4, 5, 6].map(c => [c, `C${c}`]))}</div>
        <div class="choix-combo">
          ${boutonsChoix(index, "niveau", NIVEAUX_COMPARATEUR.map(n => [n, `Niv. ${n}`]))}
          <button type="button" class="mode-modificateur bascule-theatre${combo.theatre ? " active" : ""}" data-index="${index}" title="Buff du théâtre">Théâtre</button>
        </div>
        <div class="entete-combo">
          <span class="miniature-combo ${arme ? classeFondRarete(arme.rarete) : ""}">${arme ? `<img src="../DB/${echapper(arme.image)}" alt="">` : ""}</span>
          <select class="champ-comparateur" data-index="${index}" data-champ="arme" title="Arme (${echapper(perso.arme)})">
            ${armesDuType(perso.arme).map(a => `<option value="${echapper(a.id)}"${a.id === combo.arme ? " selected" : ""}>${echapper(a.nom)} (${echapper(a.rarete)}★)</option>`).join("")}
          </select>
        </div>
        <div class="choix-combo">${boutonsChoix(index, "raffinement", [0, 1, 2, 3, 4].map(r => [r, `R${r + 1}`]))}</div>
        <div class="points-combo">
          <span>${pointsPersoCombo(combo)} <span class="detail-points">perso</span></span>
          <span>+</span>
          <span>${pointsArmeCombo(combo)} <span class="detail-points">arme</span></span>
          <span>=</span>
          <strong class="total-combo">${totaux[index]}</strong>
        </div>
        <div class="ecart-combo">${combos.length < 2 ? "" : ecart === 0 ? "Meilleur combo" : formaterEcart(ecart, meilleur)}</div>
      </div>`;
  }).join("") + `
    <button type="button" id="ajouter-combo" class="ajouter-combo" title="Ajouter un combo perso + arme">+</button>`;
}

function initialiserComparateur() {
  const modal = document.getElementById("modal-comparateur");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-comparateur").addEventListener("click", () => {
    nettoyerCombos();
    rendreComparateur();
    modal.classList.add("active");
  });
  document.getElementById("fermer-comparateur").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });

  const liste = document.getElementById("liste-comparateur");
  liste.addEventListener("change", event => {
    const select = event.target.closest(".champ-comparateur");
    if (!select) return;
    const combo = combos[Number(select.dataset.index)];
    if (select.dataset.champ === "perso") {
      const perso = personnages.find(p => p.id === select.value);
      const ancien = personnages.find(p => p.id === combo.perso);
      combo.perso = perso.id;
      // Même type d'arme : l'arme choisie est gardée.
      if (ancien?.arme !== perso.arme) combo.arme = armeParDefaut(perso);
    } else {
      combo.arme = select.value;
    }
    rendreComparateur();
  });
  liste.addEventListener("click", event => {
    const choix = event.target.closest(".choix-combo .mode-modificateur");
    if (choix) {
      const combo = combos[Number(choix.dataset.index)];
      if (choix.classList.contains("bascule-theatre")) combo.theatre = !combo.theatre;
      else combo[choix.dataset.champ] = Number(choix.dataset.valeur);
      rendreComparateur();
      return;
    }
    const retirer = event.target.closest(".retirer-combo");
    if (retirer && combos.length > 1) {
      combos.splice(Number(retirer.dataset.index), 1);
      rendreComparateur();
      return;
    }
    // Nouveau combo : copie du dernier, à modifier.
    if (event.target.closest("#ajouter-combo")) {
      combos.push({ ...combos[combos.length - 1] });
      rendreComparateur();
    }
  });
}

initialiserComparateur();
