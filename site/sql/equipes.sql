-- Modes 2v2, 3v3 et 4v4 (à lancer une fois dans Supabase : SQL Editor >
-- New query > Run). Sans risque si relancé. Cf. api/_lib/equipe.js.

-- Membres d'une room d'équipe (lobby puis match) : un joueur qui démarre un
-- autre match quitte ses rooms d'équipe (un seul match à la fois).
alter table rooms add column if not exists membres text[] not null default '{}';
create index if not exists rooms_membres on rooms using gin (membres);

-- Matchs d'équipe archivés : mode ("2v2", "3v3", "4v4") et détail des
-- équipes (membres, chef, hôtes, qui a joué quel perso). player1 / player2 :
-- chefs des 2 équipes ; temps_j1 / temps_j2 : temps des équipes.
alter table match_history add column if not exists mode_equipe text;
alter table match_history add column if not exists equipes jsonb;
