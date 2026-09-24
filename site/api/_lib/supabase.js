const { createClient } = require("@supabase/supabase-js");

// Client Supabase partagé, pour éviter de le recréer dans chaque route.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = { supabase };