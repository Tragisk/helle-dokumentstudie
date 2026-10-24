import { createClient } from "@supabase/supabase-js";

// Offentlig nøgle: den er beregnet til at ligge i browseren. Al adgang styres af login og
// Row Level Security i databasen, så nøglen giver ingen adgang til data uden et gyldigt login.
export const SUPABASE_URL = "https://pigrfvavanlpdetlbgfn.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpZ3JmdmF2YW5scGRldGxiZ2ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MzA3NjMsImV4cCI6MjEwODAwNjc2M30.1ZVkaQjKJ-hYRqA7qLs51y6vCX6ZYUqRyRkmHnOU4Og";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Pæn dansk fejltekst fra Supabase-fejl */
export function fejltekst(e: unknown): string {
  if (!e) return "Ukendt fejl";
  const m = (e as { message?: string }).message ?? String(e);
  if (/JWT expired|invalid JWT/i.test(m)) return "Din session er udløbet. Log ind igen.";
  if (/permission denied|42501|row-level security/i.test(m)) return "Du har ikke adgang til at gøre dette.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Ingen forbindelse til serveren. Tjek din internetforbindelse.";
  return m;
}
