-- Mini admins (à lancer une fois dans Supabase : SQL Editor > New query >
-- Run). Sans risque si relancé.

-- Mini admin : voit la page Administration sans pouvoir la modifier (points,
-- ajouts, boss, catégories en lecture seule), mais gère les litiges de
-- l'historique (temps corrigés, sanctions) et peut lever un ban du classé
-- (cf. api/_lib/admin.js). Les administrateurs complets restent dans la
-- variable d'environnement Vercel ADMIN_DISCORD_IDS.
create table if not exists mini_admins (
  discord_id text primary key,
  -- Simple repère pour s'y retrouver (pseudo), facultatif.
  nom text,
  ajoute_le timestamptz not null default now()
);

-- Fermée à l'accès public (le site passe par la clé de service).
alter table mini_admins enable row level security;

-- Ajouter un mini admin (ID Discord entre guillemets simples) :
-- insert into mini_admins (discord_id, nom) values ('123456789012345678', 'Pseudo');
-- Retirer un mini admin :
-- delete from mini_admins where discord_id = '123456789012345678';
