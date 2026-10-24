// LEA Dokumentstudie: import af dokumenter fra Claude.
// Kræver en tidsbegrænset importnøgle (kun SHA-256-hash ligger i databasen).
// Kan oprette dokumenttyper, lægge skabelon-KLADDER ind og oprette partnere.
// Kan IKKE publicere skabeloner, undtagen første version af en helt ny dokumenttype.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const isPages = (x: unknown) => Array.isArray(x) && x.length > 0 && x.length <= 40 && x.every((p) => typeof p === "string" && p.length < 200000);

async function ensureDocType(dok: any) {
  if (!dok || typeof dok.id !== "string" || !/^[a-z0-9_-]{2,40}$/.test(dok.id)) throw new Error("Ugyldigt dok.id");
  const { data } = await db.from("ds_dokumenttyper").select("id").eq("id", dok.id).maybeSingle();
  if (data) return false;
  const { error } = await db.from("ds_dokumenttyper").insert({
    id: dok.id, navn: String(dok.navn ?? dok.id), sidefod_titel: String(dok.sidefod_titel ?? dok.navn ?? dok.id),
    label: String(dok.label ?? "Internt salgsmateriale"), css: String(dok.css ?? ""), sortering: Number(dok.sortering ?? 100),
  });
  if (error) throw error;
  return true;
}
async function log(handling: string, dok_id: string | null, detaljer: unknown, partner_id: string | null = null) {
  await db.from("ds_log").insert({ handling, dok_id, partner_id, bruger: null, bruger_navn: "Claude (import)", detaljer });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { fejl: "Kun POST" });
  const token = req.headers.get("x-ds-import") ?? "";
  if (token.length < 30) return json(401, { fejl: "Mangler nøgle" });
  const { data: key } = await db.from("ds_import_noegler").select("udloeber").eq("hash", await sha256(token)).maybeSingle();
  if (!key || new Date(key.udloeber) < new Date()) return json(401, { fejl: "Ugyldig eller udløbet nøgle" });

  let b: any;
  try { b = await req.json(); } catch { return json(400, { fejl: "Ugyldig JSON" }); }
  try {
    if (b.action === "kladde") {
      // Opret/erstat skabelonkladde for en dokumenttype (opretter typen, hvis den er ny)
      const created = b.dok ? await ensureDocType(b.dok) : false;
      const dok_id = b.dok?.id ?? b.dok_id;
      if (!isPages(b.sider)) throw new Error("sider skal være en liste af HTML-strenge");
      const note = String(b.note ?? "Kladde fra Claude");
      const { data: ex } = await db.from("ds_skabelon_versioner").select("id").eq("dok_id", dok_id).eq("status", "kladde").maybeSingle();
      const row = { sider: b.sider, note, forfatter: null, forfatter_navn: "Claude", opdateret: new Date().toISOString() };
      const { error } = ex ? await db.from("ds_skabelon_versioner").update(row).eq("id", ex.id)
                           : await db.from("ds_skabelon_versioner").insert({ ...row, dok_id, status: "kladde" });
      if (error) throw error;
      await log("Kladde lagt op af Claude", dok_id, { note, ny_dokumenttype: created });
      return json(200, { ok: true, dok_id, ny_dokumenttype: created, erstattede_kladde: !!ex });
    }
    if (b.action === "foerste_version") {
      // Kun for en dokumenttype uden publicerede versioner: publicér v1.0 direkte
      await ensureDocType(b.dok);
      if (!isPages(b.sider)) throw new Error("sider skal være en liste af HTML-strenge");
      const { count } = await db.from("ds_skabelon_versioner").select("id", { count: "exact", head: true }).eq("dok_id", b.dok.id).eq("status", "publiceret");
      if ((count ?? 0) > 0) return json(409, { fejl: "Dokumenttypen har allerede publicerede versioner. Brug action=kladde." });
      const note = String(b.note ?? "Første version fra Claude");
      const { error } = await db.from("ds_skabelon_versioner").insert({ dok_id: b.dok.id, version: "1.0", status: "publiceret", sider: b.sider, note, forfatter: null, forfatter_navn: "Claude", publiceret: new Date().toISOString() });
      if (error) throw error;
      await log("Første version publiceret af Claude", b.dok.id, { version: "1.0", note });
      return json(200, { ok: true, dok_id: b.dok.id, version: "1.0" });
    }
    if (b.action === "partner") {
      const navn = String(b.navn ?? "").trim();
      if (!navn) throw new Error("navn mangler");
      const { data: ex } = await db.from("ds_partnere").select("id").ilike("navn", navn).maybeSingle();
      if (ex) return json(409, { fejl: "Partneren findes allerede", id: ex.id });
      const { data: p, error } = await db.from("ds_partnere").insert({ navn, logo: b.logo ?? null }).select("id").single();
      if (error) throw error;
      const docs: string[] = Array.isArray(b.dokumenter) ? b.dokumenter : [];
      if (docs.length) {
        const { error: e2 } = await db.from("ds_partner_dokumenter").insert(docs.map((d) => ({ partner_id: p.id, dok_id: d })));
        if (e2) throw e2;
      }
      await log("Partner oprettet af Claude", null, { navn, dokumenter: docs }, p.id);
      return json(200, { ok: true, id: p.id });
    }
    return json(400, { fejl: "Ukendt action" });
  } catch (e) {
    return json(400, { fejl: e instanceof Error ? e.message : String(e) });
  }
});
