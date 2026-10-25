// Événements : modes de jeu ponctuels ou en test, une namecard chacun (même
// présentation que Créer un match, cf. matchmaking/matchmaking.js).
//
// Chaque événement est toujours visible et jouable par les administrateurs
// et mini admins (pastille "Admin") ; activé dans la page admin, il l'est
// par tout le monde, sans pastille. Random world boss (cf.
// api/_lib/world_boss.js) : config.world_boss_public. Le serveur refuse
// aussi les autres joueurs tant qu'il n'est pas activé.

async function chargerUtilisateur() {
  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });
    return reponse.ok ? (await reponse.json()).user : null;
  } catch (erreur) {
    console.error(erreur);
    return null;
  }
}

// Room Random world boss, puis page de son lobby.
async function creerWorldBoss(bouton) {
  bouton.disabled = true;
  try {
    const reponse = await fetch("/api/rooms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "world_boss" })
    });
    if (reponse.status === 401) {
      alert("Tu dois être connecté avec Discord pour créer une room.");
      return;
    }
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      alert(data.error || "Échec de la création de la room.");
      return;
    }
    window.location.href = `/world-boss?room=${data.room_id}`;
  } catch (erreur) {
    console.error(erreur);
    alert("Erreur lors de la création de la room.");
  } finally {
    bouton.disabled = false;
  }
}

// Une seule carte ouverte à la fois ; un 2e clic referme ses détails.
function choisirCarte(carte) {
  const dejaOuvert = carte.getAttribute("aria-expanded") === "true";
  document.querySelectorAll(".carte-match").forEach(c => {
    c.setAttribute("aria-expanded", "false");
    c.classList.remove("selectionnee");
  });
  document.querySelectorAll(".detail-match").forEach(d => d.classList.add("cache"));
  if (dejaOuvert) return;
  carte.setAttribute("aria-expanded", "true");
  carte.classList.add("selectionnee");
  const detail = document.querySelector(`.detail-match[data-detail="${carte.dataset.detail}"]`);
  detail.classList.remove("cache");
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function demarrer() {
  const etat = document.getElementById("etat-evenements");
  const [utilisateur, config] = await Promise.all([
    chargerUtilisateur(),
    chargerPointsAdmin().catch(erreur => { console.error(erreur); return {}; })
  ]);
  const admin = !!(utilisateur?.admin || utilisateur?.mini_admin);
  // { data-detail : activé pour tous }
  const evenements = { "world-boss": config?.world_boss_public === true };

  for (const [nom, public_] of Object.entries(evenements)) {
    document.querySelector(`.carte-match[data-detail="${nom}"]`).classList.toggle("cache", !public_ && !admin);
    document.querySelectorAll(`[data-detail="${nom}"] .badge-admin, [data-detail="${nom}"] .regle-admin`).forEach(e => e.classList.toggle("cache", public_));
  }

  const visibles = document.querySelectorAll(".carte-match:not(.cache)").length;
  etat.textContent = visibles ? "" : "Contenu à venir...";
  etat.classList.toggle("cache", visibles > 0);

  document.querySelectorAll(".carte-match").forEach(carte => {
    carte.addEventListener("click", () => choisirCarte(carte));
  });
  document.getElementById("creer-world-boss").addEventListener("click", event => creerWorldBoss(event.currentTarget));

  // evenements.html#world-boss : détails ouverts.
  const ancre = location.hash && document.querySelector(`.carte-match:not(.cache)[data-detail="${CSS.escape(location.hash.slice(1))}"]`);
  if (ancre) choisirCarte(ancre);
}

demarrer();
