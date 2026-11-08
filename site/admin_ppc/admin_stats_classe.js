// Administration, page Équilibrage : stats du classé pour régler les points
// des persos (tuile « Stats du classé »). Une ligne par boss du classé :
//   - record : l'équipe la plus rapide (défi : le plus d'ennemis) et son temps ;
//   - top 4 : les persos les plus présents dans les équipes proches du record
//     (temps <= record + max(écart % du record, minimum en secondes) ; défi :
//     ennemis >= record − écart %), en % des équipes de cette fenêtre.
// Une équipe = un joueur et ses 4 picks ; la même équipe refaite par le même
// joueur ne compte qu'une fois (son meilleur temps). Voyageur et Manekin :
// un perso par élément. Équipes valides : cf. api/_lib/stats_equilibrage.js.
// Période et écarts réglés dans la fenêtre, gardés dans ce navigateur.

const CLE_REGLAGES_STATS = "admin_stats_classe";
const REGLAGES_STATS_DEFAUT = { periode: "saison", depuis: "", ecart: 15, minimum: 5 };
let donneesStatsClasse = null;
let reglagesStats = { ...REGLAGES_STATS_DEFAUT };

function lireReglagesStats() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_REGLAGES_STATS) || "null");
    if (brut && typeof brut === "object") reglagesStats = { ...REGLAGES_STATS_DEFAUT, ...brut };
  } catch { /* stockage indisponible : réglages par défaut */ }
}

function ecrireReglagesStats() {
  try { localStorage.setItem(CLE_REGLAGES_STATS, JSON.stringify(reglagesStats)); } catch { /* pas grave */ }
}

// Perso du catalogue pour un pick (Voyageur : id du groupe + élément).
function persoDuPick(pick) {
  return personnages.find(p => p.id === pick.id)
    || personnages.find(p => p.groupe === pick.id && p.element === pick.element)
    || personnages.find(p => p.groupe === pick.id)
    || null;
}

// Clé d'un perso dans les stats : un par élément pour le Voyageur et le Manekin.
const clePick = pick => (pick.element ? `${pick.id}:${pick.element}` : pick.id);

function nomPick(pick) {
  const perso = persoDuPick(pick);
  const nom = perso?.groupe ? perso.nom.replace(/\s+\S+$/, "") : perso?.nom || pick.id;
  return pick.element && !/\b(Pyro|Hydro|Electro|Cryo|Anemo|Geo|Dendro)$/.test(nom) ? `${nom} ${NOMS_ELEMENTS[pick.element] || pick.element}` : nom;
}

// Icône comme dans la box : constellation, arme signature (raffinement).
function htmlPickStats(pick, { titre = null, avecInfos = true } = {}) {
  const perso = persoDuPick(pick);
  if (!perso) return `<span class="stats-perso inconnu" title="${echapper(pick.id)}">?</span>`;
  const element = pick.element && ICONES_ELEMENTS_TRI[pick.element]
    ? `<img class="stats-coin stats-coin-element" src="${ICONES_ELEMENTS_TRI[pick.element]}" alt="">` : "";
  const infos = avecInfos ? [
    pick.c != null ? `<span class="stats-coin stats-coin-c">C${pick.c}</span>` : "",
    pick.r != null ? htmlArmeSignature(perso.arme, pick.r, { classe: "stats-coin stats-coin-arme", titre: `Arme signature R${pick.r + 1}` }) : ""
  ].join("") : "";
  const texte = titre ?? `${nomPick(pick)}${avecInfos && pick.c != null ? ` C${pick.c}` : ""}${avecInfos && pick.r != null ? ` R${pick.r + 1}` : ""}`;
  return `<span class="stats-perso ${classeFondRarete(perso.rarete)}" title="${echapper(texte)}"><img src="/DB/${echapper(perso.image)}" alt="" loading="lazy">${element}${infos}</span>`;
}

const texteScore = (valeur, defi) => (defi ? `${valeur} ennemi${valeur > 1 ? "s" : ""}` : `${valeur} s`);

// Équipes de la période choisie.
function equipesDeLaPeriode() {
  const { equipes, saisons, patchs } = donneesStatsClasse;
  if (reglagesStats.periode === "saison") {
    const saison = saisons[saisons.length - 1]?.numero ?? 0;
    return equipes.filter(e => e.saison === saison);
  }
  if (reglagesStats.periode === "patch") {
    const dernier = patchs[patchs.length - 1];
    return dernier ? equipes.filter(e => e.date >= dernier) : equipes;
  }
  if (reglagesStats.periode === "date" && reglagesStats.depuis) {
    return equipes.filter(e => e.date >= new Date(reglagesStats.depuis).toISOString());
  }
  return equipes;
}

// Stats d'un boss -> null (aucune équipe) ou { record, fenetre, limite, top, total }.
function statsDuBoss(equipes, defi) {
  if (!equipes.length) return null;
  const meilleur = (a, b) => (defi ? a.temps > b.temps : a.temps < b.temps);
  // Même joueur, même équipe : son meilleur score seulement.
  const parEquipe = new Map();
  equipes.forEach(e => {
    const cle = `${e.joueur}|${e.persos.map(clePick).sort().join(",")}`;
    const deja = parEquipe.get(cle);
    if (!deja || meilleur(e, deja)) parEquipe.set(cle, e);
  });
  const uniques = [...parEquipe.values()];
  const record = uniques.reduce((a, b) => (meilleur(b, a) ? b : a));
  const marge = defi ? record.temps * reglagesStats.ecart / 100 : Math.max(record.temps * reglagesStats.ecart / 100, reglagesStats.minimum);
  const limite = defi ? Math.floor(record.temps - marge) : Math.ceil(record.temps + marge);
  const fenetre = uniques.filter(e => (defi ? e.temps >= limite : e.temps <= limite));
  const parPerso = new Map();
  fenetre.forEach(e => {
    new Set(e.persos.map(clePick)).forEach(cle => {
      const pick = e.persos.find(p => clePick(p) === cle);
      if (!parPerso.has(cle)) parPerso.set(cle, { pick, equipes: [] });
      parPerso.get(cle).equipes.push({ equipe: e, pick });
    });
  });
  const top = [...parPerso.values()]
    .map(p => ({ ...p, part: p.equipes.length / fenetre.length, meilleur: p.equipes.reduce((a, b) => (meilleur(b.equipe, a) ? b.equipe : a), p.equipes[0].equipe) }))
    .sort((a, b) => b.equipes.length - a.equipes.length || (defi ? b.meilleur.temps - a.meilleur.temps : a.meilleur.temps - b.meilleur.temps))
    .slice(0, 4);
  return { record, fenetre, limite, top, total: uniques.length };
}

// Détail au survol d'un perso du top : constellations, arme signature,
// victoires et score moyen de ses équipes dans la fenêtre.
function detailPersoTop(p, defi) {
  const compter = valeurs => {
    const n = new Map();
    valeurs.forEach(v => n.set(v, (n.get(v) || 0) + 1));
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v, k]) => `${v} ×${k}`).join(", ");
  };
  const lignes = p.equipes;
  const victoires = lignes.filter(l => l.equipe.resultat === "victoire").length;
  const moyenne = Math.round(lignes.reduce((s, l) => s + l.equipe.temps, 0) / lignes.length * 10) / 10;
  return [
    `${nomPick(p.pick)} : ${lignes.length} équipe${lignes.length > 1 ? "s" : ""} (${Math.round(p.part * 100)} %)`,
    `Constellations : ${compter(lignes.map(l => (l.pick.c != null ? `C${l.pick.c}` : "C?")))}`,
    `Arme signature : ${compter(lignes.map(l => (l.pick.r != null ? `R${l.pick.r + 1}` : "sans")))}`,
    `Victoires : ${victoires} / ${lignes.length}`,
    `${defi ? "Score" : "Temps"} moyen : ${texteScore(moyenne, defi)} (meilleur : ${texteScore(p.meilleur.temps, defi)})`
  ].join("\n");
}

function rendreStatsClasse() {
  const zone = document.getElementById("contenu-stats-classe");
  if (!donneesStatsClasse) return;
  const { joueurs, boss_classe: bossClasse, defis } = donneesStatsClasse;
  const equipes = equipesDeLaPeriode();
  const parBoss = new Map();
  equipes.forEach(e => {
    if (!parBoss.has(e.boss)) parBoss.set(e.boss, []);
    parBoss.get(e.boss).push(e);
  });
  // Boss du classé, puis ceux qui n'y sont plus mais ont des équipes.
  const ids = [...bossClasse, ...[...parBoss.keys()].filter(id => !bossClasse.includes(id))];
  const bossParId = new Map((listeBossStats || []).map(b => [b.id, b]));
  const lignes = ids.map(id => {
    const boss = bossParId.get(id);
    const defi = defis.includes(id);
    const stats = statsDuBoss(parBoss.get(id) || [], defi);
    const nomBoss = echapper(boss?.nom || id);
    const celluleBoss = `<td class="stats-boss">${boss?.image ? `<img src="/DB/${echapper(boss.image)}" alt="" loading="lazy">` : ""}<span>${nomBoss}${bossClasse.includes(id) ? "" : `<br><span class="doux">plus en classé</span>`}</span></td>`;
    if (!stats) return { tri: [1, boss?.nom || id], html: `<tr>${celluleBoss}<td colspan="3" class="doux">Pas encore de temps.</td></tr>` };
    const { record, fenetre, limite, top, total } = stats;
    const joueur = joueurs[record.joueur] || "Joueur inconnu";
    const date = new Date(record.date).toLocaleDateString("fr-FR");
    const peu = fenetre.length < 3;
    return {
      tri: [0, boss?.nom || id],
      html: `
      <tr>
        ${celluleBoss}
        <td>
          <div class="stats-equipe" title="${echapper(`${joueur}, le ${date} (match n° ${record.match})`)}">
            ${record.persos.map(p => htmlPickStats(p)).join("")}
            <strong class="stats-temps">(${texteScore(record.temps, defi)})</strong>
          </div>
          <span class="doux">${echapper(joueur)} · ${date}</span>
        </td>
        <td>
          ${peu ? `<p class="doux stats-peu">Moins de 3 équipes près du record : pas assez de données.</p>` : ""}
          <ol class="stats-top">
            ${top.map(p => `<li title="${echapper(detailPersoTop(p, defi))}">${htmlPickStats(p.pick, { avecInfos: false, titre: detailPersoTop(p, defi) })}<span class="stats-nom">${echapper(nomPick(p.pick))}</span><strong>${Math.round(p.part * 100)} %</strong></li>`).join("")}
          </ol>
        </td>
        <td class="stats-fenetre">
          <strong>${fenetre.length}</strong> / ${total} équipe${total > 1 ? "s" : ""}<br>
          <span class="doux">${defi ? `≥ ${limite} ennemis` : `≤ ${limite} s`}</span>
        </td>
      </tr>`
    };
  });
  lignes.sort((a, b) => a.tri[0] - b.tri[0] || a.tri[1].localeCompare(b.tri[1], "fr"));
  zone.innerHTML = `
    <p class="aide-apercu">${equipes.length} équipe${equipes.length > 1 ? "s" : ""} valide${equipes.length > 1 ? "s" : ""} sur la période. Survole un perso du top pour le détail (constellations, arme signature, victoires, temps moyen).</p>
    <div class="stats-defilement">
      <table class="tableau-boss tableau-stats-classe">
        <thead><tr><th>Boss</th><th>Record</th><th>Top 4 près du record</th><th title="Équipes près du record / équipes du boss (même équipe d'un même joueur comptée une fois)">Équipes</th></tr></thead>
        <tbody>${lignes.map(l => l.html).join("")}</tbody>
      </table>
    </div>`;
}

let listeBossStats = null;

async function ouvrirStatsClasse() {
  const modal = document.getElementById("modal-stats-classe");
  modal.classList.add("active");
  const zone = document.getElementById("contenu-stats-classe");
  zone.innerHTML = `<p class="aide-apercu">Chargement…</p>`;
  try {
    const [reponse, boss] = await Promise.all([
      fetch("/api/points?stats_equilibrage=1", { credentials: "include" }),
      chargerBoss()
    ]);
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(data.error || "Impossible de charger les stats.");
    donneesStatsClasse = data;
    listeBossStats = boss;
    remplirReglagesStats();
    rendreStatsClasse();
  } catch (erreur) {
    console.error(erreur);
    zone.innerHTML = `<p class="message-ajout erreur">${echapper(erreur.message)}</p>`;
  }
}

function remplirReglagesStats() {
  document.getElementById("stats-periode").value = reglagesStats.periode;
  document.getElementById("stats-depuis").value = reglagesStats.depuis;
  document.getElementById("stats-depuis").hidden = reglagesStats.periode !== "date";
  document.getElementById("stats-ecart").value = reglagesStats.ecart;
  document.getElementById("stats-minimum").value = reglagesStats.minimum;
  const patchs = donneesStatsClasse?.patchs || [];
  const dernier = patchs[patchs.length - 1];
  document.querySelector('#stats-periode option[value="patch"]').textContent = dernier
    ? `Depuis le dernier patch (${new Date(dernier).toLocaleDateString("fr-FR")})` : "Depuis le dernier patch (aucun)";
}

function initialiserStatsClasse() {
  lireReglagesStats();
  const modal = document.getElementById("modal-stats-classe");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-stats-classe").addEventListener("click", ouvrirStatsClasse);
  document.getElementById("fermer-stats-classe").addEventListener("click", fermer);
  modal.addEventListener("click", event => { if (event.target === modal) fermer(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  const nombre = (valeur, min, max, defaut) => {
    const n = Number(String(valeur).replace(",", "."));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut;
  };
  document.getElementById("reglages-stats-classe").addEventListener("input", () => {
    reglagesStats = {
      periode: document.getElementById("stats-periode").value,
      depuis: document.getElementById("stats-depuis").value,
      ecart: nombre(document.getElementById("stats-ecart").value, 0, 200, REGLAGES_STATS_DEFAUT.ecart),
      minimum: nombre(document.getElementById("stats-minimum").value, 0, 600, REGLAGES_STATS_DEFAUT.minimum)
    };
    document.getElementById("stats-depuis").hidden = reglagesStats.periode !== "date";
    ecrireReglagesStats();
    rendreStatsClasse();
  });
}

initialiserStatsClasse();
