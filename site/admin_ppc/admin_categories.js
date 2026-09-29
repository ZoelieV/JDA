// Catégories des armes (support, standard : aucune, une ou les deux),
// enregistrées dans Supabase (api/points.js, config.categoriesArmes) et
// appliquées par-dessus DB/weapons.json sur tout le site. Utilise armes
// (admin_ppc.js), CATEGORIES_ARMES, LIBELLES_ARMES, basculerCategorie,
// echapper et envoyerAjout (admin_ajout.js).

let brouillonCategories = {};  // id arme -> [catégories]
let categoriesEnregistrees = "";
let sansCategorieSeulement = false;

function etatCategories() {
  return JSON.stringify(brouillonCategories);
}

function armesCategoriesAffichees() {
  const recherche = document.getElementById("recherche-categories").value.trim().toLowerCase();
  return armes.filter(arme =>
    (!recherche || arme.nom.toLowerCase().includes(recherche)) &&
    (!sansCategorieSeulement || !brouillonCategories[arme.id].length));
}

function rendreCategories() {
  const liste = armesCategoriesAffichees();
  document.getElementById("sans-categorie").classList.toggle("active", sansCategorieSeulement);
  document.getElementById("compte-categories").textContent = `${liste.length} / ${armes.length} armes`;
  document.getElementById("liste-categories").innerHTML = `
    <table class="tableau-boss">
      <tbody>
        ${liste.map(arme => `
          <tr>
            <td class="col-nom">
              <div class="entete-boss">
                <span class="miniature-boss ${classeFondRarete(arme.rarete)}"><img src="../DB/${echapper(arme.image)}" alt="" loading="lazy"></span>
                <div class="infos-boss">
                  <span class="nom-ajout">${echapper(arme.nom)}</span>
                  <span class="details-boss">
                    ${LIBELLES_ARMES[arme.type] || echapper(arme.type || "")} · ${echapper(arme.rarete)}★
                    ${masques.weapons.includes(arme.id) ? `<span class="tag-masque">Masqué</span>` : ""}
                  </span>
                </div>
              </div>
            </td>
            <td class="choix-categories">
              ${Object.entries(CATEGORIES_ARMES).map(([valeur, libelle]) => `
                <button type="button" class="filtre-admin filtre-texte choix-categorie${brouillonCategories[arme.id].includes(valeur) ? " active" : ""}" data-id="${echapper(arme.id)}" data-valeur="${valeur}">${libelle}</button>`).join("")}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  majPiedCategories();
}

function majPiedCategories() {
  const modifie = etatCategories() !== categoriesEnregistrees;
  document.getElementById("enregistrer-categories").disabled = !modifie;
  const message = document.getElementById("message-categories");
  if (modifie) afficherMessageCategories("Modifications non enregistrées.");
  else if (!message.classList.contains("succes")) afficherMessageCategories("");
}

function afficherMessageCategories(texte, type = "") {
  const message = document.getElementById("message-categories");
  message.textContent = texte;
  message.className = `message-ajout ${type}`;
}

function ouvrirCategories() {
  brouillonCategories = Object.fromEntries(armes.map(arme => [
    arme.id,
    Object.keys(CATEGORIES_ARMES).filter(c => Array.isArray(arme.categories) && arme.categories.includes(c))
  ]));
  categoriesEnregistrees = etatCategories();
  document.getElementById("recherche-categories").value = "";
  sansCategorieSeulement = false;
  afficherMessageCategories("");
  rendreCategories();
  document.getElementById("modal-categories").classList.add("active");
}

function fermerCategories() {
  if (etatCategories() !== categoriesEnregistrees && !confirm("Abandonner les modifications des catégories ?")) return;
  document.getElementById("modal-categories").classList.remove("active");
}

// Seules les armes modifiées sont envoyées.
async function enregistrerCategories() {
  const bouton = document.getElementById("enregistrer-categories");
  const avant = JSON.parse(categoriesEnregistrees);
  const modifs = Object.fromEntries(Object.entries(brouillonCategories)
    .filter(([id, categories]) => JSON.stringify(categories) !== JSON.stringify(avant[id])));
  bouton.disabled = true;
  try {
    await envoyerAjout({ categoriesArmes: modifs });
    Object.entries(modifs).forEach(([id, categories]) => {
      const arme = armes.find(a => a.id === id);
      if (arme) arme.categories = [...categories];
    });
    categoriesEnregistrees = etatCategories();
    afficherMessageCategories("Catégories enregistrées : elles s'appliquent sur tout le site.", "succes");
    rendreCategories();
  } catch (erreur) {
    console.error(erreur);
    afficherMessageCategories(erreur.message, "erreur");
    majPiedCategories();
  }
}

function initialiserCategories() {
  const modal = document.getElementById("modal-categories");
  document.getElementById("ouvrir-categories").addEventListener("click", ouvrirCategories);
  document.getElementById("fermer-categories").addEventListener("click", fermerCategories);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermerCategories();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermerCategories();
  });
  document.getElementById("enregistrer-categories").addEventListener("click", enregistrerCategories);
  document.getElementById("recherche-categories").addEventListener("input", rendreCategories);
  document.getElementById("sans-categorie").addEventListener("click", () => {
    sansCategorieSeulement = !sansCategorieSeulement;
    rendreCategories();
  });

  document.getElementById("liste-categories").addEventListener("click", event => {
    const bouton = event.target.closest(".choix-categorie");
    if (!bouton) return;
    const id = bouton.dataset.id;
    brouillonCategories[id] = basculerCategorie(brouillonCategories[id], bouton.dataset.valeur);
    bouton.classList.toggle("active", brouillonCategories[id].includes(bouton.dataset.valeur));
    document.getElementById("message-categories").classList.remove("succes");
    majPiedCategories();
  });
}
