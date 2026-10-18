-- Retire aux rôles publics (anon : clé publique ; authenticated : comptes
-- Supabase Auth, pas utilisés par le site) tous leurs droits sur le schéma
-- public. À lancer dans Supabase : SQL Editor > New query > Run. Sans
-- risque si relancé.
--
-- RLS sans politique (cf. rls_toutes_tables.sql) les bloque déjà pour
-- l'API, mais pas tout : TRUNCATE, par exemple, ignore RLS. Ici, plus aucun
-- droit : RLS n'est plus la seule protection.
--
-- Le site ne passe que par la clé de service (service_role, variables
-- Vercel) : ses droits sont gardés (et redonnés au cas où), rien ne change
-- pour lui.

-- 1. Droits actuels des rôles publics (avant) : tables concernées.
select table_name, grantee, string_agg(privilege_type, ', ') as droits
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- 2. Tables, séquences et fonctions existantes.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- 3. Tables, séquences et fonctions créées plus tard (par le SQL Editor,
-- rôle postgres) : sans droit pour les rôles publics non plus.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- 4. Vérification : doit renvoyer 0 ligne.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
