// Administration, page Équilibrage : historique des modifications des points
// (tuile « Historique des points »), pour rédiger les patchs. Une ligne par
// perso ou arme modifié à chaque enregistrement du tableau des points : qui,
// quand, valeurs avant et après (cf. api/_lib/historique_points.js).
//   points      : seules les cases modifiées (C0..C6, niv. 95, niv. 100,
//                 théâtre ; R1..R5) ;
//   alternative : valeur alternative d'une arme, groupes en entier, persos
//                 ajoutés / retirés et % modifiés surlignés ;
//   synergie    : valeur alternative d'un perso (persos en synergie, malus) ;
//   theatre     : buff du théâtre du mois ajouté ou retiré ;
//   masque      : perso ou arme masqué (pas encore sorti) ou rendu visible.
// Filtres (depuis une date, persos / armes, recherche) gardés dans ce
// navigateur ; « Copier en texte » : les lignes affichées, pour un patch.

const CLE_REGLAGES_HISTORIQUE = "admin_historique_points";
const REGLAGES_HISTORIQUE_DEFAUT = { depuis: "", genre: "tout", recherche: "" };
let reglagesHistorique = { ...REGLAGES_HISTORIQUE_DEFAUT };
let donneesHistorique = null;

function lireReglagesHistorique() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_REGLAGES_HISTORIQUE) || "null");
    if (brut && typeof brut === "object") reglagesHistorique = { ...REGLAGES_HISTORIQUE_DEFAUT, ...brut, recherche: "" };
  } catch { /* stockage indisponible : réglages par défaut */ }
}

function ecrireReglagesHistorique() {
  try {
    const { recherche: _recherche, ...reste } = reglagesHistorique;
    localStorage.setItem(CLE_REGLAGES_HISTORIQUE, JSON.stringify(reste));
  } catch { /* pas grave */ }
}

const nombreFr = n => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

// Perso d'une clé de valeur alternative (id, ou groupe pour le Voyageur).
function persoHistorique(cle) {
  return personnages.find(p => p.id === cle) || personnages.find(p => p.groupe === cle) || null;
}

function nomPersoHistorique(cle) {
  const perso = persoHistorique(cle);
  if (!perso) return cle;
  return perso.groupe && perso.groupe === cle && perso.id !== cle ? perso.nom.replace(/\s+\S+$/, "") : perso.nom;
}

function entreeHistorique(ligne) {
  return (ligne.genre === "weapons" ? armes : personnages).find(e => e.id === ligne.cible) || null;
}

const nomEntreeHistorique = ligne => entreeHistorique(ligne)?.nom || ligne.cible;

const LIBELLES_CHAMPS_HISTORIQUE = { points: "Points", alternative: "Valeur alternative", synergie: "Synergie", theatre: "Buff théâtre", masque: "Visibilité" };

// Buff théâtre et masqué : oui / non.
function detailOuiNon(ligne) {
  const [oui, non] = ligne.champ === "theatre" ? ["Buffé", "Pas buffé"] : ["Masqué", "Visible"];
  const texte = ligne.champ === "theatre"
    ? (ligne.apres ? "buff ajouté" : "buff retiré")
    : (ligne.apres ? "masqué" : "rendu visible");
  return {
    avant: [`<span class="hp-retire">${ligne.avant ? oui : non}</span>`],
    apres: [`<span class="hp-ajoute">${ligne.apres ? oui : non}</span>`],
    texte
  };
}

// ---- Détail avant / après ----

// Points : cases modifiées seulement -> { avant: [html], apres: [html], texte }.
function detailPoints(ligne) {
  const libelles = COLONNES[ligne.genre].libelles;
  const avant = [];
  const apres = [];
  const texte = [];
  libelles.forEach((libelle, i) => {
    const a = Number(ligne.avant?.[i] ?? 0);
    const b = Number(ligne.apres?.[i] ?? 0);
    if (a === b) return;
    avant.push(`<span class="hp-case">${libelle}</span> ${nombreFr(a)}`);
    apres.push(`<span class="hp-case">${libelle}</span> <strong class="${b > a ? "hp-hausse" : "hp-baisse"}">${nombreFr(b)}</strong>`);
    texte.push(`${libelle} ${nombreFr(a)} → ${nombreFr(b)}`);
  });
  return { avant, apres, texte: texte.join(", ") };
}

// Persos d'un groupe : ceux absents de l'autre version marqués.
const listePersos = (persos, autres, classe) => persos
  .map(cle => `<span class="${autres.has(cle) ? "" : classe}">${echapper(nomPersoHistorique(cle))}</span>`)
  .join(", ") || `<span class="doux">personne</span>`;

// Valeur alternative d'une arme : { reste, groupes: [{ pourcentage, persos }] }.
function detailAlternative(ligne) {
  const groupes = v => {
    const parPourcent = new Map();
    (v?.groupes || []).forEach(g => parPourcent.set(g.pourcentage, [...(parPourcent.get(g.pourcentage) || []), ...g.persos]));
    return parPourcent;
  };
  const a = groupes(ligne.avant);
  const b = groupes(ligne.apres);
  const resteA = ligne.avant?.reste ?? 100;
  const resteB = ligne.apres?.reste ?? 100;
  const rendre = (mien, autre, reste, autreReste, classe) => {
    const lignes = [`Reste : <span class="${reste === autreReste ? "" : classe}">${nombreFr(reste)} %</span>`];
    [...mien.keys()].sort((x, y) => y - x).forEach(p => {
      const autres = new Set(autre.get(p) || []);
      lignes.push(`<span class="${autre.has(p) ? "" : classe}">${nombreFr(p)} %</span> : ${listePersos(mien.get(p), autres, classe)}`);
    });
    return lignes;
  };
  const texte = [];
  if (resteA !== resteB) texte.push(`reste ${nombreFr(resteA)} % → ${nombreFr(resteB)} %`);
  [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => y - x).forEach(p => {
    const avant = new Set(a.get(p) || []);
    const apres = new Set(b.get(p) || []);
    const ajoutes = [...apres].filter(c => !avant.has(c)).map(c => `+${nomPersoHistorique(c)}`);
    const retires = [...avant].filter(c => !apres.has(c)).map(c => `−${nomPersoHistorique(c)}`);
    if (ajoutes.length || retires.length) texte.push(`${nombreFr(p)} % : ${[...ajoutes, ...retires].join(" ")}`);
  });
  return {
    avant: ligne.avant ? rendre(a, b, resteA, resteB, "hp-retire") : [`<span class="doux">aucune (100 %)</span>`],
    apres: ligne.apres ? rendre(b, a, resteB, resteA, "hp-ajoute") : [`<span class="doux">aucune (100 %)</span>`],
    texte: texte.join(", ")
  };
}

// Synergie d'un perso : { persos, malus, par_absent? }.
function detailSynergie(ligne) {
  const malus = s => `Malus ${nombreFr(s.malus)}${s.par_absent != null ? ` (${nombreFr(s.par_absent)} par absent)` : ""}`;
  const rendre = (mienne, autre, classe) => {
    if (!mienne) return [`<span class="doux">aucune</span>`];
    const memeMalus = autre && malus(autre) === malus(mienne);
    return [
      `<span class="${memeMalus ? "" : classe}">${malus(mienne)}</span>`,
      `Avec : ${listePersos(mienne.persos, new Set(autre?.persos || []), classe)}`
    ];
  };
  const texte = [];
  const a = ligne.avant;
  const b = ligne.apres;
  if (!a) texte.push(`ajoutée : ${malus(b).toLowerCase()}, avec ${b.persos.map(nomPersoHistorique).join(", ")}`);
  else if (!b) texte.push("retirée");
  else {
    if (malus(a) !== malus(b)) texte.push(`${malus(a).toLowerCase()} → ${malus(b).toLowerCase()}`);
    const ajoutes = b.persos.filter(c => !a.persos.includes(c)).map(c => `+${nomPersoHistorique(c)}`);
    const retires = a.persos.filter(c => !b.persos.includes(c)).map(c => `−${nomPersoHistorique(c)}`);
    if (ajoutes.length || retires.length) texte.push(`persos : ${[...ajoutes, ...retires].join(" ")}`);
  }
  return { avant: rendre(a, b, "hp-retire"), apres: rendre(b, a, "hp-ajoute"), texte: texte.join(", ") };
}

function detailHistorique(ligne) {
  if (ligne.champ === "alternative") return detailAlternative(ligne);
  if (ligne.champ === "synergie") return detailSynergie(ligne);
  if (ligne.champ === "theatre" || ligne.champ === "masque") return detailOuiNon(ligne);
  return detailPoints(ligne);
}

// ---- Rendu ----

function lignesFiltrees() {
  const { depuis, genre, recherche } = reglagesHistorique;
  const debut = depuis ? new Date(depuis).toISOString() : "";
  const cherche = recherche.trim().toLocaleLowerCase("fr");
  return (donneesHistorique?.lignes || []).filter(l =>
    (!debut || l.cree_le >= debut) &&
    (genre === "tout" || l.genre === genre) &&
    (!cherche || nomEntreeHistorique(l).toLocaleLowerCase("fr").includes(cherche) || l.cible.includes(cherche)));
}

const dateHistorique = iso => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

function iconeHistorique(ligne) {
  const entree = entreeHistorique(ligne);
  if (!entree) return `<span class="stats-perso inconnu">?</span>`;
  return `<span class="stats-perso ${classeFondRarete(entree.rarete)}"><img src="/DB/${echapper(entree.image)}" alt="" loading="lazy"></span>`;
}

function rendreHistoriquePoints() {
  const zone = document.getElementById("contenu-historique-points");
  if (!donneesHistorique) return;
  const lignes = lignesFiltrees();
  const { admins, limite } = donneesHistorique;
  if (!lignes.length) {
    zone.innerHTML = `<p class="aide-apercu">${donneesHistorique.lignes.length ? "Aucune modification avec ces filtres." : "Aucune modification enregistrée pour l'instant : l'historique commence avec ce nouvel outil."}</p>`;
    return;
  }
  // Un enregistrement = même date et même admin : date et admin une fois.
  const corps = [];
  let i = 0;
  while (i < lignes.length) {
    let j = i;
    while (j < lignes.length && lignes[j].cree_le === lignes[i].cree_le && lignes[j].admin_id === lignes[i].admin_id) j++;
    lignes.slice(i, j).forEach((l, k) => {
      const detail = detailHistorique(l);
      corps.push(`
        <tr class="${k === 0 ? "hp-debut" : ""}">
          ${k === 0 ? `<td rowspan="${j - i}" class="hp-quand">${dateHistorique(l.cree_le)}<br><span class="doux">${echapper(admins[l.admin_id] || l.admin_id)}</span></td>` : ""}
          <td><div class="hp-cible">${iconeHistorique(l)}<span>${echapper(nomEntreeHistorique(l))}<br><span class="doux">${l.genre === "weapons" ? "Arme" : "Perso"} · ${LIBELLES_CHAMPS_HISTORIQUE[l.champ]}</span></span></div></td>
          <td class="hp-valeurs">${detail.avant.map(x => `<div>${x}</div>`).join("")}</td>
          <td class="hp-valeurs">${detail.apres.map(x => `<div>${x}</div>`).join("")}</td>
        </tr>`);
    });
    i = j;
  }
  const tronque = donneesHistorique.lignes.length >= limite;
  zone.innerHTML = `
    <p class="aide-apercu">${lignes.length} modification${lignes.length > 1 ? "s" : ""} affichée${lignes.length > 1 ? "s" : ""}${tronque ? ` (les ${limite} plus récentes seulement)` : ""}. Points : en vert à la hausse, en rouge à la baisse. Valeurs alternatives et synergies : en vert ce qui est nouveau, en rouge barré ce qui est retiré ou remplacé.</p>
    <div class="stats-defilement">
      <table class="tableau-boss tableau-stats-classe tableau-historique-points">
        <thead><tr><th>Quand, qui</th><th>Perso / arme</th><th>Avant</th><th>Après</th></tr></thead>
        <tbody>${corps.join("")}</tbody>
      </table>
    </div>`;
}

// Lignes affichées, en texte (du plus ancien au plus récent), pour un patch.
function texteHistorique() {
  return lignesFiltrees().slice().reverse().map(l => {
    const genre = l.genre === "weapons" ? "arme" : "perso";
    return `[${dateHistorique(l.cree_le)}] ${nomEntreeHistorique(l)} (${genre}) — ${LIBELLES_CHAMPS_HISTORIQUE[l.champ].toLowerCase()} : ${detailHistorique(l).texte}`;
  }).join("\n");
}

async function copierHistorique() {
  const texte = texteHistorique();
  const bouton = document.getElementById("copier-historique-points");
  if (!texte) return;
  try {
    await navigator.clipboard.writeText(texte);
    bouton.textContent = "Copié !";
  } catch {
    bouton.textContent = "Copie impossible";
  }
  setTimeout(() => { bouton.textContent = "Copier en texte"; }, 1500);
}

async function ouvrirHistoriquePoints() {
  const modal = document.getElementById("modal-historique-points");
  modal.classList.add("active");
  const zone = document.getElementById("contenu-historique-points");
  zone.innerHTML = `<p class="aide-apercu">Chargement…</p>`;
  document.getElementById("historique-depuis").value = reglagesHistorique.depuis;
  document.getElementById("historique-genre").value = reglagesHistorique.genre;
  document.getElementById("historique-recherche").value = reglagesHistorique.recherche;
  try {
    const reponse = await fetch("/api/points?historique_points=1", { credentials: "include" });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(data.error || "Impossible de charger l'historique.");
    donneesHistorique = data;
    rendreHistoriquePoints();
  } catch (erreur) {
    console.error(erreur);
    zone.innerHTML = `<p class="message-ajout erreur">${echapper(erreur.message)}</p>`;
  }
}

function initialiserHistoriquePoints() {
  lireReglagesHistorique();
  const modal = document.getElementById("modal-historique-points");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-historique-points").addEventListener("click", ouvrirHistoriquePoints);
  document.getElementById("fermer-historique-points").addEventListener("click", fermer);
  document.getElementById("copier-historique-points").addEventListener("click", copierHistorique);
  modal.addEventListener("click", event => { if (event.target === modal) fermer(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.getElementById("reglages-historique-points").addEventListener("input", () => {
    reglagesHistorique = {
      depuis: document.getElementById("historique-depuis").value,
      genre: document.getElementById("historique-genre").value,
      recherche: document.getElementById("historique-recherche").value
    };
    ecrireReglagesHistorique();
    rendreHistoriquePoints();
  });
  document.getElementById("reglages-historique-points").addEventListener("submit", event => event.preventDefault());
}

initialiserHistoriquePoints();
