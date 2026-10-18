// Boss : consultation et modification du nom, des résistances, du début
// du chrono (MOMENTS_CHRONO, commun/cartes.js ; aucun = pas de bouton Chrono
// en fin de draft) et des recommandations (éléments, réactions, mécaniques,
// affichées hors match classé, cf. commun/recommandations_boss.js) de chaque
// boss (JSON de DB/ et ajouts), enregistrés dans Supabase (api/points.js,
// config.boss) et appliqués sur tout le site. Utilise listeBoss,
// ELEMENTS_AJOUT, LIBELLES_ELEMENTS, TYPES_BOSS, echapper, lireResistance et
// envoyerAjout (admin_ajout.js). Résistances en pourcentage (10 = 10 %).

let brouillonBoss = {};  // id -> { nom, res, chrono, reco }
let bossEnregistres = "";
// Boss dont l'éditeur des recommandations est déplié.
const recoOuvertes = new Set();

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
          <th title="Début du chrono (bouton Chrono en fin de draft)">Chrono</th>
          <th title="Éléments, réactions et mécaniques recommandés (hors match classé)">Conseils</th>
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
            <td>
              <select class="chrono-boss${b.chrono ? "" : " sans-chrono"}" data-id="${echapper(boss.id)}" title="Début du chrono">
                <option value="">—</option>
                ${Object.entries(MOMENTS_CHRONO).map(([cle, moment]) => `<option value="${cle}"${b.chrono === cle ? " selected" : ""}>${moment.libelle}</option>`).join("")}
              </select>
            </td>
            <td>
              <button type="button" class="btn-reco-boss" data-id="${echapper(boss.id)}" aria-expanded="${recoOuvertes.has(boss.id)}">${texteBoutonReco(b.reco)}</button>
            </td>
          </tr>
          <tr class="ligne-reco-boss${recoOuvertes.has(boss.id) ? "" : " cache"}" data-id="${echapper(boss.id)}">
            <td colspan="${ELEMENTS_AJOUT.length + 3}">${htmlEditeurReco(boss.id)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  majPiedBoss();
}

// ---- Recommandations (cf. commun/recommandations_boss.js) ----

function nbRecos(reco) {
  return reco ? reco.elements.length + reco.reactions.length + reco.mecaniques.length : 0;
}

function texteBoutonReco(reco) {
  const n = nbRecos(reco);
  return n ? `${n} conseil${n > 1 ? "s" : ""}` : "Ajouter";
}

function htmlChoixReco(id, genre, valeur, libelle, actif, contenu = libelle) {
  return `<button type="button" class="choix-reco${actif ? " actif" : ""}" data-id="${echapper(id)}" data-genre="${genre}" data-valeur="${echapper(valeur)}" aria-pressed="${actif}" title="${echapper(libelle)}">${contenu}</button>`;
}

function htmlEditeurReco(id) {
  const reco = brouillonBoss[id].reco || { elements: [], reactions: [], mecaniques: [] };
  return `
    <div class="editeur-reco">
      <div class="groupe-reco">
        <span class="titre-groupe-reco">Éléments</span>
        ${ELEMENTS_BOSS.map(e => htmlChoixReco(id, "elements", e, LIBELLES_ELEMENTS[e], reco.elements.includes(e), `<img src="${ICONES_ELEMENTS_TRI[e]}" alt="${LIBELLES_ELEMENTS[e]}">`)).join("")}
      </div>
      <div class="groupe-reco">
        <span class="titre-groupe-reco">Réactions</span>
        ${Object.entries(REACTIONS_BOSS).map(([r, nom]) => htmlChoixReco(id, "reactions", r, nom, reco.reactions.includes(r))).join("")}
      </div>
      <div class="groupe-reco">
        <span class="titre-groupe-reco">Mécaniques</span>
        ${reco.mecaniques.map(m => htmlChoixReco(id, "mecaniques", m, `Retirer « ${m} »`, true, `${echapper(m)} ×`)).join("")}
        ${MECANIQUES_SUGGEREES.filter(m => !reco.mecaniques.some(x => x.toLowerCase() === m.toLowerCase()))
          .map(m => htmlChoixReco(id, "mecaniques", m, `Ajouter « ${m} »`, false, `+ ${echapper(m)}`)).join("")}
        <input type="text" class="texte-ajout saisie-mecanique" data-id="${echapper(id)}" maxlength="30" placeholder="Autre mécanique (Entrée)" autocomplete="off">
      </div>
    </div>`;
}

// Recommandations du boss modifiées : rangées et nettoyées comme par le
// serveur (null si aucune), éditeur et bouton de la ligne mis à jour.
function modifierReco(id, changer) {
  const reco = brouillonBoss[id].reco || { elements: [], reactions: [], mecaniques: [] };
  const copie = { elements: [...reco.elements], reactions: [...reco.reactions], mecaniques: [...reco.mecaniques] };
  changer(copie);
  brouillonBoss[id].reco = lireRecommandationsBoss(copie);
  const liste = document.getElementById("liste-boss");
  const ligne = [...liste.querySelectorAll(".ligne-reco-boss")].find(l => l.dataset.id === id);
  if (ligne) ligne.firstElementChild.innerHTML = htmlEditeurReco(id);
  const bouton = [...liste.querySelectorAll(".btn-reco-boss")].find(b => b.dataset.id === id);
  if (bouton) bouton.textContent = texteBoutonReco(brouillonBoss[id].reco);
  document.getElementById("message-boss").classList.remove("succes");
  majPiedBoss();
}

function basculerChoixReco(bouton) {
  const { id, genre, valeur } = bouton.dataset;
  modifierReco(id, reco => {
    const avant = reco[genre].length;
    reco[genre] = reco[genre].filter(v => v !== valeur);
    if (reco[genre].length === avant) reco[genre].push(valeur);
  });
}

function ajouterMecanique(champ) {
  const texte = champ.value.trim();
  if (!texte) return;
  const id = champ.dataset.id;
  modifierReco(id, reco => { reco.mecaniques.push(texte); });
  const nouveau = [...document.querySelectorAll("#liste-boss .saisie-mecanique")].find(c => c.dataset.id === id);
  nouveau?.focus();
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
    res: Array.from({ length: ELEMENTS_AJOUT.length }, (_, i) => Number(boss.res?.[i] ?? 0)),
    chrono: MOMENTS_CHRONO[boss.chrono] ? boss.chrono : null,
    reco: lireRecommandationsBoss(boss.reco)
  }]));
  recoOuvertes.clear();
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
    .map(([id, b]) => [id, { nom: b.nom.trim(), res: b.res, chrono: b.chrono, reco: b.reco }]));
  bouton.disabled = true;
  try {
    await envoyerAjout({ boss: modifs });
    Object.entries(modifs).forEach(([id, modif]) => {
      const boss = listeBoss.find(b => b.id === id);
      if (boss) Object.assign(boss, { nom: modif.nom, res: [...modif.res], chrono: modif.chrono, reco: modif.reco });
      brouillonBoss[id] = { nom: modif.nom, res: [...modif.res], chrono: modif.chrono, reco: modif.reco };
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

  document.getElementById("liste-boss").addEventListener("click", event => {
    const ouvrir = event.target.closest(".btn-reco-boss");
    const choix = event.target.closest(".choix-reco");
    if (ouvrir) {
      const id = ouvrir.dataset.id;
      const ouverte = !recoOuvertes.has(id);
      if (ouverte) recoOuvertes.add(id);
      else recoOuvertes.delete(id);
      ouvrir.setAttribute("aria-expanded", ouverte);
      [...document.querySelectorAll("#liste-boss .ligne-reco-boss")].find(l => l.dataset.id === id)?.classList.toggle("cache", !ouverte);
    }
    if (choix) basculerChoixReco(choix);
  });
  document.getElementById("liste-boss").addEventListener("keydown", event => {
    const champ = event.target.closest(".saisie-mecanique");
    if (!champ || event.key !== "Enter") return;
    event.preventDefault();
    ajouterMecanique(champ);
  });
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
  document.getElementById("liste-boss").addEventListener("change", event => {
    const chrono = event.target.closest(".chrono-boss");
    if (!chrono) return;
    brouillonBoss[chrono.dataset.id].chrono = chrono.value || null;
    chrono.classList.toggle("sans-chrono", !chrono.value);
    document.getElementById("message-boss").classList.remove("succes");
    majPiedBoss();
  });
}
