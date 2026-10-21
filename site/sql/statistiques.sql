-- Statistiques du site (page Administration, bouton Statistiques ; cf.
-- api/_lib/statistiques.js). À lancer une fois dans Supabase : SQL Editor >
-- New query > Run. Sans risque si relancé.
--
-- 1. Inscription : date de création du profil (première connexion Discord)
--    et source (lien de pub ?src=..., ou site d'où venait le visiteur, cf.
--    commun/compte.js et api/auth/discord/callback.js).
alter table profiles add column if not exists inscrit_le timestamptz;
alter table profiles add column if not exists source text;

-- Profils d'avant cette colonne : plus ancienne trace connue (mouvement de
-- Rikoyns, match, dernière modification du profil). Relancé : plus rien de
-- vide, rien ne change.
update profiles p set inscrit_le = least(
  p.updated_at,
  (select min(k.cree_le) from koyns_mouvements k where k.discord_id = p.discord_id),
  (select min(m.created_at) from match_history m where m.player1_discord_id = p.discord_id or m.player2_discord_id = p.discord_id)
)
where p.inscrit_le is null;

-- Nouveaux profils : date de création.
alter table profiles alter column inscrit_le set default now();
create index if not exists profiles_inscrit_le on profiles (inscrit_le);

-- 2. Connexions : une ligne par joueur et par journée du site (reset à 4 h,
--    heure de Paris), écrite à sa première visite connectée du jour.
create table if not exists connexions_jour (
  discord_id text not null,
  jour date not null,
  premiere timestamptz not null default now(),
  primary key (discord_id, jour)
);

create index if not exists connexions_jour_jour on connexions_jour (jour);

-- Fermée à l'accès public (le site passe par la clé de service).
alter table connexions_jour enable row level security;
revoke all on connexions_jour from anon, authenticated;

-- Vérification.
select count(*) as profils, min(inscrit_le) as premiere_inscription, count(source) as avec_source from profiles;
