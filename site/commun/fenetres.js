// Fenêtres du site à la place de confirm(), alert() et prompt() du
// navigateur : même look que celles de la personnalisation (commun/fenetres.css,
// chargée ici). Aucune dépendance : utilisable sur toutes les pages.
// Les textes sont écrits avec textContent (jamais interprétés) ; les retours
// à la ligne (\n) sont gardés.

(function chargerStyleFenetres() {
  if (document.querySelector('link[href^="/commun/fenetres.css"]')) return;
  const lien = document.createElement("link");
  lien.rel = "stylesheet";
  lien.href = "/commun/fenetres.css?v=1";
  document.head.appendChild(lien);
})();

// Fenêtre générique -> Promise : valeur du champ (texte), true (sans champ)
// si validée, null / false si annulée (Échap, clic à côté, Annuler).
function ouvrirFenetreSite({ titre = "", texte = "", ok = "OK", annuler = "Annuler", danger = false, champ = null }) {
  return new Promise(resoudre => {
    const fenetre = document.createElement("dialog");
    fenetre.className = "fenetre-site";
    const formulaire = document.createElement("form");
    formulaire.method = "dialog";
    if (titre) {
      const h = document.createElement("h3");
      h.className = "fenetre-site-titre";
      h.textContent = titre;
      formulaire.append(h);
    }
    if (texte) {
      const p = document.createElement("p");
      p.className = "fenetre-site-texte";
      p.textContent = texte;
      formulaire.append(p);
    }
    let saisie = null;
    if (champ) {
      saisie = document.createElement("input");
      saisie.type = "text";
      saisie.className = "fenetre-site-champ";
      saisie.value = champ.valeur || "";
      saisie.readOnly = !!champ.lecture;
      if (champ.max) saisie.maxLength = champ.max;
      saisie.setAttribute("aria-label", titre || texte || "Saisie");
      formulaire.append(saisie);
    }
    const actions = document.createElement("div");
    actions.className = "fenetre-site-actions";
    let boutonAnnuler = null;
    if (annuler) {
      boutonAnnuler = document.createElement("button");
      boutonAnnuler.type = "button";
      boutonAnnuler.className = "fenetre-site-annuler";
      boutonAnnuler.textContent = annuler;
      boutonAnnuler.addEventListener("click", () => fenetre.close());
      actions.append(boutonAnnuler);
    }
    const boutonOk = document.createElement("button");
    boutonOk.type = "submit";
    boutonOk.className = `fenetre-site-ok${danger ? " danger" : ""}`;
    boutonOk.textContent = ok;
    actions.append(boutonOk);
    formulaire.append(actions);
    fenetre.append(formulaire);

    let valide = false;
    formulaire.addEventListener("submit", event => {
      event.preventDefault();
      valide = true;
      fenetre.close();
    });
    fenetre.addEventListener("click", event => { if (event.target === fenetre) fenetre.close(); });
    // Échap : ferme cette fenêtre seulement (pas une fenêtre du site en dessous).
    fenetre.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    fenetre.addEventListener("close", () => {
      fenetre.remove();
      if (champ) resoudre(valide ? saisie.value : null);
      else resoudre(valide);
    });
    document.body.appendChild(fenetre);
    fenetre.showModal();
    if (saisie) {
      saisie.focus();
      saisie.select();
    } else (danger && boutonAnnuler ? boutonAnnuler : boutonOk).focus();
  });
}

// À la place de confirm() -> Promise<boolean>. Un texte seul, ou { titre,
// texte, ok, annuler, danger } (danger : bouton rouge, focus sur Annuler).
function confirmerSite(options) {
  const reglages = typeof options === "string" ? { texte: options } : options;
  return ouvrirFenetreSite({ ok: "Confirmer", ...reglages });
}

// À la place de alert() -> Promise (résolue à la fermeture).
function alerterSite(texte, titre = "") {
  return ouvrirFenetreSite({ titre, texte: String(texte ?? ""), ok: "OK", annuler: null });
}

// À la place de prompt() -> Promise<texte | null>.
function demanderTexteSite({ titre = "", texte = "", valeur = "", ok = "Valider", max = null } = {}) {
  return ouvrirFenetreSite({ titre, texte, ok, champ: { valeur, max } });
}

// Lien à copier à la main (presse-papiers refusé), à la place de prompt().
function copierLienSite(lien, texte = "Copie ce lien :") {
  return ouvrirFenetreSite({ titre: "Lien à partager", texte, ok: "Fermer", annuler: null, champ: { valeur: lien, lecture: true } });
}

if (typeof module !== "undefined") module.exports = { confirmerSite, alerterSite, demanderTexteSite, copierLienSite };
