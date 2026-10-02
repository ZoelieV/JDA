// Créer un match : room privée (lien partagé, théâtre au choix),
// matchmaking ou classé (adversaire trouvé automatiquement dans le même
// mode, classique ou mêlée générale ; cf. api/_lib/matchmaking.js), tous
// via api/rooms. On arrive ensuite sur la page du match (attente de
// l'adversaire).

async function creerMatch(corps) {
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
      const { error } = await reponse.json().catch(() => ({}));
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
      throw new Error("Échec de la création du match.");
    }

    const data = await reponse.json();

    window.location.href = `match.html?room=${data.room_id}`;
  } catch (error) {
    console.error(error);
    alert("Erreur lors de la création du match.");
  }
}

// Bouton d'une carte : affiche (ou masque) ses modes de théâtre.
document.querySelectorAll(".ouvrir-modes").forEach(bouton => {
  bouton.addEventListener("click", () => {
    const modes = bouton.parentElement.querySelector(".modes-match");
    const ouvert = modes.classList.toggle("cache") === false;
    bouton.setAttribute("aria-expanded", String(ouvert));
  });
});

// Mode choisi : room privée (mode de théâtre au choix) ou recherche
// (matchmaking / classé : classique ou mêlée générale).
document.querySelectorAll(".mode-match").forEach(bouton => {
  bouton.addEventListener("click", () => {
    const type = bouton.closest(".modes-match").dataset.type;
    const mode = bouton.dataset.mode;
    creerMatch(type === "prive" ? { mode } : { type, mode });
  });
});

// ---- Mode entraînement ----
// Configuration : draft (classée ou non, mode de théâtre), ta box et la box
// adverse (une des tiennes ; full ou stuff d'un autre joueur ; ou une box
// personnalisée cochée dans la full box d'un joueur), boss et J1.
const MIN_PERSOS_BOX = 16; // cf. NB_PERSOS_MIN_BOX, api/_lib/draft.js
const LIBELLES_BOX = { full: "Full box", stuff: "Stuff", opti1: "Opti 1", opti2: "Opti 2", opti3: "Opti 3", opti4: "Opti 4", opti5: "Opti 5", custom: "Personnalisée" };

const entrainement = {
  pret: false,
  moi: null, // mon compte { id }
  comptes: [], // tous les joueurs { discord_id, nom }
  profils: new Map(), // discord_id -> données du profil (box)
  personnages: [],
  cotes: {
    moi: { proprietaire: null, box: "full", persos: new Set() },
    adverse: { proprietaire: null, box: "full", persos: new Set() }
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

// Sélecteur d'un côté : joueur, box, et persos cochés si personnalisée.
async function rendreSelecteurBox(cote) {
  const etat = entrainement.cotes[cote];
  const zone = document.querySelector(`.selecteur-box[data-cote="${cote}"]`);
  const estMoi = etat.proprietaire === entrainement.moi.id;
  const profil = await profilJoueur(etat.proprietaire);
  const nomsBoxes = estMoi ? profil.nomsBoxes || {} : {};
  // Box d'un autre joueur : full ou stuff (ses box opti restent privées).
  const boxes = estMoi ? ["full", "stuff", "opti1", "opti2", "opti3", "opti4", "opti5", "custom"] : ["full", "stuff", "custom"];
  if (!boxes.includes(etat.box)) etat.box = "full";

  zone.innerHTML = `
    <label>Joueur <select class="ent-joueur"></select></label>
    <div class="choix-boutons ent-box">
      ${boxes.map(box => `<button type="button" class="choix-btn${etat.box === box ? " active" : ""}" data-valeur="${box}"></button>`).join("")}
    </div>
    <div class="ent-perso-zone${etat.box === "custom" ? "" : " cache"}">
      <div class="ligne-entrainement">
        <span class="ent-compteur"></span>
        <button type="button" class="choix-btn ent-tout">Tout cocher</button>
        <button type="button" class="choix-btn ent-rien">Tout décocher</button>
      </div>
      <div class="ent-persos"></div>
    </div>
  `;

  // Libellés en texte (noms de box choisis par le joueur).
  zone.querySelectorAll(".ent-box .choix-btn").forEach(btn => {
    const box = btn.dataset.valeur;
    btn.textContent = typeof nomsBoxes[box] === "string" && nomsBoxes[box] ? nomsBoxes[box] : LIBELLES_BOX[box];
  });

  const select = zone.querySelector(".ent-joueur");
  entrainement.comptes.forEach(compte => {
    const option = document.createElement("option");
    option.value = compte.discord_id;
    option.textContent = compte.discord_id === entrainement.moi.id ? `${compte.nom} (moi)` : compte.nom;
    option.selected = compte.discord_id === etat.proprietaire;
    select.appendChild(option);
  });
  select.addEventListener("change", () => {
    etat.proprietaire = select.value;
    etat.persos = new Set();
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
  grille.replaceChildren(...possedes.map(perso => {
    const carte = document.createElement("button");
    carte.type = "button";
    carte.className = `ent-perso ${classeFondRarete(perso.rarete)}${etat.persos.has(perso.id) ? " coche" : ""}`;
    carte.title = perso.nom;
    carte.innerHTML = `<img src="../DB/${perso.image}" alt="" loading="lazy">`;
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
}

async function initialiserEntrainement() {
  const reponseMoi = await fetch("/api/auth/me", { credentials: "include" });
  if (!reponseMoi.ok) {
    alert("Tu dois être connecté avec Discord pour t'entraîner.");
    return false;
  }
  entrainement.moi = (await reponseMoi.json()).user;
  const [comptes, personnages, boss] = await Promise.all([chargerJSONApi("/api/accounts"), chargerPersonnages(), chargerBoss()]);
  const nom = c => c.discord_global_name || c.discord_username || "Joueur";
  entrainement.comptes = comptes
    .map(c => ({ discord_id: c.discord_id, nom: nom(c) }))
    .sort((a, b) => (b.discord_id === entrainement.moi.id) - (a.discord_id === entrainement.moi.id) || a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  entrainement.personnages = personnages;
  entrainement.cotes.moi.proprietaire = entrainement.moi.id;
  entrainement.cotes.adverse.proprietaire = entrainement.moi.id;

  const selectBoss = document.getElementById("ent-boss");
  boss.forEach(b => {
    const option = document.createElement("option");
    option.value = b.id;
    option.textContent = b.nom;
    selectBoss.appendChild(option);
  });

  document.querySelectorAll("#ent-mode .choix-btn").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll("#ent-mode .choix-btn").forEach(b => b.classList.toggle("active", b === btn));
  }));
  document.getElementById("lancer-entrainement").addEventListener("click", lancerEntrainement);

  await Promise.all([rendreSelecteurBox("moi"), rendreSelecteurBox("adverse")]);
  entrainement.pret = true;
  return true;
}

function lancerEntrainement() {
  const cote = c => {
    const etat = entrainement.cotes[c];
    return { proprietaire: etat.proprietaire, box: etat.box, ...(etat.box === "custom" ? { persos: [...etat.persos] } : {}) };
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

document.getElementById("ouvrir-entrainement").addEventListener("click", async () => {
  const bouton = document.getElementById("ouvrir-entrainement");
  const panneau = document.getElementById("panneau-entrainement");
  if (!entrainement.pret) {
    bouton.disabled = true;
    try {
      if (!(await initialiserEntrainement())) return;
    } catch (erreur) {
      console.error(erreur);
      alert("Impossible de charger le mode entraînement.");
      return;
    } finally {
      bouton.disabled = false;
    }
  }
  const ouvert = panneau.classList.toggle("cache") === false;
  bouton.setAttribute("aria-expanded", String(ouvert));
  if (ouvert) panneau.scrollIntoView({ behavior: "smooth", block: "start" });
});
