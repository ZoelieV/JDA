-- Match privé / Matchmaking et spectateurs (à lancer une fois dans
-- Supabase : SQL Editor > New query > Run). Sans risque si relancé.

-- Type de room : "prive" (lien à partager, le premier qui l'ouvre est
-- l'adversaire) ou "matchmaking" (adversaire trouvé automatiquement, cf.
-- api/matchmaking.js).
alter table rooms add column if not exists type text not null default 'prive';

-- Spectateurs présents : { discord_id: dernière visite (ms) }, cf.
-- api/rooms/[room_id]/[action].js (noterSpectateur).
alter table rooms add column if not exists spectateurs jsonb not null default '{}'::jsonb;

-- Ordre de la file d'attente du matchmaking (la plus ancienne room d'abord).
alter table rooms add column if not exists created_at timestamptz not null default now();

create index if not exists rooms_file_matchmaking
  on rooms (type, created_at)
  where player2_discord_id is null;
