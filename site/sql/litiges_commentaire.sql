-- Commentaire d'un litige (à lancer une fois dans Supabase : SQL Editor >
-- New query > Run). Sans risque si relancé.

-- Raison donnée par le joueur qui signale un litige (obligatoire, 500
-- caractères au plus, cf. handleLitige dans api/rooms/[room_id]/[action].js) :
-- visible des administrateurs et mini admins dans l'historique (Litiges).
alter table match_history add column if not exists litige_commentaire text;
