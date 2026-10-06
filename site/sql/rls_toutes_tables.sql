-- Ferme TOUTES les tables du schéma public à l'accès public (alerte Supabase
-- "Row Level Security not enabled"). À lancer dans Supabase : SQL Editor >
-- New query > Run. Sans risque si relancé.
--
-- Le site ne passe que par la clé de service (variables Vercel), qui n'est
-- pas concernée par RLS : rien ne change pour lui. Sans politique, la clé
-- publique (anon) ne peut plus rien lire ni modifier.

-- 1. Tables sans RLS (avant) : la liste de ce que l'alerte vise.
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;

-- 2. RLS activé sur chacune.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 3. Vérification : doit renvoyer 0 ligne.
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
