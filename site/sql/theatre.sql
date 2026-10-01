-- Modes de théâtre (à lancer une fois dans Supabase : SQL Editor > New
-- query > Run). Sans risque si relancé.

-- Théâtre joué (6, 8, 10 ou 12 : nombre de bans de la draft, affiché avec
-- sa médaille dans l'historique) et mode de la room : "auto" (théâtre du
-- plus petit clear), "12" (mêlée générale en matchmaking / classé, ou
-- théâtre 12 imposé), "6" / "8" / "10" (imposé dans une room privée).
-- Les matchs classés sont comptés dans le classement Classique ("auto")
-- ou Mêlée générale ("12") selon ce mode.
alter table match_history add column if not exists theatre integer;
alter table match_history add column if not exists mode_theatre text;

-- Colonne des actions de la draft (élément du Voyageur / Manekin, infos
-- figées des picks dans l'historique), si elle n'existe pas encore.
alter table match_history add column if not exists actions jsonb;
