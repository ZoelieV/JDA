-- Anti-triche du classé, temps suspects (à lancer une fois dans Supabase :
-- SQL Editor > New query > Run). Sans risque si relancé.

-- Match classé dont un temps est sous les meilleurs temps connus du boss
-- (cf. TEMPS_SUSPECTS dans api/_lib/sanctions.js) : transmis aux
-- administrateurs (section Litiges, triche = true) avec le détail :
-- { niveau: 1 | 2, j1: { secondes, niveau, limite, minimum } | null, j2 }.
alter table match_history add column if not exists suspicion jsonb;
