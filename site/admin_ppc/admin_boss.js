// Boss : consultation et modification du nom et des résistances de chaque
// boss (JSON de DB/ et ajouts), enregistrés dans Supabase (api/points.js,
// config.boss) et appliqués sur tout le site. Utilise listeBoss,
// ELEMENTS_AJOUT, LIBELLES_ELEMENTS, TYPES_BOSS, echapper, lireResistance et
// envoyerAjout (admin_ajout.js). Résistances en pourcentage (10 = 10 %).

let brouillonBoss = {};  // id -> { nom, res }
let bossEnregistres = "";

function etatBoss() {
  return JSON.stringify(brouillonBoss);
}

function bossValide({ nom, res }) {
  return nom.trim() !== "" && nom.trim().length <= 80 && res.every(Number.isFinite);
}

function rendreBoss() {
  document.getElementById("liste-boss").innerHTML = `
    <table class="tableau-boss">
      <thead>
        <tr>
          <th class="col-nom">Boss</th>
          ${ELEMENTS_AJOUT.map(element => `<th title="Résistance ${LIBELLES_ELEMENTS[element]}"><img src="${ICONES_ELEMENTS_TRI[element]}" alt="${LIBELLES_ELEMENTS[element]}"></th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${listeBoss.map(boss => {
          const b = brouillonBoss[boss.id];
          return `
          <tr>
            <td class="col-nom">
              <div class="entete-boss">
                <span class="miniature-boss"><img src="../DB/${echapper(boss.image)}" alt="" loading="lazy"></span>
                <div class="infos-boss">
                  <input type="text" class="texte-ajout nom-boss${b.nom.trim() ? "" : " invalide"}" data-id="${echapper(boss.id)}" value="${echapper(b.nom)}" autocomplete="off">
                  <span class="details-boss">
                    <code>${echapper(boss.id)}</code> · ${TYPES_BOSS[boss.type] || echapper(boss.type || "")}
                    ${boss.ajout ? `<span class="tag-ajout" title="Ajouté depuis cette page (pas dans le JSON)">Ajouté</span>` : ""}
                  </span>
                </div>
              </div>
            </td>
            ${b.res.map((valeur, i) => `
              <td><span class="champ-pourcent${estImmunise(valeur) ? " immunise" : ""}"><input type="text" class="res-ajout res-boss${Number.isFinite(valeur) ? "" : " invalide"}" data-id="${echapper(boss.id)}" data-index="${i}" value="${Number.isFinite(valeur) ? valeur : ""}" inputmode="decimal" title="${LIBELLES_ELEMENTS[ELEMENTS_AJOUT[i]]} (%)"></span></td>`).join("")}
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  majPiedBoss();
}

function majPiedBoss() {
  const modifie = etatBoss() !== bossEnregistres;
  const valide = Object.values(brouillonBoss).every(bossValide);
  document.getElementById("enregistrer-boss").disabled = !modifie || !valide;
  if (modifie && !valide) afficherMessageBoss("Un nom est vide ou une résistance n'est pas un nombre.", "erreur");
  else if (modifie) afficherMessageBoss("Modifications non enregistrées.");
  else if (!document.getElementById("message-boss").classList.contains("succes")) afficherMessageBoss("");
}

function afficherMessageBoss(texte, type = "") {
  const message = document.getElementById("message-boss");
  message.textContent = texte;
  message.className = `message-ajout ${type}`;
}

function ouvrirBoss() {
  brouillonBoss = Object.fromEntries(listeBoss.map(boss => [boss.id, {
    nom: boss.nom,
    res: Array.from({ length: ELEMENTS_AJOUT.length }, (_, i) => Number(boss.res?.[i] ?? 0))
  }]));
  bossEnregistres = etatBoss();
  afficherMessageBoss("");
  rendreBoss();
  document.getElementById("modal-boss").classList.add("active");
}

function fermerBoss() {
  if (etatBoss() !== bossEnregistres && !confirm("Abandonner les modifications des boss ?")) return;
  document.getElementById("modal-boss").classList.remove("active");
}

// Seuls les boss modifiés sont envoyés.
async function enregistrerBoss() {
  const bouton = document.getElementById("enregistrer-boss");
  const avant = JSON.parse(bossEnregistres);
  const modifs = Object.fromEntries(Object.entries(brouillonBoss)
    .filter(([id, b]) => JSON.stringify(b) !== JSON.stringify(avant[id]))
    .map(([id, b]) => [id, { nom: b.nom.trim(), res: b.res }]));
  bouton.disabled = true;
  try {
    await envoyerAjout({ boss: modifs });
    Object.entries(modifs).forEach(([id, modif]) => {
      const boss = listeBoss.find(b => b.id === id);
      if (boss) Object.assign(boss, { nom: modif.nom, res: [...modif.res] });
      brouillonBoss[id] = { nom: modif.nom, res: [...modif.res] };
    });
    bossEnregistres = etatBoss();
    afficherMessageBoss("Boss enregistrés : les changements s'appliquent sur tout le site.", "succes");
    rendreBoss();
  } catch (erreur) {
    console.error(erreur);
    afficherMessageBoss(erreur.message, "erreur");
    majPiedBoss();
  }
}

// Boss du carnage désactivés (config.carnage_desactive) : enregistré dès le
// clic, appliqué à tous les tirages et boss imposés sauf l'entraînement (cf.
// bossCarnageExclus, api/_lib/boss.js).
function initialiserCarnage() {
  const caseCarnage = document.getElementById("carnage-desactive");
  const message = document.getElementById("message-carnage");
  chargerPointsAdmin().then(config => { caseCarnage.checked = config?.carnage_desactive === true; });
  caseCarnage.addEventListener("change", async () => {
    const desactive = caseCarnage.checked;
    caseCarnage.disabled = true;
    message.className = "message-ajout";
    message.textContent = "Enregistrement…";
    try {
      await envoyerAjout({ carnage_desactive: desactive });
      message.textContent = desactive ? "Carnage désactivé." : "Carnage réactivé.";
      message.classList.add("succes");
    } catch (erreur) {
      console.error(erreur);
      caseCarnage.checked = !desactive;
      message.textContent = erreur.message;
      message.classList.add("erreur");
    } finally {
      caseCarnage.disabled = false;
    }
  });
}

function initialiserBoss() {
  initialiserCarnage();
  const modal = document.getElementById("modal-boss");
  document.getElementById("ouvrir-boss").addEventListener("click", ouvrirBoss);
  document.getElementById("fermer-boss").addEventListener("click", fermerBoss);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermerBoss();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermerBoss();
  });
  document.getElementById("enregistrer-boss").addEventListener("click", enregistrerBoss);

  document.getElementById("liste-boss").addEventListener("input", event => {
    const nom = event.target.closest(".nom-boss");
    const res = event.target.closest(".res-boss");
    if (nom) {
      brouillonBoss[nom.dataset.id].nom = nom.value;
      nom.classList.toggle("invalide", !nom.value.trim());
    }
    if (res) {
      const valeur = lireResistance(res.value);
      brouillonBoss[res.dataset.id].res[Number(res.dataset.index)] = valeur;
      res.classList.toggle("invalide", !Number.isFinite(valeur));
      // 999 ou plus : immunisé (cf. estImmunise, commun/cartes.js).
      res.parentElement.classList.toggle("immunise", estImmunise(valeur));
    }
    if (nom || res) {
      document.getElementById("message-boss").classList.remove("succes");
      majPiedBoss();
    }
  });
}
