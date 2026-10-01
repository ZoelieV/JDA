-- Matchs classés (à lancer une fois dans Supabase : SQL Editor > New query
-- > Run, après sql/litiges.sql). Sans risque si relancé.

-- Match joué depuis le matchmaking classé (rooms de type 'classe', cf.
-- api/_lib/matchmaking.js) et trophées en jeu : gagnés par le vainqueur,
-- perdus par l'autre (cf. api/_lib/trophees.js ; null pour un litige pas
-- encore republié).
alter table match_history add column if not exists classe boolean not null default false;
alter table match_history add column if not exists trophees integer;

create index if not exists match_history_classes
  on match_history (created_at)
  where classe;
