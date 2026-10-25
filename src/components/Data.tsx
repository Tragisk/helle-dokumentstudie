import { useEffect, useState } from "react";
import { sb, fejltekst } from "../lib/supabase";
import { diffHtml, fmtTid, pagesToLines } from "../lib/doc";
import { useStore, tplNyeste, tplKladde, pDok, aktivKilde, varKladde } from "../lib/store";
import { hentBackup } from "./Admin";
import { Chip, Modal, useToast } from "./ui";
import type { Data as Db, Partner } from "../lib/types";

/** Admin: automatiske snapshots, manuel backup og import fra det lokale HTML-studie. */
export default function DataSide() {
  const { data } = useStore();
  const toast = useToast();
  const [snaps, setSnaps] = useState<{ id: number; tid: string; kb: number }[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => { sb.rpc("ds_backups").then(({ data, error }) => { if (error) toast(fejltekst(error)); setSnaps(data ?? []); }); /* eslint-disable-next-line */ }, []);

  async function hentSnap(id: number, tid: string) {
    const { data: j, error } = await sb.rpc("ds_backup_hent", { p_id: id });
    if (error) return toast(fejltekst(error));
    gemFil(JSON.stringify(j, null, 1), `Dokumentstudie snapshot ${tid.slice(0, 10)}.json`);
  }
  async function laesFil(f: File) {
    try {
      const j = JSON.parse(await f.text());
      const state = j?.state ?? j;
      if (!state || state.version !== 2 || !state.templates || !state.partners) throw new Error("Filen er ikke en backup fra det lokale Dokumentstudie (version 2).");
      setPlan(lavPlan(state, data));
    } catch (e) { toast(fejltekst(e)); }
  }

  return (
    <div className="ovwrap">
      <div className="ovhead"><h2>Backup og import</h2></div>
      <section className="card wide">
        <h3>Automatiske snapshots</h3>
        <p className="hint">Databasen gemmer selv et snapshot af alle dokumenter, partnere og brugere hver mandag nat. De 8 nyeste gemmes.</p>
        {!snaps ? <div className="empty">Henter …</div> : !snaps.length ? <div className="empty">Ingen snapshots endnu.</div> :
          <table className="dt"><thead><tr><th>Tidspunkt</th><th>Størrelse</th><th /></tr></thead><tbody>
            {snaps.map((s) => <tr key={s.id}><td className="nm">{fmtTid(s.tid)}</td><td>{s.kb} kB</td>
              <td className="actions"><button className="btn small" onClick={() => hentSnap(s.id, s.tid)}>⬇ Hent</button></td></tr>)}
          </tbody></table>}
        <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={() => hentBackup(data)}>⬇ Hent backup nu</button></div>
      </section>
      <section className="card wide">
        <h3>Importér fra det lokale Dokumentstudie</h3>
        <p className="hint">Vælg den JSON-backup, du har eksporteret fra HTML-værktøjet ("Eksportér backup"). Du ser en oversigt over ændringerne, før noget bliver gemt.
          Partnere matches på navn. Dokumenter, der afviger fra den nyeste standard, bliver til en variant hos partneren. Ændrede skabeloner bliver til kladder, som du selv publicerer.</p>
        <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) laesFil(f); e.target.value = ""; }} />
      </section>
      {plan && <ImportDialog plan={plan} onClose={() => setPlan(null)} />}
    </div>
  );
}

function gemFil(txt: string, navn: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "application/json" })); a.download = navn; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- plan ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
type Trin =
  | { t: "tpl"; dok: string; navn: string; sider: string[]; aendringer: number; spring?: string }
  | { t: "partner_ny"; key: string; navn: string; felter: Partial<Partner>; docs: string[] }
  | { t: "partner_info"; pid: string; navn: string; felter: Partial<Partner> }
  | { t: "pdok_ny"; pkey: string; navn: string; dok: string; dnavn: string; status: string }
  | { t: "variant"; pkey: string; navn: string; dok: string; dnavn: string; sider: string[]; baseret: string; aendringer: number; status: string; spring?: string };
interface Plan { trin: Trin[]; ukendte: string[]; }

const tekst = (sider: string[]) => pagesToLines(sider).map((l) => (l.sep ? "§" : l.t)).join("\n");
const sideraf = (r: any): string[] | null => {
  if (!r) return null;
  if (Array.isArray(r.draft) && r.draft.length) return r.draft;
  const v = (r.versions || []).find((x: any) => x.v === r.current) ?? (r.versions || []).at(-1);
  return v?.pages ?? null;
};

function lavPlan(state: any, d: Db): Plan {
  const trin: Trin[] = []; const ukendte: string[] = [];
  const dnavn = (id: string) => d.dokTyper.find((x) => x.id === id)?.navn ?? id;
  for (const [id, t] of Object.entries<any>(state.templates)) {
    if (!d.dokTyper.some((x) => x.id === id)) { ukendte.push(t.name || id); continue; }
    const lok = sideraf(t), ny = tplNyeste(d, id);
    if (!lok || !ny || tekst(lok) === tekst(ny.sider)) continue;
    trin.push({ t: "tpl", dok: id, navn: dnavn(id), sider: lok, aendringer: diffHtml(ny.sider, lok).changes,
      spring: tplKladde(d, id) ? "Der ligger allerede en kladde online. Den bliver ikke overskrevet." : undefined });
  }
  const order: string[] = state.porder?.length ? state.porder : Object.keys(state.partners);
  for (const key of order) {
    const p = state.partners[key]; if (!p?.name) continue;
    const navn = String(p.name).trim();
    const online = d.partnere.find((x) => x.navn.trim().toLowerCase() === navn.toLowerCase());
    const onb: Record<string, string | null> = {};
    for (const [k, v] of Object.entries<any>(p.checklist || {})) if (v) onb[k] = String(v).slice(0, 10);
    const lokFelter: Partial<Partner> = { logo: p.logo || null, cvr: p.cvr || "", ft_id: p.ft || "", kontakt: p.contact || "", email: p.email || "", noter: p.notes || "", onboarding: onb };
    const docIds = Object.keys(p.docs || {}).filter((id) => d.dokTyper.some((x) => x.id === id));
    const pkey = online ? online.id : "ny:" + key;
    if (!online) trin.push({ t: "partner_ny", key: pkey, navn, felter: lokFelter, docs: [] });
    else {
      // Udfyld kun felter, der er tomme online
      const f: Partial<Partner> = {};
      (["cvr", "ft_id", "kontakt", "email", "noter"] as const).forEach((k) => { if (!online[k] && lokFelter[k]) f[k] = lokFelter[k] as string; });
      if (!online.logo && lokFelter.logo) f.logo = lokFelter.logo;
      const onlineOnb = Object.fromEntries(Object.entries(online.onboarding || {}).filter(([, v]) => v));
      const mergedOnb = { ...onb, ...onlineOnb };
      if (Object.keys(mergedOnb).length > Object.keys(onlineOnb).length) f.onboarding = { ...(online.onboarding || {}), ...mergedOnb };
      if (Object.keys(f).length) trin.push({ t: "partner_info", pid: online.id, navn, felter: f });
    }
    for (const id of docIds) {
      const r = p.docs[id], lok = sideraf(r), ny = tplNyeste(d, id); if (!lok || !ny) continue;
      const status = ["kladde", "til", "godk"].includes(r.status) ? r.status : "kladde";
      const harOnline = online && pDok(d, online.id, id);
      if (!harOnline) trin.push({ t: "pdok_ny", pkey, navn, dok: id, dnavn: dnavn(id), status });
      if (tekst(lok) === tekst(ny.sider)) continue;
      if (online && harOnline) { const ak = aktivKilde(d, online.id, id); if (ak && tekst(ak.sider) === tekst(lok)) continue; }
      trin.push({ t: "variant", pkey, navn, dok: id, dnavn: dnavn(id), sider: lok, baseret: ny.version!, aendringer: diffHtml(ny.sider, lok).changes, status,
        spring: online && varKladde(d, online.id, id) ? "Der ligger allerede en variant-kladde online. Den bliver ikke overskrevet." : undefined });
    }
  }
  return { trin, ukendte };
}

function ImportDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { reload, log, mig } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fremdrift, setFremdrift] = useState("");
  const aktive = plan.trin.filter((t) => !("spring" in t && t.spring));

  async function koer() {
    setBusy(true);
    const ids = new Map<string, string>(); const note = "Importeret fra lokal studie";
    let ok = 0;
    try {
      for (const t of aktive) {
        setFremdrift(`${ok + 1} af ${aktive.length}`);
        if (t.t === "tpl") {
          const { error } = await sb.from("ds_skabelon_versioner").insert({ dok_id: t.dok, status: "kladde", sider: t.sider, note, forfatter_navn: mig?.navn ?? "" });
          if (error) throw error;
        } else if (t.t === "partner_ny") {
          const { data: p, error } = await sb.from("ds_partnere").insert({ navn: t.navn, ...t.felter }).select("id").single();
          if (error) throw error; ids.set(t.key, p.id);
          await log("Partner importeret", { partner_id: p.id, detaljer: { navn: t.navn } });
        } else if (t.t === "partner_info") {
          const { error } = await sb.from("ds_partnere").update(t.felter).eq("id", t.pid); if (error) throw error;
        } else if (t.t === "pdok_ny") {
          const pid = ids.get(t.pkey) ?? t.pkey;
          const { error } = await sb.from("ds_partner_dokumenter").insert({ partner_id: pid, dok_id: t.dok, status: t.status }); if (error) throw error;
        } else if (t.t === "variant") {
          const pid = ids.get(t.pkey) ?? t.pkey;
          const { error } = await sb.from("ds_variant_versioner").insert({ partner_id: pid, dok_id: t.dok, status: "kladde", baseret_paa: t.baseret, sider: t.sider, forfatter_navn: mig?.navn ?? "" });
          if (error) throw error;
          const { error: e2 } = await sb.rpc("ds_publicer_variant", { p_partner: pid, p_dok: t.dok, p_stor: false, p_note: note }); if (e2) throw e2;
          await sb.from("ds_partner_dokumenter").update({ status: t.status }).eq("partner_id", pid).eq("dok_id", t.dok);
        }
        ok++;
      }
      await log("Import fra lokal studie", { detaljer: { trin: ok } });
      toast(`Importen er færdig (${ok} ændringer)`);
      await reload(); onClose();
    } catch (e) {
      toast(`Importen stoppede efter ${ok} af ${aktive.length} trin: ${fejltekst(e)}`);
      await reload(); setBusy(false);
    }
  }

  const linje = (t: Trin) => {
    switch (t.t) {
      case "tpl": return <><b>Skabelon · {t.navn}</b>: ny kladde med {t.aendringer} tekstændringer</>;
      case "partner_ny": return <><b>{t.navn}</b>: ny partner{t.felter.logo ? " med logo" : ""}</>;
      case "partner_info": return <><b>{t.navn}</b>: udfylder {Object.keys(t.felter).map((k) => ({ ft_id: "FT-id", noter: "noter", onboarding: "onboarding-datoer" } as Record<string, string>)[k] ?? k).join(", ")}</>;
      case "pdok_ny": return <><b>{t.navn} · {t.dnavn}</b>: tilføjes og følger standarden</>;
      case "variant": return <><b>{t.navn} · {t.dnavn}</b>: variant med {t.aendringer} tekstændringer i forhold til standard v{t.baseret}</>;
    }
  };
  return (
    <Modal title="Import fra det lokale Dokumentstudie" onClose={busy ? () => {} : onClose} wide>
      {!plan.trin.length ? <p>Alt i filen findes allerede online. Der er intet at importere.</p> : <>
        <p>Følgende bliver gemt online. Intet eksisterende bliver slettet eller overskrevet.</p>
        <ul className="implist">{plan.trin.map((t, i) => <li key={i}>{linje(t)}{"spring" in t && t.spring && <> <Chip kind="old">Springes over</Chip> <span className="hint">{t.spring}</span></>}</li>)}</ul>
      </>}
      {plan.ukendte.length > 0 && <p className="hint">Ukendte dokumenttyper i filen bliver ikke importeret: {plan.ukendte.join(", ")}.</p>}
      <div className="row"><button className="btn" disabled={busy} onClick={onClose}>Annullér</button>
        {aktive.length > 0 && <button className="btn primary" disabled={busy} onClick={koer}>{busy ? `Importerer … ${fremdrift}` : `Importér ${aktive.length} ændringer`}</button>}</div>
    </Modal>
  );
}
