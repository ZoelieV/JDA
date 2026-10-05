-- Table points (configuration des points, réservée aux administrateurs) :
-- fermée à l'accès public, comme les autres tables (à lancer une fois dans
-- Supabase : SQL Editor > New query > Run). Sans risque si relancé.
-- Le site passe par la clé de service, qui n'est pas concernée par RLS :
-- rien ne change pour lui. Sans RLS, la clé publique (anon) du projet
-- suffisait pour lire et modifier cette configuration.
alter table points enable row level security;

-- Vérification : relrowsecurity doit valoir true partout.
-- select relname, relrowsecurity from pg_class
-- where relname in ('profiles', 'rooms', 'match_history', 'points', 'sessions_revoquees');
