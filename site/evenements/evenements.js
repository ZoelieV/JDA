// Événements : modes de jeu ponctuels ou en test, une namecard chacun (même
// présentation que Créer un match, cf. matchmaking/matchmaking.js).
//
// Random world boss (cf. api/_lib/world_boss.js) : visible et jouable par
// les administrateurs et mini admins seulement (pastille "Admin"), et
// seulement si le mode n'est pas désactivé dans la page admin
// (config.world_boss_desactive). Le serveur refuse aussi les autres.

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
    window.location.href = `matchmaking/world_boss.html?room=${data.room_id}`;
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
  const worldBoss = admin && config?.world_boss_desactive !== true;

  const carteWorldBoss = document.querySelector('.carte-match[data-detail="world-boss"]');
  carteWorldBoss.classList.toggle("cache", !worldBoss);

  const visibles = document.querySelectorAll(".carte-match:not(.cache)").length;
  etat.textContent = visibles ? "" : "Aucun événement en cours pour le moment.";
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
