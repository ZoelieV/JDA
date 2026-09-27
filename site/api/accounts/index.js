const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Deuxième bannière choisie dans Mon compte (null si aucune) : seul extrait
// du profil renvoyé, pas les box complètes.
const CHAMPS = "discord_id, discord_username, discord_global_name, discord_avatar_url, updated_at, banniere2:data->parametres->>banniere2";

// Code Postgres "colonne inexistante".
const COLONNE_INEXISTANTE = "42703";

module.exports = async (req, res) => {
  try {
    // created_at (date d'arrivée, tri "Arrivée") : si la colonne n'existe
    // pas encore dans la table profiles, on s'en passe (tri masqué côté page).
    let { data, error } = await supabase
      .from("profiles")
      .select(`${CHAMPS}, created_at`)
      .order("updated_at", { ascending: false });

    if (error && error.code === COLONNE_INEXISTANTE) {
      ({ data, error } = await supabase
        .from("profiles")
        .select(CHAMPS)
        .order("updated_at", { ascending: false }));
    }

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur chargement comptes" });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};
