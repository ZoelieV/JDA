// Éditeur du visual novel : modifie une copie de l'histoire dans la page, puis
// l'enregistre d'un bloc (cf. api/_lib/vn_edition.js, format : visual_novel.js).
const edEl = id => document.getElementById(id);

function creer(balise, proprietes = {}, ...enfants) {
  const element = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(proprietes)) {
    if (cle.startsWith("on")) element.addEventListener(cle.slice(2).toLowerCase(), valeur);
    else if (cle === "classe") element.className = valeur;
    else element[cle] = valeur;
  }
  element.append(...enfants.filter(e => e != null));
  return element;
}

let histoire = null;
let majHistoire = null;
let modifie = false;
let selection = { chapitre: null, sc: null, panneau: null };
let persoChoisi = 0;

const nouvelId = prefixe => `${prefixe}${Math.random().toString(36).slice(2, 10)}`;
const chapitreChoisi = () => histoire.chapitres.find(c => c.id === selection.chapitre);
const scChoisi = () => chapitreChoisi()?.sous_chapitres.find(s => s.id === selection.sc);
const panneauChoisi = () => scChoisi()?.panneaux.find(p => p.id === selection.panneau);

function marquerModifie() {
  modifie = true;
  edEl("ed-etat").textContent = "Modifications non enregistrées";
}

// Déplace un élément d'une liste d'un cran (sens : -1 ou +1).
function deplacer(liste, element, sens) {
  const i = liste.indexOf(element);
  const j = i + sens;
  if (j < 0 || j >= liste.length) return;
  [liste[i], liste[j]] = [liste[j], liste[i]];
  marquerModifie();
}

function resumePanneau(panneau, numero) {
  const texte = decouperTexteVn(panneau.texte).map(m => m.texte).join("");
  return `${numero}. ${panneau.nom ? `${panneau.nom} : ` : ""}${texte || "(vide)"}`;
}

// ---- Création ----
// Nouveau panneau : mêmes fond, personnages et police que le modèle, comme
// pour la suite d'une même scène.
function creerPanneau(modele) {
  return {
    id: nouvelId("p"),
    fond: modele?.fond || null,
    nom: "",
    texte: "",
    persos: structuredClone(modele?.persos || []),
    police: structuredClone(modele?.police || lirePoliceVn()),
    effets: [],
    sauvegarde: false,
    timer: null,
    musique: null,
    son: null,
    ensuite: { type: "suite" }
  };
}

const creerSousChapitre = (titre, modele) => ({ id: nouvelId("s"), titre, panneaux: [creerPanneau(modele)] });

function choisir(chapitreId, scId, panneauId) {
  selection = { chapitre: chapitreId, sc: scId, panneau: panneauId };
  persoChoisi = 0;
  rendreTout();
}

function choisirPremier(chapitre) {
  const sc = chapitre.sous_chapitres[0];
  choisir(chapitre.id, sc.id, sc.panneaux[0].id);
}

// ---- Plan de l'histoire ----
// Date ISO <-> valeur d'un champ datetime-local, à l'heure de l'admin.
function dateVersChamp(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const champVersDate = valeur => (valeur ? new Date(valeur).toISOString() : null);

function boutonsDeplacement(liste, element, { apresSuppression, confirmation }) {
  return [
    creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "↑", title: "Monter", onclick: () => { deplacer(liste, element, -1); rendreArbre(); } }),
    creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "↓", title: "Descendre", onclick: () => { deplacer(liste, element, 1); rendreArbre(); } }),
    creer("button", {
      type: "button",
      classe: "ed-bouton ed-mini",
      textContent: "×",
      title: liste.length > 1 ? "Supprimer" : "Il en faut au moins un",
      disabled: liste.length <= 1,
      onclick: () => {
        const message = confirmation();
        if (message && !confirm(message)) return;
        liste.splice(liste.indexOf(element), 1);
        marquerModifie();
        apresSuppression();
      }
    })
  ];
}

function rendreArbre() {
  edEl("ed-arbre").replaceChildren(...histoire.chapitres.map(chapitre => {
    const nbPanneaux = chapitre.sous_chapitres.reduce((total, sc) => total + sc.panneaux.length, 0);
    const actif = chapitre.id === selection.chapitre;
    return creer("div", { classe: "ed-chapitre" },
      creer("div", { classe: "ed-noeud" },
        creer("button", { type: "button", classe: `ed-noeud-nom${actif ? " ed-actif" : ""}`, textContent: chapitre.titre, title: chapitre.titre, onclick: () => choisirPremier(chapitre) }),
        chapitre.public ? creer("span", { classe: "ed-badge", textContent: "public" }) : null,
        ...boutonsDeplacement(histoire.chapitres, chapitre, {
          confirmation: () => `Supprimer « ${chapitre.titre} » et ses ${nbPanneaux} panneaux ?`,
          apresSuppression: () => choisirPremier(histoire.chapitres[0])
        })
      ),
      actif ? rendreChapitre(chapitre) : null
    );
  }));
}

function rendreChapitre(chapitre) {
  return creer("div", {},
    creer("div", { classe: "ed-reglages" },
      creer("input", { type: "text", maxLength: 80, value: chapitre.titre, ariaLabel: "Titre du chapitre", oninput: e => { chapitre.titre = e.target.value; marquerModifie(); }, onchange: rendreArbre }),
      chapitre.namecard ? creer("img", { src: imageVn(chapitre.namecard), alt: "" }) : null,
      creer("button", { type: "button", classe: "ed-bouton", textContent: "Namecard du chapitre", onclick: () => ouvrirImages("namecard", chemin => { chapitre.namecard = chemin; marquerModifie(); rendreArbre(); }) }),
      creer("label", {}, creer("input", { type: "checkbox", checked: chapitre.public === true, onchange: e => { chapitre.public = e.target.checked; marquerModifie(); rendreArbre(); } }), " Chapitre visible par tout le monde"),
      creer("label", { classe: "ed-champ" }, "Sortie", creer("input", { type: "datetime-local", value: dateVersChamp(chapitre.sortie), ariaLabel: "Date de sortie du chapitre", onchange: e => { chapitre.sortie = champVersDate(e.target.value); marquerModifie(); } })),
      creer("p", { classe: "ed-aide", textContent: "Sans date : dès qu'il est visible. Avant sa sortie, les joueurs ne le voient pas ; les vrais admins peuvent déjà le tester." })
    ),
    ...chapitre.sous_chapitres.map(sc => rendreSousChapitre(chapitre, sc)),
    creer("button", {
      type: "button",
      classe: "ed-bouton ed-large",
      textContent: "+ Sous-chapitre",
      onclick: () => {
        const sc = creerSousChapitre(`Sous-chapitre ${chapitre.sous_chapitres.length + 1}`, panneauChoisi());
        chapitre.sous_chapitres.push(sc);
        marquerModifie();
        choisir(chapitre.id, sc.id, sc.panneaux[0].id);
      }
    })
  );
}

function rendreSousChapitre(chapitre, sc) {
  const actif = sc.id === selection.sc;
  return creer("div", { classe: "ed-sous-chapitre" },
    creer("div", { classe: "ed-noeud" },
      creer("button", { type: "button", classe: "ed-noeud-nom", textContent: sc.titre, title: sc.titre, onclick: () => choisir(chapitre.id, sc.id, sc.panneaux[0].id) }),
      ...boutonsDeplacement(chapitre.sous_chapitres, sc, {
        confirmation: () => `Supprimer « ${sc.titre} » et ses ${sc.panneaux.length} panneaux ?`,
        apresSuppression: () => choisirPremier(chapitre)
      })
    ),
    actif ? creer("div", { classe: "ed-reglages" },
      creer("input", { type: "text", maxLength: 80, value: sc.titre, ariaLabel: "Titre du sous-chapitre", oninput: e => { sc.titre = e.target.value; marquerModifie(); }, onchange: rendreArbre })
    ) : null,
    actif ? creer("div", { classe: "ed-panneaux" },
      ...sc.panneaux.map((panneau, i) => rendrePanneauArbre(chapitre, sc, panneau, i)),
      creer("div", { classe: "ed-ligne" },
        creer("button", { type: "button", classe: "ed-bouton", textContent: "+ Panneau", onclick: () => ajouterPanneau(chapitre, sc) }),
        creer("button", { type: "button", classe: "ed-bouton", textContent: "Dupliquer", title: "Copie ce panneau, texte compris", onclick: () => dupliquerPanneau(chapitre, sc) })
      )
    ) : null
  );
}

const BADGES = { choix: "choix", texte: "texte", fin: "fin", game_over: "game over" };

function rendrePanneauArbre(chapitre, sc, panneau, i) {
  const resume = resumePanneau(panneau, i + 1);
  const badge = BADGES[panneau.ensuite.type];
  return creer("div", { classe: "ed-noeud" },
    creer("button", { type: "button", classe: `ed-noeud-nom${panneau.id === selection.panneau ? " ed-actif" : ""}`, textContent: resume, title: resume, onclick: () => choisir(chapitre.id, sc.id, panneau.id) }),
    panneau.sauvegarde ? creer("span", { classe: "ed-badge", textContent: "sauv." }) : null,
    panneau.timer ? creer("span", { classe: "ed-badge", textContent: "timer" }) : null,
    badge ? creer("span", { classe: "ed-badge", textContent: badge }) : null,
    ...boutonsDeplacement(sc.panneaux, panneau, {
      confirmation: () => (panneau.texte ? "Supprimer ce panneau ?" : null),
      apresSuppression: () => choisir(chapitre.id, sc.id, sc.panneaux[Math.max(0, i - 1)].id)
    })
  );
}

function insererApres(sc, panneau, reference) {
  const i = sc.panneaux.indexOf(reference);
  sc.panneaux.splice(i === -1 ? sc.panneaux.length : i + 1, 0, panneau);
  marquerModifie();
}

function ajouterPanneau(chapitre, sc) {
  const reference = panneauChoisi();
  const panneau = creerPanneau(reference);
  insererApres(sc, panneau, reference);
  choisir(chapitre.id, sc.id, panneau.id);
  edEl("ed-texte").focus();
}

function dupliquerPanneau(chapitre, sc) {
  const reference = panneauChoisi();
  // La copie ne reprend pas la suite : deux fois la même fin ou les mêmes
  // réponses n'auraient pas de sens, ni le même timer ou les mêmes effets.
  const panneau = { ...structuredClone(reference), id: nouvelId("p"), ensuite: { type: "suite" }, effets: [], sauvegarde: false, timer: null, musique: null, son: null };
  insererApres(sc, panneau, reference);
  choisir(chapitre.id, sc.id, panneau.id);
}

// ---- Panneau : aperçu et texte ----
function rendreApercu() {
  const panneau = panneauChoisi();
  dessinerSceneVn(panneau);
  [...edEl("vn-persos").children].forEach((image, i) => {
    image.classList.toggle("ed-selection", i === persoChoisi);
    image.addEventListener("pointerdown", event => commencerGlissement(event, i));
  });
}

function commencerGlissement(event, index) {
  event.preventDefault();
  const panneau = panneauChoisi();
  const perso = panneau.persos[index];
  const image = event.currentTarget;
  const scene = edEl("vn-persos").getBoundingClientRect();
  const depart = { clientX: event.clientX, clientY: event.clientY, x: perso.x, y: perso.y };
  if (persoChoisi !== index) {
    persoChoisi = index;
    [...edEl("vn-persos").children].forEach((e, i) => e.classList.toggle("ed-selection", i === index));
    rendrePersos();
  }
  image.setPointerCapture(event.pointerId);
  const bouger = e => {
    perso.x = Math.round(Math.min(130, Math.max(-30, depart.x + (e.clientX - depart.clientX) / scene.width * 100)) * 10) / 10;
    perso.y = Math.round(Math.min(100, Math.max(-100, depart.y - (e.clientY - depart.clientY) / scene.height * 100)) * 10) / 10;
    image.style.left = `${perso.x}%`;
    image.style.bottom = `${perso.y}%`;
    marquerModifie();
  };
  const finir = () => {
    image.removeEventListener("pointermove", bouger);
    image.removeEventListener("pointerup", finir);
    image.removeEventListener("pointercancel", finir);
  };
  image.addEventListener("pointermove", bouger);
  image.addEventListener("pointerup", finir);
  image.addEventListener("pointercancel", finir);
}

function rendreFormulaire() {
  const panneau = panneauChoisi();
  edEl("ed-nom").value = panneau.nom;
  edEl("ed-texte").value = panneau.texte;
  const police = panneau.police = lirePoliceVn(panneau.police);
  edEl("ed-police").value = police.famille;
  edEl("ed-taille").value = police.taille;
  edEl("ed-gras").checked = police.gras;
  edEl("ed-italique").checked = police.italique;
}

// Ajoute (ou retire) la marque autour de la sélection du texte.
function appliquerMarque(marque) {
  const zone = edEl("ed-texte");
  const { selectionStart: debut, selectionEnd: fin, value } = zone;
  const choisi = value.slice(debut, fin);
  const dejaAutour = value.slice(debut - marque.length, debut) === marque && value.slice(fin, fin + marque.length) === marque;
  if (dejaAutour) {
    zone.value = value.slice(0, debut - marque.length) + choisi + value.slice(fin + marque.length);
    zone.setSelectionRange(debut - marque.length, fin - marque.length);
  } else {
    zone.value = value.slice(0, debut) + marque + choisi + marque + value.slice(fin);
    zone.setSelectionRange(debut + marque.length, fin + marque.length);
  }
  zone.focus();
  panneauChoisi().texte = zone.value;
  marquerModifie();
  rendreApercu();
  rendreArbre();
}

// ---- Panneau : personnages ----
const nomImage = chemin => chemin.split("/").pop().replace(/\.\w+$/, "");

function rendrePersos() {
  const panneau = panneauChoisi();
  edEl("ed-persos").replaceChildren(...panneau.persos.map((perso, i) => creer("div", { classe: `ed-carte${i === persoChoisi ? " ed-selection" : ""}` },
    creer("div", { classe: "ed-carte-haut" },
      creer("img", { src: imageVn(perso.image), alt: "", onclick: () => { persoChoisi = i; rendrePersos(); rendreApercu(); } }),
      creer("span", { classe: "ed-pousse", textContent: perso.image.startsWith("vn/") ? "Image importée" : nomImage(perso.image) }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "↑", title: "Plus en arrière", onclick: () => { deplacer(panneau.persos, perso, -1); persoChoisi = panneau.persos.indexOf(perso); rendrePersos(); rendreApercu(); } }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "↓", title: "Plus en avant", onclick: () => { deplacer(panneau.persos, perso, 1); persoChoisi = panneau.persos.indexOf(perso); rendrePersos(); rendreApercu(); } }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Retirer", onclick: () => { panneau.persos.splice(i, 1); persoChoisi = 0; marquerModifie(); rendrePersos(); rendreApercu(); } })
    ),
    creer("label", { classe: "ed-champ" }, "Taille",
      creer("input", { type: "range", min: 5, max: 250, value: perso.hauteur, oninput: e => { perso.hauteur = Number(e.target.value); marquerModifie(); rendreApercu(); } })
    ),
    creer("label", {}, creer("input", { type: "checkbox", checked: perso.miroir === true, onchange: e => { perso.miroir = e.target.checked; marquerModifie(); rendreApercu(); } }), " Miroir")
  )));
}

// ---- Panneau : suite ----
// Panneaux du chapitre, regroupés par sous-chapitre, pour les destinations.
function listeDestinations(valeur, { libelleVide, avecNouveau = true, onChange }) {
  const chapitre = chapitreChoisi();
  const liste = creer("select", { ariaLabel: "Destination", onchange: e => onChange(e.target.value) },
    creer("option", { value: "", textContent: libelleVide }),
    avecNouveau ? creer("option", { value: "__nouveau", textContent: "+ Nouveau panneau" }) : null,
    ...chapitre.sous_chapitres.map(sc => creer("optgroup", { label: sc.titre },
      // Fins et game over repérables d'un coup d'œil, pour choisir le bon.
      ...sc.panneaux.map((p, i) => creer("option", {
        value: p.id,
        textContent: `${p.ensuite?.type === "game_over" ? `[Game over : ${p.ensuite.nom}] ` : p.ensuite?.type === "fin" ? `[Fin : ${p.ensuite.nom}] ` : ""}${resumePanneau(p, i + 1)}`.slice(0, 80)
      }))
    ))
  );
  liste.value = valeur || "";
  return liste;
}

// Destination choisie, panneau créé juste après celui en cours si demandé.
function destination(valeur) {
  if (valeur !== "__nouveau") return valeur || null;
  const panneau = panneauChoisi();
  const nouveau = creerPanneau(panneau);
  insererApres(scChoisi(), nouveau, panneau);
  return nouveau.id;
}

const TYPES_SUITE = [
  ["suite", "Passer à un panneau"],
  ["choix", "Choix du joueur"],
  ["texte", "Texte libre du joueur"],
  ["fin", "Fin du chapitre"],
  ["game_over", "Game over"]
];

// Effets d'une conséquence : donner ou retirer un objet, activer ou retirer un état.
function editeurEffets(effets, apres) {
  const valeurs = [
    ...histoire.objets.flatMap(o => [[`objet+:${o.id}`, `Donner : ${o.nom}`], [`objet-:${o.id}`, `Retirer : ${o.nom}`]]),
    ...histoire.etats.flatMap(e => [[`etat+:${e.id}`, `Activer : ${e.nom}`], [`etat-:${e.id}`, `Retirer : ${e.nom}`]])
  ];
  const valeurDe = effet => (effet.genre === "objet" ? `objet${effet.quantite < 0 ? "-" : "+"}:${effet.id}` : `etat${effet.actif ? "+" : "-"}:${effet.id}`);
  const appliquer = (effet, valeur) => {
    const [, genre, sens, id] = /^(objet|etat)([+-]):(.+)$/.exec(valeur);
    const taille = Math.abs(effet.quantite) || 1;
    for (const cle of Object.keys(effet)) delete effet[cle];
    Object.assign(effet, genre === "objet" ? { genre, id, quantite: sens === "+" ? taille : -taille } : { genre, id, actif: sens === "+" });
  };
  return creer("div", { classe: "ed-effets" },
    ...effets.map((effet, i) => creer("div", { classe: "ed-carte-haut" },
      (() => {
        const liste = creer("select", { ariaLabel: "Effet", classe: "ed-pousse", onchange: e => { appliquer(effet, e.target.value); apres(); } },
          ...valeurs.map(([value, textContent]) => creer("option", { value, textContent })));
        if (!valeurs.some(([v]) => v === valeurDe(effet))) liste.prepend(creer("option", { value: "", textContent: "(supprimé)" }));
        liste.value = valeurs.some(([v]) => v === valeurDe(effet)) ? valeurDe(effet) : "";
        return liste;
      })(),
      effet.genre === "objet" ? creer("input", { type: "number", min: 1, max: 999, value: Math.abs(effet.quantite), ariaLabel: "Quantité", classe: "ed-nombre", oninput: e => {
        const taille = Math.max(1, Number(e.target.value) || 1);
        effet.quantite = effet.quantite < 0 ? -taille : taille;
        marquerModifie();
      } }) : null,
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Retirer", onclick: () => { effets.splice(i, 1); apres(); } })
    )),
    valeurs.length
      ? creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "+ Effet", disabled: effets.length >= 8, onclick: () => {
        const effet = {};
        appliquer(effet, valeurs[0][0]);
        effets.push(effet);
        apres();
      } })
      : creer("p", { classe: "ed-aide", textContent: "Pas d'effet possible : crée d'abord un objet ou un état." })
  );
}

// Destination, message et effets : pour une réponse, un résultat de dé, un timer...
function editeurConsequence(consequence, apres, { libelleVide = "Destination à choisir", placeholder = "Message affiché (facultatif)" } = {}) {
  return [
    listeDestinations(consequence.vers, { libelleVide, onChange: valeur => { consequence.vers = destination(valeur); apres(); } }),
    creer("input", { type: "text", maxLength: 500, value: consequence.message || "", placeholder, ariaLabel: "Message", oninput: e => { consequence.message = e.target.value; marquerModifie(); } }),
    editeurEffets(consequence.effets, apres)
  ];
}

const nouvelleConsequence = () => ({ vers: null, effets: [], message: "" });

const creerResultatDe = (min, max) => ({ min, max, ...nouvelleConsequence() });

function editeurResultatDe(de, resultat, i, apres) {
  const borne = (cle, placeholder) => creer("input", {
    type: "number",
    min: -100,
    max: 200,
    value: resultat[cle] ?? "",
    placeholder,
    ariaLabel: placeholder,
    classe: "ed-nombre",
    oninput: e => { resultat[cle] = e.target.value === "" ? null : Number(e.target.value); marquerModifie(); }
  });
  return creer("div", { classe: "ed-carte" },
    creer("div", { classe: "ed-carte-haut" },
      creer("span", { textContent: "Score" }), borne("min", "min"), creer("span", { textContent: "à" }), borne("max", "max"),
      creer("span", { classe: "ed-pousse" }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Retirer", onclick: () => { de.resultats.splice(i, 1); apres(); } })
    ),
    ...editeurConsequence(resultat, apres)
  );
}

function editeurOption(ensuite, option, i, apres) {
  return creer("div", { classe: "ed-carte" },
    creer("div", { classe: "ed-carte-haut" },
      creer("span", { classe: "ed-pousse", textContent: `Réponse ${i + 1}` }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Retirer", onclick: () => { ensuite.options.splice(i, 1); apres(); } })
    ),
    creer("input", { type: "text", maxLength: 300, value: option.texte, placeholder: "Texte de la réponse", ariaLabel: `Texte de la réponse ${i + 1}`, oninput: e => { option.texte = e.target.value; marquerModifie(); } }),
    (() => {
      const liste = creer("select", { ariaLabel: "Objet requis", onchange: e => { option.objet = e.target.value || null; apres(); } },
        creer("option", { value: "", textContent: "Aucun objet requis" }),
        ...histoire.objets.map(o => creer("option", { value: o.id, textContent: `Requiert : ${o.nom}` })));
      liste.value = option.objet || "";
      return liste;
    })(),
    option.objet ? creer("label", {}, creer("input", { type: "checkbox", checked: option.consomme, onchange: e => { option.consomme = e.target.checked; marquerModifie(); } }), " L'objet est consommé") : null,
    histoire.etats.length || option.etat ? (() => {
      const liste = creer("select", { ariaLabel: "Condition d'état", onchange: e => {
        const valeur = e.target.value;
        option.etat = valeur ? valeur.slice(1) : null;
        option.sans_etat = valeur.startsWith("-");
        apres();
      } },
        creer("option", { value: "", textContent: "Aucune condition d'état" }),
        ...histoire.etats.flatMap(etat => [
          creer("option", { value: `+${etat.id}`, textContent: `Seulement si : ${etat.nom}` }),
          creer("option", { value: `-${etat.id}`, textContent: `Sauf si : ${etat.nom}` })
        ]));
      liste.value = option.etat ? `${option.sans_etat ? "-" : "+"}${option.etat}` : "";
      return liste;
    })() : null,
    creer("label", {}, creer("input", { type: "checkbox", checked: !!option.de, onchange: e => {
      if (e.target.checked) option.de = { resultats: [creerResultatDe(11, null), creerResultatDe(null, 10)] };
      else delete option.de;
      apres();
    } }), " Lancer un dé (d20)"),
    ...(option.de
      ? [
        creer("p", { classe: "ed-aide", textContent: "Sur le score final (dé et états). Laisse min ou max vide pour une plage ouverte : « 20 et plus »." }),
        ...option.de.resultats.map((resultat, n) => editeurResultatDe(option.de, resultat, n, apres)),
        creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "+ Résultat", disabled: option.de.resultats.length >= 10, onclick: () => { option.de.resultats.push(creerResultatDe(null, null)); apres(); } }),
        editeurEffets(option.effets, apres)
      ]
      : editeurConsequence(option, apres))
  );
}

function editeurReponseAttendue(ensuite, reponse, i, apres) {
  return creer("div", { classe: "ed-carte" },
    creer("div", { classe: "ed-carte-haut" },
      creer("span", { classe: "ed-pousse", textContent: `Réponse attendue ${i + 1}` }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Retirer", onclick: () => { ensuite.reponses.splice(i, 1); apres(); } })
    ),
    creer("textarea", { rows: 2, value: reponse.valeurs.join("\n"), placeholder: "Une écriture acceptée par ligne", ariaLabel: `Écritures de la réponse ${i + 1}`, oninput: e => {
      reponse.valeurs = e.target.value.split("\n").map(v => v.trim()).filter(Boolean).slice(0, 20);
      marquerModifie();
    } }),
    creer("label", {}, creer("input", { type: "checkbox", checked: reponse.exact, onchange: e => { reponse.exact = e.target.checked; marquerModifie(); } }), " Exiger l'écriture exacte (majuscules et accents)"),
    ...editeurConsequence(reponse, apres)
  );
}

function rendreSuite() {
  const panneau = panneauChoisi();
  const { ensuite } = panneau;
  const apres = () => { marquerModifie(); rendreSuite(); rendreArbre(); };
  const contenu = [creer("select", {
    ariaLabel: "Ce qui suit ce panneau",
    onchange: e => {
      const type = e.target.value;
      const creations = {
        choix: () => ({ type, options: [nouvelleOption(), nouvelleOption()] }),
        texte: () => ({ type, consigne: "", reponses: [nouvelleReponse()], defaut: { ...nouvelleConsequence(), message: "Ce n'est pas la bonne réponse." } }),
        fin: () => ({ type, id: nouvelId("f"), nom: "Fin" }),
        game_over: () => ({ type, id: nouvelId("f"), nom: "Game over", est_fin: false, message: "" }),
        suite: () => ({ type })
      };
      panneau.ensuite = creations[type]();
      apres();
    }
  }, ...TYPES_SUITE.map(([value, textContent]) => creer("option", { value, textContent, selected: value === ensuite.type })))];

  if (ensuite.type === "suite") {
    contenu.push(listeDestinations(ensuite.vers, {
      libelleVide: "Panneau suivant dans la liste",
      onChange: valeur => { const vers = destination(valeur); if (vers) ensuite.vers = vers; else delete ensuite.vers; apres(); }
    }));
  } else if (ensuite.type === "fin" || ensuite.type === "game_over") {
    contenu.push(creer("label", {}, ensuite.type === "fin" ? "Nom de la fin" : "Nom du game over",
      creer("input", { type: "text", maxLength: 60, value: ensuite.nom, oninput: e => { ensuite.nom = e.target.value; marquerModifie(); } })
    ));
    if (ensuite.type === "game_over") {
      contenu.push(creer("input", { type: "text", maxLength: 500, value: ensuite.message || "", placeholder: "Texte de l'écran (sinon : « Ta partie s'arrête ici. »)", ariaLabel: "Texte de l'écran de game over", oninput: e => { ensuite.message = e.target.value; marquerModifie(); } }));
      contenu.push(creer("label", {}, creer("input", { type: "checkbox", checked: ensuite.est_fin, onchange: e => { ensuite.est_fin = e.target.checked; marquerModifie(); } }), " Compte comme une fin du chapitre (100 %)"));
      contenu.push(creer("p", { classe: "ed-aide", textContent: "Le joueur reprend au dernier point de sauvegarde, avec l'inventaire de ce moment-là, ou recommence le chapitre." }));
    }
  } else if (ensuite.type === "texte") {
    contenu.push(
      creer("input", { type: "text", maxLength: 200, value: ensuite.consigne, placeholder: "Consigne dans le champ (facultatif)", ariaLabel: "Consigne", oninput: e => { ensuite.consigne = e.target.value; marquerModifie(); } }),
      creer("p", { classe: "ed-aide", textContent: "Par défaut, accents, majuscules et petites fautes sont tolérés. Le joueur ne voit jamais les réponses attendues." }),
      ...ensuite.reponses.map((reponse, i) => editeurReponseAttendue(ensuite, reponse, i, apres)),
      creer("button", { type: "button", classe: "ed-bouton ed-large", textContent: "+ Réponse attendue", disabled: ensuite.reponses.length >= 10, onclick: () => { ensuite.reponses.push(nouvelleReponse()); apres(); } }),
      creer("div", { classe: "ed-carte" },
        creer("span", { textContent: "Toute autre réponse" }),
        ...editeurConsequence(ensuite.defaut, apres, { libelleVide: "Rester sur ce panneau", placeholder: "Message pour une mauvaise réponse" })
      )
    );
  } else {
    ensuite.options.forEach((option, i) => contenu.push(editeurOption(ensuite, option, i, apres)));
    contenu.push(creer("button", {
      type: "button",
      classe: "ed-bouton ed-large",
      textContent: "+ Réponse",
      disabled: ensuite.options.length >= 8,
      onclick: () => { ensuite.options.push(nouvelleOption()); apres(); }
    }));
  }
  edEl("ed-suite").replaceChildren(...contenu);
}

const nouvelleOption = () => ({ id: nouvelId("o"), texte: "", ...nouvelleConsequence(), objet: null, consomme: false, etat: null, sans_etat: false });
const nouvelleReponse = () => ({ id: nouvelId("o"), valeurs: [], exact: false, ...nouvelleConsequence() });

// ---- Panneau : sauvegarde, timer, effets à l'arrivée, sons ----
function listeSons(valeur, premiers, surChoix) {
  const liste = creer("select", { onchange: e => surChoix(e.target.value) },
    ...premiers.map(([value, textContent]) => creer("option", { value, textContent })),
    ...histoire.sons.map(son => creer("option", { value: son.chemin, textContent: son.nom })));
  liste.value = valeur || "";
  return liste;
}

function rendreOptionsPanneau() {
  const panneau = panneauChoisi();
  const apres = () => { marquerModifie(); rendreOptionsPanneau(); rendreSuite(); rendreArbre(); };
  edEl("ed-panneau-options").replaceChildren(...[
    creer("label", {}, creer("input", { type: "checkbox", id: "ed-sauvegarde", checked: panneau.sauvegarde, onchange: e => { panneau.sauvegarde = e.target.checked; apres(); } }), " Point de sauvegarde"),
    creer("div", {},
      creer("label", {}, creer("input", { type: "checkbox", id: "ed-timer", checked: !!panneau.timer, onchange: e => {
        panneau.timer = e.target.checked ? { duree: 30, ...nouvelleConsequence(), message: "Le temps est écoulé." } : null;
        apres();
      } }), " Timer à partir de ce panneau")
    ),
    panneau.timer ? creer("div", { classe: "ed-carte" },
      creer("label", { classe: "ed-champ" }, "Durée (secondes)",
        creer("input", { type: "number", min: 1, max: 3600, value: panneau.timer.duree, classe: "ed-nombre", oninput: e => { panneau.timer.duree = Math.max(1, Number(e.target.value) || 1); marquerModifie(); } })),
      creer("p", { classe: "ed-aide", textContent: "S'arrête à la prochaine réponse du joueur et continue si la page est rechargée. Quand le temps est écoulé :" }),
      ...editeurConsequence(panneau.timer, apres, { libelleVide: "Rester sur place", placeholder: "Message quand le temps est écoulé" })
    ) : null,
    creer("p", { classe: "ed-aide", textContent: "En arrivant sur ce panneau :" }),
    editeurEffets(panneau.effets, apres),
    creer("label", { classe: "ed-champ" }, "Musique",
      listeSons(panneau.musique, [["", "Ne change pas"], ["stop", "Arrêter la musique"]], valeur => { panneau.musique = valeur || null; marquerModifie(); })),
    creer("label", { classe: "ed-champ" }, "Son",
      listeSons(panneau.son, [["", "Aucun"]], valeur => { panneau.son = valeur || null; marquerModifie(); })),
    histoire.sons.length ? null : creer("p", { classe: "ed-aide", textContent: "Importe des sons avec le bouton « Objets, états et sons »." })
  ].filter(Boolean));
}

// ---- Objets, états et sons ----
let sonEcoute = null;

function rendreCatalogue() {
  const retirer = (liste, element, utilise, message) => {
    if (utilise && !confirm(message)) return;
    liste.splice(liste.indexOf(element), 1);
    marquerModifie();
    rendreCatalogue();
  };
  const estUtilise = id => JSON.stringify(histoire.chapitres).includes(`"${id}"`);

  edEl("ed-objets").replaceChildren(...histoire.objets.map(objet => creer("div", { classe: "ed-carte" },
    creer("div", { classe: "ed-carte-haut" },
      objet.image ? creer("img", { src: imageVn(objet.image), alt: "" }) : null,
      creer("input", { type: "text", maxLength: 60, value: objet.nom, classe: "ed-pousse", ariaLabel: "Nom de l'objet", oninput: e => { objet.nom = e.target.value; marquerModifie(); } }),
      creer("label", { classe: "ed-champ" }, "Limite", creer("input", { type: "number", min: 1, max: 999, value: objet.limite, classe: "ed-nombre", oninput: e => { objet.limite = Math.max(1, Number(e.target.value) || 1); marquerModifie(); } })),
      creer("button", { type: "button", classe: "ed-bouton", textContent: "Image", onclick: () => ouvrirImages("objet", chemin => { objet.image = chemin; marquerModifie(); rendreCatalogue(); }) }),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Supprimer", onclick: () => retirer(histoire.objets, objet, estUtilise(objet.id), `L'histoire se sert de « ${objet.nom} ». Le supprimer quand même ?`) })
    ),
    creer("input", { type: "text", maxLength: 300, value: objet.description, placeholder: "Description (facultative)", ariaLabel: "Description de l'objet", oninput: e => { objet.description = e.target.value; marquerModifie(); } })
  )));

  edEl("ed-etats").replaceChildren(...histoire.etats.map(etat => creer("div", { classe: "ed-carte" },
    creer("div", { classe: "ed-carte-haut" },
      creer("input", { type: "text", maxLength: 60, value: etat.nom, classe: "ed-pousse", ariaLabel: "Nom de l'état", oninput: e => { etat.nom = e.target.value; marquerModifie(); } }),
      creer("label", { classe: "ed-champ" }, "Aux dés", creer("input", { type: "number", min: -20, max: 20, value: etat.valeur, classe: "ed-nombre", oninput: e => { etat.valeur = Number(e.target.value) || 0; marquerModifie(); } })),
      creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Supprimer", onclick: () => retirer(histoire.etats, etat, estUtilise(etat.id), `L'histoire se sert de « ${etat.nom} ». Le supprimer quand même ?`) })
    ),
    creer("input", { type: "text", maxLength: 300, value: etat.description, placeholder: "Description (facultative)", ariaLabel: "Description de l'état", oninput: e => { etat.description = e.target.value; marquerModifie(); } }),
    creer("label", {}, creer("input", { type: "checkbox", checked: etat.fin_chapitre, onchange: e => { etat.fin_chapitre = e.target.checked; marquerModifie(); } }), " S'arrête à la fin du chapitre")
  )));

  edEl("ed-sons").replaceChildren(...histoire.sons.map(son => creer("div", { classe: "ed-carte-haut ed-son" },
    creer("input", { type: "text", maxLength: 60, value: son.nom, classe: "ed-pousse", ariaLabel: "Nom du son", oninput: e => { son.nom = e.target.value; marquerModifie(); } }),
    creer("button", { type: "button", classe: "ed-bouton", textContent: "Écouter", onclick: () => {
      sonEcoute?.pause();
      sonEcoute = new Audio(imageVn(son.chemin));
      sonEcoute.play().catch(afficherErreurSons);
    } }),
    creer("button", { type: "button", classe: "ed-bouton ed-mini", textContent: "×", title: "Supprimer du stockage", onclick: () => supprimerSon(son) })
  )));
}

function afficherErreurSons(erreur) {
  console.error(erreur);
  edEl("ed-sons-etat").textContent = erreur.message || "Erreur";
}

async function supprimerSon(son) {
  if (JSON.stringify(histoire.chapitres).includes(son.chemin)) {
    edEl("ed-sons-etat").textContent = `Un panneau se sert de « ${son.nom} ».`;
    return;
  }
  if (!confirm(`Supprimer « ${son.nom} » du stockage ?`)) return;
  if (!await envoyer({ vn_image_suppression: { chemin: son.chemin } })) return;
  histoire.sons.splice(histoire.sons.indexOf(son), 1);
  marquerModifie();
  rendreCatalogue();
}

const POIDS_MAX_SON = 3 * 1024 * 1024;

function lireEnBase64(fichier) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(lecteur.result.slice(lecteur.result.indexOf(",") + 1));
    lecteur.onerror = () => rejeter(new Error("Lecture du fichier impossible."));
    lecteur.readAsDataURL(fichier);
  });
}

async function importerSon(fichier) {
  const etat = edEl("ed-sons-etat");
  const type = /\.mp3$/i.test(fichier.name) || fichier.type === "audio/mpeg" ? "mpeg" : /\.og[ga]$/i.test(fichier.name) || fichier.type === "audio/ogg" ? "ogg" : null;
  if (!type) { etat.textContent = "Formats acceptés : MP3, OGG."; return; }
  if (fichier.size > POIDS_MAX_SON) { etat.textContent = "Son trop lourd (3 Mo au plus) : réduis sa durée ou sa qualité."; return; }
  etat.textContent = "Envoi…";
  try {
    const reponse = await envoyer({ vn_import_son: { data: `data:audio/${type};base64,${await lireEnBase64(fichier)}` } });
    if (!reponse) { etat.textContent = "Envoi refusé."; return; }
    if (!histoire.sons.some(son => son.chemin === reponse.chemin)) {
      histoire.sons.push({ chemin: reponse.chemin, nom: fichier.name.replace(/\.\w+$/, "").slice(0, 60) });
      marquerModifie();
    }
    etat.textContent = "";
    rendreCatalogue();
  } catch (erreur) {
    afficherErreurSons(erreur);
  }
}

function rendreEntete() {
  edEl("ed-namecard-event").hidden = !histoire.namecard;
  if (histoire.namecard) edEl("ed-namecard-event").src = imageVn(histoire.namecard);
}

function rendreTout() {
  rendreArbre();
  rendreFormulaire();
  rendreApercu();
  rendrePersos();
  rendreOptionsPanneau();
  rendreSuite();
}

// ---- Choix et import d'images ----
let catalogueImages = null;

async function chargerCatalogue() {
  if (catalogueImages) return catalogueImages;
  const [cosmetiques, persos] = await Promise.all([
    fetch("/DB/images/cosmetiques.json").then(r => r.json()),
    fetch("/DB/characters.json").then(r => r.json())
  ]);
  catalogueImages = {
    fonds: cosmetiques.fonds.map(f => ({ chemin: f.image, miniature: f.miniature })),
    namecards: cosmetiques.bannieres.map(chemin => ({ chemin })),
    persos: [...new Set(persos.map(p => p.image.replace(/^images\//, "")))].map(chemin => ({ chemin }))
  };
  return catalogueImages;
}

async function chargerImportees() {
  const reponse = await fetch("/api/points?vn_images=1", { credentials: "include" });
  const data = await reponse.json();
  if (!reponse.ok) throw new Error(data.error || "Images importées introuvables");
  return data;
}

// Réduction selon l'usage de l'image, pour ménager le stockage.
const IMPORTS = {
  fond: { titre: "Choisir un fond", onglets: [["fonds", "Fonds du site"], ["namecards", "Namecards"], ["importees", "Images importées"]], largeur: 1920, hauteur: 1080 },
  perso: { titre: "Choisir un personnage", onglets: [["persos", "Personnages du site"], ["importees", "Images importées"]], largeur: 1600, hauteur: 1600 },
  namecard: { titre: "Choisir une namecard", onglets: [["namecards", "Namecards"], ["importees", "Images importées"]], largeur: 1200, hauteur: 600 },
  objet: { titre: "Choisir l'image de l'objet", onglets: [["importees", "Images importées"], ["persos", "Personnages du site"]], largeur: 400, hauteur: 400 }
};
const POIDS_MAX_IMPORT = 3 * 1024 * 1024;

let fenetreImages = { genre: null, onglet: null, surChoix: null };

async function ouvrirImages(genre, surChoix) {
  fenetreImages = { genre, onglet: IMPORTS[genre].onglets[0][0], surChoix };
  edEl("ed-images-titre").textContent = IMPORTS[genre].titre;
  edEl("ed-images-recherche").value = "";
  edEl("ed-images-etat").textContent = "";
  edEl("ed-images").showModal();
  await rendreImages();
}

async function rendreImages() {
  const { genre, onglet } = fenetreImages;
  edEl("ed-images-onglets").replaceChildren(...IMPORTS[genre].onglets.map(([id, nom]) => creer("button", {
    type: "button",
    classe: `ed-bouton${id === onglet ? " ed-onglet-actif" : ""}`,
    textContent: nom,
    onclick: () => { fenetreImages.onglet = id; rendreImages().catch(afficherErreurImages); }
  })));
  let images;
  if (onglet === "importees") {
    const { images: importees, poids, poids_max: poidsMax } = await chargerImportees();
    images = importees.map(chemin => ({ chemin }));
    edEl("ed-images-etat").textContent = `${Math.round(poids / 1048576)} Mo utilisés sur ${Math.round(poidsMax / 1048576)} Mo`;
  } else {
    images = (await chargerCatalogue())[onglet];
    edEl("ed-images-etat").textContent = "";
  }
  const recherche = edEl("ed-images-recherche").value.trim().toLowerCase();
  edEl("ed-images-grille").replaceChildren(...images
    .filter(image => !recherche || image.chemin.toLowerCase().includes(recherche))
    .map(image => creer("div", { classe: "ed-image", title: nomImage(image.chemin), tabIndex: 0, role: "button",
      onclick: event => { if (!event.target.closest(".ed-image-supprimer")) choisirImage(image.chemin); },
      onkeydown: event => { if (event.key === "Enter" && event.target === event.currentTarget) choisirImage(image.chemin); } },
      creer("img", { src: imageVn(image.miniature || image.chemin), alt: "", loading: "lazy" }),
      onglet === "importees" ? creer("button", { type: "button", classe: "ed-bouton ed-mini ed-image-supprimer", textContent: "×", title: "Supprimer du stockage", onclick: () => supprimerImportee(image.chemin) }) : null
    )));
}

function afficherErreurImages(erreur) {
  console.error(erreur);
  edEl("ed-images-etat").textContent = erreur.message || "Erreur";
}

function choisirImage(chemin) {
  edEl("ed-images").close();
  fenetreImages.surChoix(chemin);
}

async function supprimerImportee(chemin) {
  if (!confirm("Supprimer cette image du stockage ?")) return;
  // Un panneau pas encore enregistré peut s'en servir : l'enregistré est vérifié par le serveur.
  if (JSON.stringify(histoire).includes(chemin)) {
    edEl("ed-images-etat").textContent = "Cette histoire se sert de cette image.";
    return;
  }
  const reponse = await envoyer({ vn_image_suppression: { chemin } });
  if (reponse) await rendreImages().catch(afficherErreurImages);
}

async function imageEnWebp(fichier, { largeur, hauteur }) {
  if (!["image/png", "image/webp", "image/jpeg"].includes(fichier.type)) throw new Error("Formats acceptés : PNG, WebP, JPEG.");
  if (fichier.size > 20 * 1024 * 1024) throw new Error("Image trop lourde (20 Mo au plus).");
  const bitmap = await createImageBitmap(fichier);
  const echelle = Math.min(1, largeur / bitmap.width, hauteur / bitmap.height);
  const canvas = creer("canvas", { width: Math.round(bitmap.width * echelle), height: Math.round(bitmap.height * echelle) });
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const qualite of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL("image/webp", qualite);
    if (!url.startsWith("data:image/webp")) throw new Error("Ce navigateur ne sait pas créer de WebP : utilise Chrome, Firefox ou Edge.");
    if (url.length * 0.75 <= POIDS_MAX_IMPORT) return url;
  }
  throw new Error("Image trop lourde, même réduite.");
}

async function importerFichier(fichier) {
  edEl("ed-images-etat").textContent = "Envoi…";
  try {
    const data = await imageEnWebp(fichier, IMPORTS[fenetreImages.genre]);
    const reponse = await envoyer({ vn_import: { data } });
    if (reponse) choisirImage(reponse.chemin);
    else edEl("ed-images-etat").textContent = "Envoi refusé.";
  } catch (erreur) {
    afficherErreurImages(erreur);
  }
}

// ---- Serveur ----
async function envoyer(corps) {
  const reponse = await fetch("/api/points", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps)
  });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    alert(data.error || "Échec de l'enregistrement.");
    return null;
  }
  return data;
}

function afficherAvertissements(liste) {
  const zone = edEl("ed-avertissements");
  zone.hidden = !liste.length;
  zone.replaceChildren(...liste.map(texte => creer("li", { textContent: texte })));
}

async function enregistrer() {
  const bouton = edEl("ed-enregistrer");
  bouton.disabled = true;
  edEl("ed-etat").textContent = "Enregistrement…";
  try {
    const reponse = await envoyer({ vn_sauvegarde: { histoire, maj: majHistoire } });
    if (!reponse) {
      edEl("ed-etat").textContent = "Pas enregistré";
      return false;
    }
    majHistoire = reponse.maj;
    modifie = false;
    edEl("ed-essai").hidden = true;
    afficherAvertissements(reponse.avertissements);
    edEl("ed-etat").textContent = "Enregistré";
    return true;
  } catch (erreur) {
    console.error(erreur);
    edEl("ed-etat").textContent = "Connexion perdue : pas enregistré";
    return false;
  } finally {
    bouton.disabled = false;
  }
}

async function tester() {
  // Onglet ouvert tout de suite : sinon le navigateur le bloque après l'attente.
  const onglet = window.open("", "_blank");
  if (modifie && !await enregistrer()) {
    onglet?.close();
    return;
  }
  const adresse = `/visual_novel/lecteur?chapitre=${encodeURIComponent(selection.chapitre)}&panneau=${encodeURIComponent(selection.panneau)}`;
  if (onglet) onglet.location = adresse;
  else location.href = adresse;
}

// ---- Démarrage ----
function brancherFormulaire() {
  const surPanneau = (id, evenement, appliquer) => edEl(id).addEventListener(evenement, event => {
    appliquer(panneauChoisi(), event.target);
    marquerModifie();
    rendreApercu();
  });
  surPanneau("ed-nom", "input", (p, e) => { p.nom = e.value; });
  surPanneau("ed-texte", "input", (p, e) => { p.texte = e.value; });
  surPanneau("ed-police", "change", (p, e) => { p.police.famille = e.value; });
  surPanneau("ed-taille", "input", (p, e) => { p.police.taille = Number(e.value); });
  surPanneau("ed-gras", "change", (p, e) => { p.police.gras = e.checked; });
  surPanneau("ed-italique", "change", (p, e) => { p.police.italique = e.checked; });
  ["ed-nom", "ed-texte"].forEach(id => edEl(id).addEventListener("change", rendreArbre));

  edEl("ed-police").replaceChildren(...POLICES_VN.map(p => creer("option", { value: p.id, textContent: p.nom })));
  edEl("ed-taille").min = TAILLE_TEXTE_VN.min;
  edEl("ed-taille").max = TAILLE_TEXTE_VN.max;

  document.querySelectorAll("[data-marque]").forEach(bouton => {
    bouton.addEventListener("click", () => appliquerMarque(bouton.dataset.marque));
  });
  edEl("ed-nom-histoire").addEventListener("input", e => { histoire.nom = e.target.value; marquerModifie(); });
  edEl("ed-public-event").addEventListener("change", e => { histoire.public = e.target.checked; marquerModifie(); });
  edEl("ed-choisir-namecard-event").addEventListener("click", () => ouvrirImages("namecard", chemin => { histoire.namecard = chemin; marquerModifie(); rendreEntete(); }));
  edEl("ed-ajouter-chapitre").addEventListener("click", () => {
    const chapitre = { id: nouvelId("c"), titre: `Chapitre ${histoire.chapitres.length + 1}`, namecard: null, public: false, sortie: null, sous_chapitres: [creerSousChapitre("Sous-chapitre 1")] };
    histoire.chapitres.push(chapitre);
    marquerModifie();
    choisirPremier(chapitre);
  });
  edEl("ed-choisir-fond").addEventListener("click", () => ouvrirImages("fond", chemin => { panneauChoisi().fond = chemin; marquerModifie(); rendreApercu(); }));
  edEl("ed-retirer-fond").addEventListener("click", () => { panneauChoisi().fond = null; marquerModifie(); rendreApercu(); });
  edEl("ed-ajouter-perso").addEventListener("click", () => ouvrirImages("perso", chemin => {
    const { persos } = panneauChoisi();
    persos.push({ image: chemin, x: 50, y: 30, hauteur: 42, miroir: false });
    persoChoisi = persos.length - 1;
    marquerModifie();
    rendrePersos();
    rendreApercu();
  }));
  edEl("ed-enregistrer").addEventListener("click", enregistrer);
  edEl("ed-tester").addEventListener("click", tester);
  edEl("ed-reinitialiser").addEventListener("click", async () => {
    if (!confirm("Effacer ta progression de lecture sur tous les chapitres ?")) return;
    if (await envoyer({ vn_reinitialiser: true })) edEl("ed-etat").textContent = "Progression effacée";
  });
  edEl("ed-ouvrir-catalogue").addEventListener("click", () => {
    rendreCatalogue();
    edEl("ed-catalogue").showModal();
  });
  edEl("ed-catalogue-fermer").addEventListener("click", () => edEl("ed-catalogue").close());
  // Les noms et listes ont pu changer : les menus des panneaux aussi.
  edEl("ed-catalogue").addEventListener("close", () => { sonEcoute?.pause(); rendreOptionsPanneau(); rendreSuite(); });
  edEl("ed-ajouter-objet").addEventListener("click", () => {
    histoire.objets.push({ id: nouvelId("i"), nom: "Nouvel objet", description: "", image: null, limite: 1 });
    marquerModifie();
    rendreCatalogue();
  });
  edEl("ed-ajouter-etat").addEventListener("click", () => {
    histoire.etats.push({ id: nouvelId("e"), nom: "Nouvel état", description: "", valeur: -1, fin_chapitre: false });
    marquerModifie();
    rendreCatalogue();
  });
  edEl("ed-sons-import").addEventListener("change", event => {
    const [fichier] = event.target.files;
    event.target.value = "";
    if (fichier) importerSon(fichier);
  });
  edEl("ed-images-fermer").addEventListener("click", () => edEl("ed-images").close());
  edEl("ed-images-recherche").addEventListener("input", () => rendreImages().catch(afficherErreurImages));
  edEl("ed-images-import").addEventListener("change", event => {
    const [fichier] = event.target.files;
    event.target.value = "";
    if (fichier) importerFichier(fichier);
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      enregistrer();
    }
  });
  window.addEventListener("beforeunload", event => {
    if (modifie) event.preventDefault();
  });
}

async function demarrerEditeur() {
  const chargement = edEl("ed-chargement");
  try {
    const reponse = await fetch("/api/points?vn_edition=1", { credentials: "include" });
    const data = await reponse.json().catch(() => ({}));
    if (reponse.status === 401) { chargement.textContent = "Connecte-toi avec Discord pour écrire l'histoire."; return; }
    if (!reponse.ok) { chargement.textContent = data.error || "Éditeur indisponible."; return; }
    histoire = data.histoire;
    majHistoire = data.maj;
    edEl("ed-essai").hidden = data.maj !== null;
    afficherAvertissements(data.avertissements);
    edEl("ed-nom-histoire").value = histoire.nom;
    edEl("ed-public-event").checked = histoire.public === true;
    brancherFormulaire();
    rendreEntete();
    chargement.hidden = true;
    edEl("ed-zone").hidden = false;
    choisirPremier(histoire.chapitres[0]);
  } catch (erreur) {
    console.error(erreur);
    chargement.textContent = "Connexion perdue : recharge la page.";
  }
}

demarrerEditeur();
