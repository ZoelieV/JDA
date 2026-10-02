-- Mode entraînement (à lancer une fois dans Supabase : SQL Editor > New
-- query > Run). Sans risque si relancé.

-- Match d'entraînement : visible dans l'historique par son lanceur
-- seulement, jamais compté (stats, classement). Les joueurs enregistrés
-- (player1 / player2) sont les propriétaires des box jouées.
alter table match_history add column if not exists entrainement boolean not null default false;
alter table match_history add column if not exists lanceur_discord_id text;

create index if not exists match_history_entrainements
  on match_history (lanceur_discord_id, created_at)
  where entrainement;

-- Entraînement : pas de temps saisis ni de vainqueur (sans effet si les
-- colonnes acceptent déjà null).
alter table match_history alter column temps_j1_affiche drop not null;
alter table match_history alter column temps_j2_affiche drop not null;
alter table match_history alter column temps_j1_secondes drop not null;
alter table match_history alter column temps_j2_secondes drop not null;
alter table match_history alter column vainqueur drop not null;
