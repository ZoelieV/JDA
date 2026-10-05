-- Saisons du classé (à lancer une fois dans Supabase : SQL Editor > New
-- query > Run). Sans risque si relancé.

-- Une ligne par saison ; la saison en cours est celle au plus grand numéro.
-- Chaque match archivé garde le numéro de la saison où il a été joué
-- (match_history.saison) : la page Classement ne compte que les trophées de
-- la saison en cours, les saisons passées restent consultables (menu
-- Saison), et l'historique des matchs se filtre par saison.
create table if not exists saisons (
  numero integer primary key,
  -- Affiché "Saison <numero> : <nom>".
  nom text not null,
  debut timestamptz not null default now()
);

-- Fermée à l'accès public (le site passe par la clé de service).
alter table saisons enable row level security;

-- Saison en cours au lancement.
insert into saisons (numero, nom) values (0, 'Tests') on conflict (numero) do nothing;

-- Saison de chaque match : tous les matchs déjà joués sont en saison 0.
alter table match_history add column if not exists saison integer not null default 0;
create index if not exists match_history_saison on match_history (saison);

-- ---- Changer de saison ----
-- Ajouter la suivante (le site la prend en compte en 30 s au plus) :
-- insert into saisons (numero, nom) values (1, 'Nom de la saison');
-- Les trophées repartent de 0 ; ceux de la saison précédente restent dans
-- son classement. Revenir en arrière (aucun match joué dans la nouvelle) :
-- delete from saisons where numero = 1;
