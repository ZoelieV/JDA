-- Bonus de saison (à lancer une fois dans Supabase : SQL Editor > New query
-- > Run). Sans risque si relancé.

-- Match classé : nombre de persos de l'équipe de chaque joueur qui avaient
-- le bonus de saison (coché dans la page admin) au moment du match. Chacun
-- vaut 3 trophées : ajoutés au gain du gagnant, retirés de la perte du
-- perdant (cf. api/_lib/trophees.js). Gardé par match car la liste change
-- d'une saison à l'autre.
alter table match_history add column if not exists bonus_saison_j1 integer not null default 0;
alter table match_history add column if not exists bonus_saison_j2 integer not null default 0;
