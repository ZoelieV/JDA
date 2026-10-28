// Créer un match : room privée (lien partagé, théâtre au choix),
// matchmaking ou classé (adversaire trouvé automatiquement dans le même
// mode, classique ou mêlée générale ; cf. api/_lib/matchmaking.js), tous
// via api/rooms. On arrive ensuite sur la page du match (attente de
// l'adversaire).

// Une seule demande à la fois, et plus rien une fois la page du match en
// cours d'ouverture : un 2e clic (double clic, page lente à s'ouvrir)
// relançait une recherche qui faisait quitter le match à peine trouvé
// (abandon en classé, cf. annulerAutresMatchs dans api/_lib/room.js).
let creationEnCours = false;

async function creerMatch(corps) {
  if (creationEnCours) return;
  creationEnCours = true;
  let ouverture = false;
  try {
    const reponse = await fetch("/api/rooms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps)
    });

    if (reponse.status === 401) {
      alert("Tu dois être connecté avec Discord pour créer un match.");
      return;
    }

    // Mode classique / auto sans théâtre renseigné (message du serveur).
    // Refus avec un message du serveur (mode classique sans théâtre, box
    // d'entraînement trop petite...).
    if (reponse.status === 409 || reponse.status === 400) {
      const { error, room_id: matchEnCours, vitrines_non_conformes: nonConformes } = await reponse.json().catch(() => ({}));
      // Entraînement en équipe : vitrines hors règles, lancé quand même si
      // le lanceur confirme (comme une box non équilibrable).
      if (nonConformes?.length) {
        const detail = nonConformes.map(v => `• ${v.libelle} (${v.nom}) : ${v.erreurs.join(", ")}`).join("\n");
        if (confirm(`Vitrines non conformes aux règles des modes en équipe :\n${detail}\n\nLancer l'entraînement quand même ?`)) {
          creationEnCours = false;
          ouverture = true;
          return creerMatch({ ...corps, config: { ...corps.config, forcer: true } });
        }
        return;
      }
      // Match classé en cours (cf. matchClasseEnCours, api/_lib/room.js) :
      // retour à ce match, ou abandon puis cette demande relancée
      // (proposerAbandonClasse ne revient qu'après un abandon).
      if (matchEnCours) {
        await proposerAbandonClasse(matchEnCours);
        creationEnCours = false;
        ouverture = true; // creationEnCours tenu par la nouvelle demande
        return creerMatch(corps);
      }
      alert(error || "Impossible de lancer ce mode.");
      return;
    }

    // Match privé : une room par minute au maximum (message du serveur).
    if (reponse.status === 429) {
      const { error } = await reponse.json().catch(() => ({}));
      alert(error || "Trop de rooms créées : réessaie dans une minute.");
      return;
    }

    if (!reponse.ok) {
      const { error } = await reponse.json().catch(() => ({}));
      alert(error || "Échec de la création du match.");
      return;
    }

    const data = await reponse.json();

    // Mode en équipe / Random world boss : page de leur lobby.
    ouverture = true;
    window.location.href = `/${data.equipe ? "equipe" : data.world_boss ? "world-boss" : "match"}?room=${data.room_id}`;
  } catch (error) {
    console.error(error);
    alert("Erreur lors de la création du match.");
  } finally {
    if (!ouverture) creationEnCours = false;
  }
}

// Retour sur cette page par le bouton Précédent (page gardée en cache) :
// nouvelle demande de nouveau possible.
window.addEventListener("pageshow", event => {
  if (event.persisted) creationEnCours = false;
});

// Options d'un menu de choix du boss, par catégorie : boss hebdomadaires,
// carnage chtonien, légendes locales (celles déjà tuées aujourd'hui sont
// refusées par le serveur).
// World boss et légendes "world_boss_seulement" : jamais dans les drafts
// (mode Random world boss seulement, cf. estReserveWorldBoss, api/_lib/boss.js).
function remplirSelectBoss(select, toutes) {
  const liste = toutes.filter(b => b.type !== "world_boss" && b.world_boss_seulement !== true);
  const groupes = [
    ["Boss Hebdomadaires", liste.filter(b => !estLegendeLocale(b) && b.type !== "carnage_boss")],
    ["Carnage Chtonien", liste.filter(b => b.type === "carnage_boss")],
    ["Légendes locales", liste.filter(estLegendeLocale)]
  ];
  groupes.filter(([, boss]) => boss.length).forEach(([titre, boss]) => {
    const groupe = document.createElement("optgroup");
    groupe.label = titre;
    boss.forEach(b => {
      const option = document.createElement("option");
      option.value = b.id;
      option.textContent = b.type === "legende_locale_jour" ? `${b.nom} (1 fois par jour)` : b.nom;
      groupe.appendChild(option);
    });
    select.appendChild(groupe);
  });
}

// Room privée / en équipe : liste des boss, remplie à la 1re ouverture.
const selectsBossCharges = new Set();
async function remplirBossRoom(idSelect = "room-boss") {
  if (selectsBossCharges.has(idSelect)) return;
  selectsBossCharges.add(idSelect);
  try {
    const [tous, points] = await Promise.all([chargerBoss(), chargerPointsAdmin()]);
    // Boss du carnage désactivés par les admins : seulement en entraînement
    // (cf. bossCarnageExclus, api/_lib/boss.js).
    const liste = points.carnage_desactive === true ? tous.filter(b => b.type !== "carnage_boss") : tous;
    // En équipe : sans les boss pas faisables en co-op ("coop": false, cf.
    // estHorsCoop, api/_lib/boss.js).
    remplirSelectBoss(document.getElementById(idSelect), idSelect === "equipe-boss" ? liste.filter(b => b.coop !== false) : liste);
  } catch (erreur) {
    console.error(erreur);
    selectsBossCharges.delete(idSelect);
  }
}

// Mode choisi : room privée (mode de théâtre au choix) ou recherche
// (matchmaking : classique, mêlée générale ou carnage ; classé : mêlée
// générale).
document.querySelectorAll(".mode-match").forEach(bouton => {
  bouton.addEventListener("click", () => {
    // Classé : bouton de la file "classe" dans le détail Matchmaking.
    const type = bouton.dataset.type || bouton.closest(".modes-match").dataset.type;
    const mode = bouton.dataset.mode;
    if (type === "equipe") {
      creerMatch({
        type,
        taille: Number(bouton.dataset.taille),
        formation: document.getElementById("equipe-formation").value,
        boss_id: document.getElementById("equipe-boss").value || null
      });
      return;
    }
    creerMatch(type === "prive"
      ? { mode, boss_id: document.getElementById("room-boss").value || null, premier: document.getElementById("room-premier").value }
      : { type, mode });
  });
});

// ---- Mode entraînement ----
// Configuration : draft (classée ou non, mode de théâtre), ta box et la box
// adverse (une des tiennes ; full d'un autre joueur ; ou une box
// personnalisée : persos et armes cochés dans la full box d'un joueur),
// boss et J1.
// Administrateurs et mini admins : box fictives en plus des joueurs (full,
// opti ou personnalisée, cf. api/_lib/boxes_fictives.js).
const MIN_PERSOS_BOX = 16; // cf. NB_PERSOS_MIN_BOX, api/_lib/draft.js
const LIBELLES_BOX = { full: "Full box", stuff: "Stuff", opti1: "Opti 1", opti2: "Opti 2", opti3: "Opti 3", opti4: "Opti 4", opti5: "Opti 5", custom: "Personnalisée" };

const entrainement = {
  pret: false,
  moi: null, // mon compte { id }
  comptes: [], // tous les joueurs { discord_id, nom }
  fictives: [], // box fictives (administrateurs) { id, nom }
  profils: new Map(), // discord_id -> données du profil (box)
  personnages: [],
  armes: [],
  // Entraînement en équipe : 2 × taille vitrines (équipe 1 puis équipe 2),
  // { proprietaire, persos: Set, armes: Set, ouverte }.
  taille: 1,
  vitrines: [],
  cotes: {
    // armes : copies cochées ("idArme", "idArme#2"... comme weapons.full).
    moi: { proprietaire: null, box: "full", persos: new Set(), armes: new Set() },
    adverse: { proprietaire: null, box: "full", persos: new Set(), armes: new Set() }
  }
};

async function chargerJSONApi(url) {
  const reponse = await fetch(url, { credentials: "include" });
  if (!reponse.ok) throw new Error("Chargement impossible.");
  return reponse.json();
}

async function profilJoueur(discordId) {
  if (!entrainement.profils.has(discordId)) {
    const compte = await chargerJSONApi(`/api/accounts/${encodeURIComponent(discordId)}`);
    migrerCollectionPersos(compte.data?.characters);
    entrainement.profils.set(discordId, compte.data || {});
  }
  return entrainement.profils.get(discordId);
}

function personnagesPossedes(profil) {
  const full = profil?.characters?.full || {};
  return entrainement.personnages.filter(p => (full[p.id] ?? -1) >= 0);
}

// Copies d'armes de la full box -> [{ instance, arme, raffinement }], dans
// l'ordre du catalogue.
function armesPossedees(profil) {
  const full = profil?.weapons?.full || {};
  const rang = new Map(entrainement.armes.map((arme, i) => [arme.id, i]));
  return Object.entries(full)
    .filter(([, raffinement]) => Number.isInteger(raffinement) && raffinement >= 0)
    .map(([instance, raffinement]) => ({ instance, raffinement, arme: entrainement.armes.find(a => a.id === instance.split("#")[0]) }))
    .filter(copie => copie.arme)
    .sort((a, b) => rang.get(a.arme.id) - rang.get(b.arme.id) || a.instance.localeCompare(b.instance));
}

// Sélecteur d'un côté : joueur, box, et persos cochés si personnalisée.
async function rendreSelecteurBox(cote) {
  const etat = entrainement.cotes[cote];
  const zone = document.querySelector(`.selecteur-box[data-cote="${cote}"]`);
  const estMoi = etat.proprietaire === entrainement.moi.id;
  const profil = await profilJoueur(etat.proprietaire);
  const nomsBoxes = estMoi ? profil.nomsBoxes || {} : {};
  // Box d'un autre joueur : full (ses box opti restent privées ; la box
  // "stuff" n'est plus jouable) ; box fictive : full ou sa box opti. Hors
  // full box : 5000 points au plus (vérifié par le serveur).
  const fictive = etat.proprietaire.startsWith("fictif_");
  const boxes = estMoi ? ["full", "opti1", "opti2", "opti3", "opti4", "opti5", "custom"]
    : fictive ? ["full", "opti1", "custom"] : ["full", "custom"];
  if (!boxes.includes(etat.box)) etat.box = "full";

  zone.innerHTML = `
    <label>Joueur <input type="text" class="ent-joueur" list="ent-joueurs-${cote}" autocomplete="off" placeholder="Rechercher un joueur…"></label>
    <datalist id="ent-joueurs-${cote}"></datalist>
    <div class="choix-boutons ent-box">
      ${boxes.map(box => `<button type="button" class="choix-btn${etat.box === box ? " active" : ""}" data-valeur="${box}"></button>`).join("")}
    </div>
    <div class="ent-perso-zone${etat.box === "custom" ? "" : " cache"}">
      <h4 class="ent-sous-titre">Personnages</h4>
      <div class="ligne-entrainement">
        <span class="ent-compteur"></span>
        <button type="button" class="choix-btn ent-tout">Tout cocher</button>
        <button type="button" class="choix-btn ent-rien">Tout décocher</button>
      </div>
      <div class="ent-persos"></div>
      <h4 class="ent-sous-titre">Armes</h4>
      <div class="ligne-entrainement">
        <span class="ent-compteur-armes"></span>
        <button type="button" class="choix-btn ent-toutes-armes">Tout cocher</button>
        <button type="button" class="choix-btn ent-aucune-arme">Tout décocher</button>
      </div>
      <div class="ent-persos ent-armes"></div>
    </div>
  `;

  // Libellés en texte (noms de box choisis par le joueur).
  zone.querySelectorAll(".ent-box .choix-btn").forEach(btn => {
    const box = btn.dataset.valeur;
    btn.textContent = typeof nomsBoxes[box] === "string" && nomsBoxes[box] ? nomsBoxes[box] : fictive && box === "opti1" ? "Opti" : LIBELLES_BOX[box];
  });

  // Joueur : champ de recherche avec suggestions (une liste déroulante de
  // tous les joueurs, trop longue, s'ouvrait par-dessus le champ et le
  // relâchement du clic choisissait le joueur sous la souris). Libellés
  // uniques (homonymes numérotés).
  const choix = [
    ...entrainement.comptes.map(compte => ({ id: compte.discord_id, libelle: compte.discord_id === entrainement.moi.id ? `${compte.nom} (moi)` : compte.nom })),
    ...entrainement.fictives.map(box => ({ id: box.id, libelle: `${box.nom} (box fictive)` }))
  ];
  const vus = new Map();
  choix.forEach(c => {
    const n = (vus.get(c.libelle) || 0) + 1;
    vus.set(c.libelle, n);
    if (n > 1) c.libelle = `${c.libelle} (${n})`;
  });
  const liste = zone.querySelector("datalist");
  choix.forEach(c => {
    const option = document.createElement("option");
    option.value = c.libelle;
    liste.appendChild(option);
  });
  const champ = zone.querySelector(".ent-joueur");
  const libelleActuel = choix.find(c => c.id === etat.proprietaire)?.libelle || "";
  champ.value = libelleActuel;
  // Clic : tout le texte sélectionné, la saisie remplace le nom.
  champ.addEventListener("focus", () => champ.select());
  champ.addEventListener("change", () => {
    const saisi = champ.value.trim().toLowerCase();
    const trouve = choix.find(c => c.libelle.toLowerCase() === saisi);
    if (!trouve || trouve.id === etat.proprietaire) {
      champ.value = libelleActuel;
      return;
    }
    etat.proprietaire = trouve.id;
    etat.persos = new Set();
    etat.armes = new Set();
    rendreSelecteurBox(cote);
  });

  zone.querySelectorAll(".ent-box .choix-btn").forEach(btn => btn.addEventListener("click", () => {
    etat.box = btn.dataset.valeur;
    rendreSelecteurBox(cote);
  }));

  if (etat.box !== "custom") return;
  const possedes = personnagesPossedes(profil);
  const grille = zone.querySelector(".ent-persos");
  const compteur = zone.querySelector(".ent-compteur");
  const majCompteur = () => {
    // Voyageur : un seul perso quel que soit le nombre d'éléments cochés.
    const nb = new Set(possedes.filter(p => etat.persos.has(p.id)).map(p => p.groupe || p.id)).size;
    compteur.textContent = `${nb} personnage${nb > 1 ? "s" : ""} (${MIN_PERSOS_BOX} minimum)`;
    compteur.classList.toggle("insuffisant", nb < MIN_PERSOS_BOX);
  };
  // Constellation (bas à droite), niveau 95 / 100 (haut à gauche),
  // pastille rouge (haut à droite) : pas dans la box stuff (persos montés)
  // du joueur.
  const constellations = profil?.characters?.full || {};
  const niveaux = profil?.characters?.niveaux || {};
  const stuff = profil?.characters?.selections?.stuff || {};
  grille.replaceChildren(...possedes.map(perso => {
    const carte = document.createElement("button");
    carte.type = "button";
    carte.className = `ent-perso ${classeFondRarete(perso.rarete)}${etat.persos.has(perso.id) ? " coche" : ""}`;
    // Voyageur (un par élément) : élément en bas à gauche pour les distinguer.
    const element = perso.groupe ? perso.element : null;
    const niveau = Number(niveaux[cleNiveau(perso)]) || null;
    const horsStuff = !stuff[perso.id];
    carte.title = `${perso.nom} C${constellations[perso.id]}${niveau ? `, niveau ${niveau}` : ""}${horsStuff ? " (pas dans la box stuff)" : ""}`; // nom déjà avec l'élément ("Voyageur Geo")
    carte.innerHTML = `<img src="../DB/${perso.image}" alt="" loading="lazy">` +
      (element ? `<img class="ent-element" src="../DB/images/others/${element}.webp" alt="${element}">` : "") +
      (niveau ? `<span class="ent-badge ent-badge-haut">${niveau}</span>` : "") +
      `<span class="ent-badge">C${constellations[perso.id]}</span>` +
      (horsStuff ? `<span class="ent-hors-stuff"></span>` : "");
    carte.addEventListener("click", () => {
      if (etat.persos.has(perso.id)) etat.persos.delete(perso.id);
      else etat.persos.add(perso.id);
      carte.classList.toggle("coche");
      majCompteur();
    });
    return carte;
  }));
  zone.querySelector(".ent-tout").addEventListener("click", () => {
    possedes.forEach(p => etat.persos.add(p.id));
    rendreSelecteurBox(cote);
  });
  zone.querySelector(".ent-rien").addEventListener("click", () => {
    etat.persos.clear();
    rendreSelecteurBox(cote);
  });
  majCompteur();

  // Armes : chaque copie de la full box, raffinement en bas à droite.
  const copies = armesPossedees(profil);
  const grilleArmes = zone.querySelector(".ent-armes");
  const compteurArmes = zone.querySelector(".ent-compteur-armes");
  const majCompteurArmes = () => {
    const nb = copies.filter(c => etat.armes.has(c.instance)).length;
    compteurArmes.textContent = copies.length
      ? `${nb} arme${nb > 1 ? "s" : ""} sur ${copies.length}`
      : "Aucune arme dans la full box de ce joueur.";
  };
  grilleArmes.replaceChildren(...copies.map(({ instance, arme, raffinement }) => {
    const carte = document.createElement("button");
    carte.type = "button";
    carte.className = `ent-perso ${classeFondRarete(arme.rarete)}${etat.armes.has(instance) ? " coche" : ""}`;
    carte.title = `${arme.nom} R${raffinement + 1}`;
    carte.innerHTML = `<img src="../DB/${arme.image}" alt="" loading="lazy"><span class="ent-badge">R${raffinement + 1}</span>`;
    carte.addEventListener("click", () => {
      if (etat.armes.has(instance)) etat.armes.delete(instance);
      else etat.armes.add(instance);
      carte.classList.toggle("coche");
      majCompteurArmes();
    });
    return carte;
  }));
  zone.querySelector(".ent-toutes-armes").addEventListener("click", () => {
    copies.forEach(c => etat.armes.add(c.instance));
    rendreSelecteurBox(cote);
  });
  zone.querySelector(".ent-aucune-arme").addEventListener("click", () => {
    etat.armes.clear();
    rendreSelecteurBox(cote);
  });
  majCompteurArmes();
}

// ---- Entraînement en équipe : vitrines construites par le lanceur ----
const MAX_VITRINE_ENTRAINEMENT = 12;

// Choix des joueurs (et box fictives) : libellés uniques.
function choixProprietaires() {
  const choix = [
    ...entrainement.comptes.map(compte => ({ id: compte.discord_id, libelle: compte.discord_id === entrainement.moi.id ? `${compte.nom} (moi)` : compte.nom })),
    ...entrainement.fictives.map(box => ({ id: box.id, libelle: `${box.nom} (box fictive)` }))
  ];
  const vus = new Map();
  choix.forEach(c => {
    const n = (vus.get(c.libelle) || 0) + 1;
    vus.set(c.libelle, n);
    if (n > 1) c.libelle = `${c.libelle} (${n})`;
  });
  return choix;
}

function choisirFormat(taille) {
  entrainement.taille = taille;
  document.querySelectorAll("#ent-format .choix-btn").forEach(b => b.classList.toggle("active", Number(b.dataset.valeur) === taille));
  document.querySelectorAll("#detail-entrainement .ent-1v1").forEach(el => el.classList.toggle("cache", taille > 1));
  document.querySelectorAll("#detail-entrainement .ent-equipe").forEach(el => el.classList.toggle("cache", taille === 1));
  if (taille === 1) return;
  // Vitrines gardées si on change de taille (complétées ou retirées).
  const n = taille * 2;
  while (entrainement.vitrines.length < n) {
    entrainement.vitrines.push({ proprietaire: entrainement.moi.id, persos: new Set(), armes: new Set(), ouverte: false });
  }
  entrainement.vitrines.length = n;
  rendreVitrinesEntrainement();
}

async function rendreVitrinesEntrainement() {
  const zone = document.getElementById("ent-vitrines");
  const taille = entrainement.taille;
  const choix = choixProprietaires();
  const liste = document.getElementById("ent-joueurs-vitrines");
  if (!liste.childElementCount) {
    choix.forEach(c => {
      const option = document.createElement("option");
      option.value = c.libelle;
      liste.appendChild(option);
    });
  }
  const colonnes = [0, 1].map(equipe => {
    const colonne = document.createElement("div");
    colonne.className = "ent-colonne-vitrines";
    colonne.innerHTML = `<h4 class="ent-sous-titre">Équipe ${equipe + 1}</h4>`;
    return colonne;
  });
  for (const [i, vitrine] of entrainement.vitrines.entries()) {
    colonnes[i < taille ? 0 : 1].appendChild(await carteVitrineEntrainement(vitrine, i, choix));
  }
  zone.replaceChildren(...colonnes);
}

// Une vitrine : joueur, nombres choisis, persos et armes (dépliable).
async function carteVitrineEntrainement(vitrine, index, choix) {
  const carte = document.createElement("div");
  carte.className = `ent-vitrine${vitrine.ouverte ? " ouverte" : ""}`;
  const profil = await profilJoueur(vitrine.proprietaire);
  const possedes = personnagesPossedes(profil);
  const copies = armesPossedees(profil);
  const nbPersos = () => new Set(possedes.filter(p => vitrine.persos.has(p.id)).map(p => p.groupe || p.id)).size;
  carte.innerHTML = `
    <div class="ent-vitrine-entete">
      <strong>Joueur ${(index % entrainement.taille) + 1}</strong>
      <input type="text" class="ent-joueur" list="ent-joueurs-vitrines" autocomplete="off" placeholder="Rechercher un joueur…">
      <span class="ent-vitrine-compte"></span>
      <button type="button" class="choix-btn ent-vitrine-ouvrir">${vitrine.ouverte ? "Fermer" : "Choisir les persos"}</button>
    </div>
    <div class="ent-vitrine-contenu${vitrine.ouverte ? "" : " cache"}">
      <h4 class="ent-sous-titre">Personnages</h4>
      <div class="ent-persos"></div>
      <h4 class="ent-sous-titre">Armes</h4>
      <div class="ent-persos ent-armes"></div>
    </div>`;
  const majCompte = () => {
    const n = nbPersos();
    const compte = carte.querySelector(".ent-vitrine-compte");
    compte.textContent = `${n} / ${MAX_VITRINE_ENTRAINEMENT} persos · ${vitrine.armes.size} / ${MAX_VITRINE_ENTRAINEMENT} armes`;
    compte.classList.toggle("insuffisant", n !== MAX_VITRINE_ENTRAINEMENT);
  };
  majCompte();

  const champ = carte.querySelector(".ent-joueur");
  const libelleActuel = choix.find(c => c.id === vitrine.proprietaire)?.libelle || "";
  champ.value = libelleActuel;
  champ.addEventListener("focus", () => champ.select());
  champ.addEventListener("change", () => {
    const trouve = choix.find(c => c.libelle.toLowerCase() === champ.value.trim().toLowerCase());
    if (!trouve || trouve.id === vitrine.proprietaire) {
      champ.value = libelleActuel;
      return;
    }
    vitrine.proprietaire = trouve.id;
    vitrine.persos = new Set();
    vitrine.armes = new Set();
    vitrine.ouverte = true;
    rendreVitrinesEntrainement();
  });
  carte.querySelector(".ent-vitrine-ouvrir").addEventListener("click", () => {
    vitrine.ouverte = !vitrine.ouverte;
    rendreVitrinesEntrainement();
  });
  if (!vitrine.ouverte) return carte;

  // Persos (12 au plus) et copies d'armes (12 au plus) de la full box.
  const constellations = profil?.characters?.full || {};
  carte.querySelector(".ent-persos").replaceChildren(...possedes.map(perso => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = `ent-perso ${classeFondRarete(perso.rarete)}${vitrine.persos.has(perso.id) ? " coche" : ""}`;
    bouton.title = `${perso.nom} C${constellations[perso.id]}`;
    bouton.innerHTML = `<img src="../DB/${perso.image}" alt="" loading="lazy"><span class="ent-badge">C${constellations[perso.id]}</span>`;
    bouton.addEventListener("click", () => {
      if (vitrine.persos.has(perso.id)) vitrine.persos.delete(perso.id);
      else if (nbPersos() >= MAX_VITRINE_ENTRAINEMENT && !(perso.groupe && possedes.some(p => p.groupe === perso.groupe && vitrine.persos.has(p.id)))) return;
      else vitrine.persos.add(perso.id);
      bouton.classList.toggle("coche", vitrine.persos.has(perso.id));
      majCompte();
    });
    return bouton;
  }));
  carte.querySelector(".ent-armes").replaceChildren(...copies.map(({ instance, arme, raffinement }) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = `ent-perso ${classeFondRarete(arme.rarete)}${vitrine.armes.has(instance) ? " coche" : ""}`;
    bouton.title = `${arme.nom} R${raffinement + 1}`;
    bouton.innerHTML = `<img src="../DB/${arme.image}" alt="" loading="lazy"><span class="ent-badge">R${raffinement + 1}</span>`;
    bouton.addEventListener("click", () => {
      if (vitrine.armes.has(instance)) vitrine.armes.delete(instance);
      else if (vitrine.armes.size >= MAX_VITRINE_ENTRAINEMENT) return;
      else vitrine.armes.add(instance);
      bouton.classList.toggle("coche", vitrine.armes.has(instance));
      majCompte();
    });
    return bouton;
  }));
  return carte;
}

async function initialiserEntrainement() {
  const reponseMoi = await fetch("/api/auth/me", { credentials: "include" });
  if (!reponseMoi.ok) {
    alert("Tu dois être connecté avec Discord pour t'entraîner.");
    return false;
  }
  entrainement.moi = (await reponseMoi.json()).user;
  const [comptes, personnages, boss, armes] = await Promise.all([chargerJSONApi("/api/accounts"), chargerPersonnages(), chargerBoss(), chargerArmes()]);
  const nom = c => c.discord_global_name || c.discord_username || "Joueur";
  entrainement.comptes = comptes
    .map(c => ({ discord_id: c.discord_id, nom: nom(c) }))
    .sort((a, b) => (b.discord_id === entrainement.moi.id) - (a.discord_id === entrainement.moi.id) || a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  entrainement.personnages = personnages;
  entrainement.armes = armes;
  if (entrainement.moi.admin || entrainement.moi.mini_admin) {
    entrainement.fictives = await chargerJSONApi("/api/accounts/boxes_fictives").catch(erreur => {
      console.error(erreur);
      return [];
    });
  }
  entrainement.cotes.moi.proprietaire = entrainement.moi.id;
  entrainement.cotes.adverse.proprietaire = entrainement.moi.id;

  remplirSelectBoss(document.getElementById("ent-boss"), boss);

  document.querySelectorAll("#ent-mode .choix-btn").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll("#ent-mode .choix-btn").forEach(b => b.classList.toggle("active", b === btn));
  }));
  document.getElementById("lancer-entrainement").addEventListener("click", lancerEntrainement);
  document.querySelectorAll("#ent-format .choix-btn").forEach(btn => btn.addEventListener("click", () => choisirFormat(Number(btn.dataset.valeur))));

  await Promise.all([rendreSelecteurBox("moi"), rendreSelecteurBox("adverse")]);
  entrainement.pret = true;
  return true;
}

function lancerEntrainement() {
  if (entrainement.taille > 1) {
    creerMatch({
      type: "entrainement",
      config: {
        equipe: true,
        taille: entrainement.taille,
        vitrines: entrainement.vitrines.map(v => ({ proprietaire: v.proprietaire, persos: [...v.persos], armes: [...v.armes] })),
        boss_id: document.getElementById("ent-boss").value || null
      }
    });
    return;
  }
  const cote = c => {
    const etat = entrainement.cotes[c];
    return { proprietaire: etat.proprietaire, box: etat.box, ...(etat.box === "custom" ? { persos: [...etat.persos], armes: [...etat.armes] } : {}) };
  };
  creerMatch({
    type: "entrainement",
    config: {
      classe: document.getElementById("ent-classe").checked,
      mode: document.querySelector("#ent-mode .choix-btn.active")?.dataset.valeur || "auto",
      boxes: { moi: cote("moi"), adverse: cote("adverse") },
      boss_id: document.getElementById("ent-boss").value || null,
      premier: document.getElementById("ent-premier").value
    }
  });
}

// ---- Cartes des modes : cliquer une carte affiche ses détails dans le
// rectangle en dessous (un seul ouvert : celui d'une autre carte se ferme),
// recliquer la même le referme. Préparé à la 1re ouverture : liste des boss
// (room), comptes et box (entraînement). ----
const PREPARATIONS = {
  // Rectangle ouvert tout de suite, liste des boss remplie en arrière-plan.
  room: async () => { remplirBossRoom(); return true; },
  equipe: async () => { remplirBossRoom("equipe-boss"); return true; },
  entrainement: async () => {
    if (entrainement.pret) return true;
    try {
      return await initialiserEntrainement();
    } catch (erreur) {
      console.error(erreur);
      alert("Impossible de charger le mode entraînement.");
      return false;
    }
  }
};

// Dernier clic : une préparation encore en cours n'ouvre rien si une autre
// carte a été cliquée entre-temps.
let dernierClic = 0;

async function choisirCarte(carte) {
  const clic = ++dernierClic;
  const nom = carte.dataset.detail;
  const dejaOuvert = carte.getAttribute("aria-expanded") === "true";
  document.querySelectorAll(".carte-match").forEach(c => {
    c.setAttribute("aria-expanded", "false");
    c.classList.remove("selectionnee");
  });
  document.querySelectorAll(".detail-match").forEach(d => d.classList.add("cache"));
  if (dejaOuvert) return;

  if (PREPARATIONS[nom]) {
    carte.disabled = true;
    const pret = await PREPARATIONS[nom]().finally(() => { carte.disabled = false; });
    if (!pret || clic !== dernierClic) return;
  }
  carte.setAttribute("aria-expanded", "true");
  carte.classList.add("selectionnee");
  const detail = document.querySelector(`.detail-match[data-detail="${nom}"]`);
  detail.classList.remove("cache");
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Cartes à détails seulement (Tournois : simple lien vers /tournois).
document.querySelectorAll(".carte-match[data-detail]").forEach(carte => {
  carte.addEventListener("click", () => choisirCarte(carte));
});

// /match#entrainement (ex. "Changer de box" d'un entraînement non
// équilibrable, cf. match.js ; menu Match de l'en-tête, cf.
// commun/site.js) : détail du mode ouvert, aussi quand l'ancre change sur
// la page (pas refermé s'il l'est déjà).
function ouvrirAncre() {
  // Ancien lien /match#classe : le classé est dans Matchmaking.
  const ancre = location.hash.slice(1) === "classe" ? "matchmaking" : location.hash.slice(1);
  const carte = ancre && document.querySelector(`.carte-match[data-detail="${CSS.escape(ancre)}"]`);
  if (carte && carte.getAttribute("aria-expanded") !== "true") choisirCarte(carte);
}
ouvrirAncre();
window.addEventListener("hashchange", ouvrirAncre);
