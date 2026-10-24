// LEA Dokumentstudie: brugeradministration, der kræver servicerolle.
// Kaldes fra appen med brugerens login (JWT). Funktionen tjekker selv, at kalderen er aktiv admin.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { fejl: "Kun POST" });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  if (ue || !u?.user) return json(401, { fejl: "Ikke logget ind" });
  const { data: kalder } = await admin.from("ds_brugere").select("rolle, aktiv").eq("bruger_id", u.user.id).maybeSingle();
  if (!kalder || !kalder.aktiv || kalder.rolle !== "admin") return json(403, { fejl: "Kun admin kan gøre dette" });

  let b: { action?: string; email?: string; kode?: string };
  try { b = await req.json(); } catch { return json(400, { fejl: "Ugyldig JSON" }); }

  if (b.action === "saet_kode") {
    const email = String(b.email ?? "").trim().toLowerCase();
    const kode = String(b.kode ?? "");
    if (kode.length < 10) return json(400, { fejl: "Adgangskoden skal være mindst 10 tegn" });
    const { data: mål } = await admin.from("ds_brugere").select("bruger_id, aktiv").eq("email", email).maybeSingle();
    if (!mål) return json(404, { fejl: "Brugeren er ikke på adgangslisten" });
    if (!mål.aktiv) return json(400, { fejl: "Brugeren er ikke aktiv" });
    if (mål.bruger_id) {
      const { error } = await admin.auth.admin.updateUserById(mål.bruger_id, { password: kode });
      if (error) return json(400, { fejl: error.message });
    } else {
      const { error } = await admin.auth.admin.createUser({ email, password: kode, email_confirm: true });
      if (error) return json(400, { fejl: error.message });
    }
    await admin.from("ds_log").insert({ handling: "Adgangskode sat", bruger: u.user.id, bruger_navn: u.user.email ?? "", detaljer: { email } });
    return json(200, { ok: true });
  }
  return json(400, { fejl: "Ukendt action" });
});
