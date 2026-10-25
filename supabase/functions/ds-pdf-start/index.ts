// LEA Dokumentstudie: starter PDF-jobbet på GitHub (workflow_dispatch).
// Kaldes fra appen med brugerens login. GitHub-nøglen ligger som Supabase-hemmelighed GITHUB_PDF_TOKEN.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const REPO = "Tragisk/helle-dokumentstudie";
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
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json(401, { fejl: "Ikke logget ind" });
  const { data: b } = await admin.from("ds_brugere").select("aktiv").eq("bruger_id", u.user.id).maybeSingle();
  if (!b?.aktiv) return json(403, { fejl: "Ingen adgang" });

  let body: { job_id?: string };
  try { body = await req.json(); } catch { return json(400, { fejl: "Ugyldig JSON" }); }
  const id = String(body.job_id ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { fejl: "Ugyldigt job" });
  const { data: job } = await admin.from("ds_pdf_jobs").select("id, status, bestilt_af").eq("id", id).maybeSingle();
  if (!job || job.bestilt_af !== u.user.id || job.status !== "venter") return json(404, { fejl: "Jobbet findes ikke" });

  const token = Deno.env.get("GITHUB_PDF_TOKEN");
  if (!token) return json(500, { fejl: "PDF-motoren er ikke sat op endnu (mangler GitHub-nøgle)" });
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/pdf.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "lea-dokumentstudie", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { job_id: id } }),
  });
  if (r.status !== 204) {
    await admin.from("ds_pdf_jobs").update({ status: "fejl", fejl: `GitHub svarede ${r.status}` }).eq("id", id);
    return json(502, { fejl: `Kunne ikke starte PDF-jobbet (GitHub ${r.status})` });
  }
  return json(200, { ok: true });
});
