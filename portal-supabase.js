// Shared Supabase client for the Apex Advantage member portal.
// Same project as the apexadvantage flight-school ops app — students
// sign in with the same account, backed by the same `profiles` table.
window.apexSupabase = supabase.createClient(
  'https://wqzfhcjsfzwrimvsudxy.supabase.co',
  'sb_publishable_8mFbiW9M0dkIv9K2fcwDxQ_oRJnlBUo'
);
