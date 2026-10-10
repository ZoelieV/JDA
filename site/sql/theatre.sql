-- Modes de théâtre (à lancer une fois dans Supabase : SQL Editor > New
-- query > Run). Sans risque si relancé.

-- Théâtre joué (palier 1 sardine, 2 carpe, 3 dauphin, 4 baleine : nombre
-- de bans de la draft, affiché avec sa médaille dans l'historique ; anciens
-- matchs : 6, 8, 10 ou 12) et mode de la room : "auto" (plus petit palier),
-- "12" (mêlée générale en matchmaking / classé), un palier imposé
-- ("sardine"...) ou "carnage" (cf. MODES_THEATRE, api/_lib/draft.js).
-- Seuls les matchs classés en mêlée générale ("12") comptent au classement
-- (anciens matchs classés "auto" : ancien classement Classique).
alter table match_history add column if not exists theatre integer;
alter table match_history add column if not exists mode_theatre text;

-- Colonne des actions de la draft (élément du Voyageur / Manekin, infos
-- figées des picks dans l'historique), si elle n'existe pas encore.
alter table match_history add column if not exists actions jsonb;
