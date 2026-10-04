-- Shadowbans de la page Theorycraft (à lancer une fois dans Supabase : SQL
-- Editor > New query > Run). Sans risque si relancé.

-- Joueur shadowban : utilise le site normalement, mais la carte Theorycraft
-- de l'accueil ne lui est jamais montrée et la page le renvoie à l'accueil
-- comme si elle n'existait pas (cf. api/_lib/admin.js, estShadowban).
create table if not exists shadowbans (
  discord_id text primary key,
  -- Simple repère pour s'y retrouver (pseudo), facultatif.
  nom text,
  ajoute_le timestamptz not null default now()
);

-- Fermée à l'accès public (le site passe par la clé de service).
alter table shadowbans enable row level security;

-- Ajouter un shadowban (ID Discord entre guillemets simples) :
-- insert into shadowbans (discord_id) values ('123456789012345678');
-- Le retirer :
-- delete from shadowbans where discord_id = '123456789012345678';
