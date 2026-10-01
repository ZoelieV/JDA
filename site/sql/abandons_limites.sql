-- Abandons et limites de fréquence (à lancer une fois dans Supabase : SQL
-- Editor > New query > Run). Sans risque si relancé.

-- Abandon déclaré à la place d'un temps : temps affiché "Abandon", sans
-- secondes (cf. api/_lib/temps.js, TEMPS_ABANDON).
alter table match_history alter column temps_j1_secondes drop not null;
alter table match_history alter column temps_j2_secondes drop not null;

-- Limites de fréquence par adresse IP (cf. api/_lib/limites.js) :
-- cle = "<action>:<empreinte HMAC de l'IP>" (jamais l'IP en clair),
-- dernier = date de la dernière action autorisée.
create table if not exists limites_frequence (
  cle text primary key,
  dernier timestamptz not null
);

-- Fermée à l'accès public (le site passe par la clé de service).
alter table limites_frequence enable row level security;
