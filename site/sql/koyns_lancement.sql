-- Lancement des Koyns (une seule fois, après koyns.sql) : les cosmétiques
-- portés jusqu'ici (tous gratuits avant les Koyns) reviennent au choix par
-- défaut pour tous les joueurs, sauf les administrateurs (qui possèdent
-- tout). Les filtres et tris de la draft sont gardés. Les mini admins
-- reçoivent leurs 30 Koyns de départ à leur première visite (cf.
-- api/_lib/koyns.js).
--
-- IDs Discord des administrateurs (variable Vercel ADMIN_DISCORD_IDS) :
-- Koy, Strike_LittleBig, Lightningstorm01.

update profiles
set data = jsonb_set(
  data,
  '{parametres}',
  coalesce(data->'parametres', '{}'::jsonb) - 'fond' - 'banniere' - 'banniere2' - 'skins' - 'voyageur' - 'manekin'
)
where data ? 'parametres'
  and discord_id <> all (array[
    '544240202416128012',
    '642409257597272077',
    '956258311139885106'
  ]::text[]);

-- Vérification : cosmétiques encore portés (administrateurs seulement).
select discord_id, coalesce(discord_global_name, discord_username) as nom,
  (select string_agg(k, ', ') from jsonb_object_keys(coalesce(data->'parametres', '{}'::jsonb)) k where k <> 'filtres_draft') as cosmetiques
from profiles
order by nom;
