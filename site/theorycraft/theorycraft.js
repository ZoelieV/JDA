// Page Theorycraft : connectés seulement, sauf shadowbans (user.theorycraft,
// cf. api/auth/me.js). Les autres sont renvoyés à l'accueil, comme si la
// page n'existait pas.
async function verifierAccesTheorycraft() {
  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });
    const user = reponse.ok ? (await reponse.json()).user : null;
    if (user?.theorycraft) {
      document.getElementById("zone-theorycraft").hidden = false;
      return;
    }
  } catch (erreur) {
    console.error(erreur);
  }
  window.location.replace("/");
}

verifierAccesTheorycraft();
