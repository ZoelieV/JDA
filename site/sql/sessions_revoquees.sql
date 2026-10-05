-- Sessions révoquées à la déconnexion (à lancer une fois dans Supabase : SQL
-- Editor > New query > Run). Sans risque si relancé.

-- Le cookie de session est un jeton signé valable 7 jours ; à la
-- déconnexion, son identifiant (jti) est noté ici jusqu'à son expiration :
-- un cookie copié ne sert plus (cf. api/_lib/session.js, revoquerSession).
-- Les lignes expirées sont supprimées à chaque déconnexion.
create table if not exists sessions_revoquees (
  jti text primary key,
  expire_le timestamptz not null
);

create index if not exists sessions_revoquees_expire_le on sessions_revoquees (expire_le);

-- Fermée à l'accès public (le site passe par la clé de service).
alter table sessions_revoquees enable row level security;
