import { useEffect, useRef, useState } from "react";
import { sb, fejltekst } from "../lib/supabase";
import { laesLogo, fmtDato } from "../lib/doc";
import { useStore, tplNyeste, tplKladde, pDok, brugBeskrivelse, varKladde } from "../lib/store";
import { ONBOARDING, STATUS_TEKST, type Partner } from "../lib/types";
import { Chip, Confirm, Modal, useToast } from "./ui";
import type { Nav } from "../App";

export function TplOverview({ go, onNyPartner }: { go: (n: Nav) => void; onNyPartner: () => void }) {
  const { data, kanRette } = useStore();
  return (
    <div className="ovwrap">
      <div className="ovhead"><h2>LEA skabeloner</h2><span className="grow" />{kanRette && <button className="btn primary" onClick={onNyPartner}>+ Ny partner</button>}</div>
      <div className="ovgrid">
        <section className="card wide"><h3>Partnere</h3>
          {data.partnere.length ? <table className="dt"><thead><tr><th>Partner</th><th>Godkendt</th><th>Varianter</th><th>Bag standarden</th><th>Onboarding</th><th /></tr></thead><tbody>
            {data.partnere.map((p) => {
              const docs = data.partnerDoks.filter((x) => x.partner_id === p.id);
              const godk = docs.filter((x) => x.status === "godk").length;
              const varianter = docs.filter((x) => x.tilstand === "variant").length;
              const bagud = docs.filter((x) => brugBeskrivelse(data, p.id, x.dok_id).bagud).length;
              const ck = ONBOARDING.filter(([k]) => p.onboarding?.[k]).length;
              return <tr key={p.id}>
                <td className="nm"><div className="lg">{p.logo && <img src={p.logo} alt="" />}<span>{p.navn}</span></div></td>
                <td>{godk} af {docs.length}</td>
                <td>{varianter ? varianter : "–"}</td>
                <td>{bagud ? <Chip kind="old">{bagud} dokument{bagud === 1 ? "" : "er"}</Chip> : <Chip kind="godk">Opdateret</Chip>}</td>
                <td><div className="lg"><div className="prog"><i style={{ width: `${Math.round(ck / ONBOARDING.length * 100)}%` }} /></div><span className="hint">{ck}/{ONBOARDING.length}</span></div></td>
                <td><button className="btn small" onClick={() => go({ ws: p.id, view: "overview" })}>Åbn</button></td>
              </tr>;
            })}</tbody></table> : <div className="empty">Ingen partnere endnu.</div>}
        </section>
        <section className="card wide"><h3>Skabeloner</h3>
          <table className="dt"><thead><tr><th>Dokument</th><th>Nyeste</th><th>Kladde</th><th>Publiceret</th><th>Følger standarden</th><th /></tr></thead><tbody>
            {data.dokTyper.map((d) => {
              const ny = tplNyeste(data, d.id), kl = tplKladde(data, d.id);
              const pds = data.partnerDoks.filter((x) => x.dok_id === d.id);
              const folg = pds.filter((x) => x.tilstand === "standard" && !x.skabelon_version).length;
              return <tr key={d.id}><td className="nm">{d.navn}</td><td>v{ny?.version ?? "–"}</td><td>{kl ? <Chip kind="draft">Kladde</Chip> : "–"}</td>
                <td>{fmtDato(ny?.publiceret)}</td><td>{folg} af {pds.length} partnere</td>
                <td><button className="btn small" onClick={() => go({ ws: "tpl", view: "doc", dok: d.id })}>Åbn</button></td></tr>;
            })}</tbody></table>
          <div className="hint" style={{ marginTop: 10 }}>Skabelonerne er master. Partnere, der følger standarden, får en ny version, så snart den publiceres. Partnernavnet står som en pink markering i skabelonen.</div>
        </section>
      </div>
    </div>
  );
}

export function PartnerOverview({ pid, go }: { pid: string; go: (n: Nav) => void }) {
  const { data, kanRette, erAdmin, patch, reload, log } = useStore();
  const toast = useToast();
  const p = data.partnere.find((x) => x.id === pid)!;
  const [form, setForm] = useState<Partner>(p);
  const [slet, setSlet] = useState(false);
  const [sletNavn, setSletNavn] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number>();
  useEffect(() => { setForm(p); /* eslint-disable-next-line */ }, [pid]);
  if (!p) return null;

  async function gem(fields: Partial<Partner>, straks = false) {
    const next = { ...form, ...fields }; setForm(next);
    patch((d) => ({ ...d, partnere: d.partnere.map((x) => x.id === pid ? { ...x, ...fields } : x) }));
    clearTimeout(timer.current);
    const run = async () => { const { error } = await sb.from("ds_partnere").update(fields).eq("id", pid); if (error) toast("Kunne ikke gemme: " + fejltekst(error)); };
    if (straks) await run(); else timer.current = window.setTimeout(run, 600);
  }
  const ck = ONBOARDING.filter(([k]) => form.onboarding?.[k]).length;
  const inp = (k: keyof Partner, label: string, type = "text") =>
    <label>{label}<input type={type} value={String(form[k] ?? "")} disabled={!kanRette} onChange={(e) => gem({ [k]: e.target.value } as Partial<Partner>)} /></label>;

  return (
    <div className="ovwrap">
      <div className="ovhead">{form.logo && <img src={form.logo} alt="" />}<h2>{form.navn}</h2><span className="grow" />
        {erAdmin && <button className="btn danger" onClick={() => setSlet(true)}>Slet partner</button>}</div>
      <div className="ovgrid">
        <section className="card"><h3>Partneroplysninger</h3>
          <div className="logoedit"><div className="logobox">{form.logo ? <img src={form.logo} alt="" /> : "Intet logo"}</div>
            {kanRette && <div style={{ display: "grid", gap: 6 }}><div className="actions">
              <button className="btn small" onClick={() => fileRef.current?.click()}>{form.logo ? "Skift logo" : "Upload logo"}</button>
              {form.logo && <button className="btn small danger" onClick={() => gem({ logo: null }, true)}>Fjern</button>}</div>
              <div className="hint">PNG, JPG eller SVG. Vises øverst til højre på alle sider.</div></div>}
            <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
              try { await gem({ logo: await laesLogo(f) }, true); await log("Logo opdateret", { partner_id: pid }); toast("Logoet er opdateret i alle dokumenter"); } catch (err) { toast("Logoet kunne ikke indlæses: " + fejltekst(err)); }
            }} /></div>
          <label>Partnernavn<input value={form.navn} disabled={!kanRette} onChange={(e) => e.target.value.trim() && gem({ navn: e.target.value })} /></label>
          <div className="two">{inp("cvr", "CVR-nr.")}{inp("ft_id", "FT-id")}</div>
          <div className="two">{inp("kontakt", "Kontaktperson")}{inp("email", "E-mail", "email")}</div>
          <label>Noter<textarea value={form.noter} disabled={!kanRette} onChange={(e) => gem({ noter: e.target.value })} placeholder="Aftaler, særlige vilkår, næste skridt …" /></label>
          <div className="hint">Navnet opdateres automatisk i alle partnerens dokumenter.</div>
        </section>
        <section className="card"><h3>Onboarding <div className="prog"><i style={{ width: `${Math.round(ck / ONBOARDING.length * 100)}%` }} /></div><span className="hint">{ck}/{ONBOARDING.length}</span></h3>
          {ONBOARDING.map(([k, t]) => {
            const v = form.onboarding?.[k] ?? null;
            return <label key={k} className={"chk" + (v ? " done" : "")}>
              <input type="checkbox" checked={!!v} disabled={!kanRette} onChange={(e) => gem({ onboarding: { ...form.onboarding, [k]: e.target.checked ? new Date().toISOString().slice(0, 10) : null } }, true)} />
              <span>{t}</span>
              <input type="date" value={v ?? ""} disabled={!v || !kanRette} onChange={(e) => e.target.value && gem({ onboarding: { ...form.onboarding, [k]: e.target.value } }, true)} />
            </label>;
          })}
        </section>
        <section className="card wide"><h3>Dokumenter</h3>
          <table className="dt"><thead><tr><th>Dokument</th><th>I brug</th><th>Status</th><th /></tr></thead><tbody>
            {data.dokTyper.map((d) => {
              const pd = pDok(data, pid, d.id);
              if (!pd) return <tr key={d.id}><td className="nm muted">{d.navn}</td><td colSpan={2} className="hint">Ikke med i partnerens materiale</td>
                <td>{kanRette && <button className="btn small" onClick={async () => {
                  const { error } = await sb.from("ds_partner_dokumenter").insert({ partner_id: pid, dok_id: d.id });
                  if (error) return toast(fejltekst(error)); await log("Dokument tilføjet", { partner_id: pid, dok_id: d.id }); await reload(); toast(`${d.navn} er tilføjet`);
                }}>Tilføj</button>}</td></tr>;
              const b = brugBeskrivelse(data, pid, d.id), kl = varKladde(data, pid, d.id);
              return <tr key={d.id}><td className="nm">{d.navn}</td>
                <td>{b.tekst} {b.bagud && <Chip kind="old">Ny standard</Chip>} {kl && <Chip kind="draft">Kladde</Chip>}</td>
                <td><Chip kind={pd.status}>{STATUS_TEKST[pd.status]}</Chip></td>
                <td><button className="btn small" onClick={() => go({ ws: pid, view: "doc", dok: d.id })}>Åbn</button></td></tr>;
            })}</tbody></table>
        </section>
      </div>
      {slet && <Confirm title={`Slet ${p.navn}?`} danger ok="Slet partner" onClose={() => setSlet(false)}
        text="Partneren og alle dens varianter og versioner slettes. Skabelonerne påvirkes ikke. Det kan ikke fortrydes uden en backup."
        onOk={async () => {
          if (sletNavn.trim() !== p.navn) { toast("Skriv partnernavnet præcist for at bekræfte"); return; }
          const { error } = await sb.from("ds_partnere").delete().eq("id", pid);
          if (error) return toast(fejltekst(error));
          await log("Partner slettet", { detaljer: { navn: p.navn } }); setSlet(false); await reload(); go({ ws: "tpl", view: "overview" }); toast("Partneren er slettet");
        }}><label>Skriv partnernavnet for at bekræfte<input value={sletNavn} onChange={(e) => setSletNavn(e.target.value)} /></label></Confirm>}
    </div>
  );
}

export function NyPartner({ onClose, go }: { onClose: () => void; go: (n: Nav) => void }) {
  const { data, reload, log } = useStore();
  const toast = useToast();
  const [navn, setNavn] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [docs, setDocs] = useState<string[]>(data.dokTyper.map((d) => d.id));
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function opret() {
    const n = navn.trim();
    if (!n) return toast("Skriv partnerens navn");
    if (data.partnere.some((p) => p.navn.toLowerCase() === n.toLowerCase())) return toast("Der findes allerede en partner med det navn");
    if (!docs.length) return toast("Vælg mindst ét dokument");
    setBusy(true);
    try {
      const { data: p, error } = await sb.from("ds_partnere").insert({ navn: n, logo }).select("id").single();
      if (error) throw error;
      const { error: e2 } = await sb.from("ds_partner_dokumenter").insert(docs.map((d) => ({ partner_id: p.id, dok_id: d })));
      if (e2) throw e2;
      await log("Partner oprettet", { partner_id: p.id, detaljer: { navn: n, dokumenter: docs } });
      await reload(); onClose(); go({ ws: p.id, view: "overview" });
      toast(`${n} er oprettet og følger standarden på ${docs.length} dokumenter`);
    } catch (e) { toast(fejltekst(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Ny partner" onClose={onClose}>
      <p>Partneren får alle valgte dokumenter i nyeste standardversion med eget navn og logo. Varianter kan laves bagefter.</p>
      <label>Partnernavn<input value={navn} onChange={(e) => setNavn(e.target.value)} placeholder="Fx Nordisk Forsikringsmægler" autoFocus /></label>
      <label>Logo<div className="logoedit" style={{ margin: 0 }}><div className="logobox">{logo ? <img src={logo} alt="" /> : "Intet logo"}</div>
        <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>Vælg fil</button></div></label>
      <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
        try { setLogo(await laesLogo(f)); } catch (err) { toast(fejltekst(err)); } }} />
      <label>Dokumenter<div className="checks">{data.dokTyper.map((d) => <label key={d.id}><input type="checkbox" checked={docs.includes(d.id)}
        onChange={(e) => setDocs(e.target.checked ? [...docs, d.id] : docs.filter((x) => x !== d.id))} /> {d.navn}</label>)}</div></label>
      <div className="row"><button className="btn" onClick={onClose}>Annullér</button><button className="btn primary" disabled={busy} onClick={opret}>Opret partner</button></div>
    </Modal>
  );
}
