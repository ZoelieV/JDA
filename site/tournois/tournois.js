// Liste des tournois (/tournois) : une namecard par tournoi, filtres, bouton
// de création (cf. ouvrirFormulaireTournoi dans tournois/commun.js).

let listeTournois = [];
let createursTournois = {};
let filtreTournois = "actifs";

const ACTIFS = ["inscriptions", "verrouille", "qualifs", "arbre"];

function rendreListeTournois() {
  const grille = document.getElementById("grille-tournois");
  const etat = document.getElementById("etat-tournois");
  const visibles = listeTournois.filter(t => filtreTournois === "tous" ||
    (filtreTournois === "actifs" ? ACTIFS.includes(t.statut) : !ACTIFS.includes(t.statut)));
  etat.hidden = visibles.length > 0;
  etat.textContent = filtreTournois === "termines" ? "Aucun tournoi terminé." : "Aucun tournoi pour l'instant.";
  grille.innerHTML = visibles.map(t => `
    <a class="carte-tournoi" href="/tournoi?id=${encodeURIComponent(t.id)}">
      <div class="carte-tournoi-image"><h2 class="carte-tournoi-titre">${echapperTournoi(t.nom)}</h2></div>
      <div class="carte-tournoi-infos">
        ${t.vainqueur ? `<span class="victoire-tournoi">${htmlVictoireTournoi(echapperTournoi(t.vainqueur_nom || createursTournois[t.vainqueur]?.nom || "Le vainqueur"), t.recompense)}</span>` : ""}
        <div class="ligne-pastilles">
          <span class="pastille-tournoi statut-${t.statut}">${STATUTS_TOURNOI[t.statut] || t.statut}</span>
          <span class="pastille-tournoi">${formatTournoi(t)}</span>
          <span class="pastille-tournoi">${echapperTournoi(modeTournoi(t))}</span>
          ${htmlPastillesAffrontement(t)}
        </div>
        <span>📅 ${dateTournoi(t.debut)}${t.fin ? ` → ${dateTournoi(t.fin)}` : ""}</span>
        <span>👥 ${t.nb_participants} / ${t.max_participants} ${t.format === "equipe" ? "équipes" : "joueurs"}</span>
        <span>🏆 ${RECOMPENSES_TOURNOI[t.recompense?.type] || "—"}</span>
        <span class="doux">Organisé par ${echapperTournoi(createursTournois[t.createur]?.nom || t.createur_nom || "—")}</span>
      </div>
    </a>`).join("");
}

async function chargerTournois() {
  try {
    const donnees = await appelTournoi("liste");
    listeTournois = donnees.tournois || [];
    createursTournois = donnees.createurs || {};
    document.getElementById("creer-tournoi").hidden = !donnees.peut_creer;
    rendreListeTournois();
  } catch (erreur) {
    console.error(erreur);
    document.getElementById("etat-tournois").textContent = "Impossible de charger les tournois.";
  }
}

document.getElementById("filtres-tournois").addEventListener("click", event => {
  const bouton = event.target.closest("[data-filtre]");
  if (!bouton) return;
  filtreTournois = bouton.dataset.filtre;
  document.querySelectorAll("#filtres-tournois [data-filtre]").forEach(b => b.classList.toggle("actif", b === bouton));
  rendreListeTournois();
});
document.getElementById("creer-tournoi").addEventListener("click", () => {
  ouvrirFormulaireTournoi({ surSucces: id => { window.location.href = `/tournoi?id=${encodeURIComponent(id)}`; } });
});
chargerTournois();
