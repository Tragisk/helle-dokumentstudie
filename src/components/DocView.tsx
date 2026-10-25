import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb, fejltekst } from "../lib/supabase";
import { buildHtml, readPages, diffHtml, subst, fmtTid, esc } from "../lib/doc";
import { useStore, kilder, aktivKilde, tplNyeste, tplKladde, varKladde, pDok, partnerAf } from "../lib/store";
import { STATUS_TEKST, type Kilde, type Status } from "../lib/types";
import { Modal, Confirm, Chip, useToast } from "./ui";

type Panel = null | "history" | "compare";
type Gem = "gemt" | "gemmer" | "fejl" | null;

export default function DocView({ ws, dokId }: { ws: string; dokId: string }) {
  const { data, mig, kanRette, erAdmin, reload, patch, log } = useStore();
  const toast = useToast();
  const isTpl = ws === "tpl";
  const dok = data.dokTyper.find((d) => d.id === dokId)!;
  const partner = isTpl ? null : partnerAf(data, ws);
  const alle = useMemo(() => kilder(data, ws, dokId), [data, ws, dokId]);
  const aktiv = isTpl ? null : aktivKilde(data, ws, dokId);
  const nyeste = tplNyeste(data, dokId);
  const pd = isTpl ? null : pDok(data, ws, dokId);
  const kladde = isTpl ? tplKladde(data, dokId) : varKladde(data, ws, dokId);

  const standardKey = () => (kladde ? (isTpl ? "s:kladde" : "v:kladde") : isTpl ? (nyeste ? "s:" + nyeste.version : "") : aktiv?.key ?? "");
  const [viewKey, setViewKey] = useState<string>(standardKey);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);
  const [gem, setGem] = useState<Gem>(null);
  const [over, setOver] = useState<number[]>([]);
  const [modal, setModal] = useState<null | "publicer" | "kasser" | "udskriv" | { slet: Kilde }>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number>();

  // Skift dokument/arbejdsområde: nulstil visning
  useEffect(() => { setViewKey(standardKey()); setEditing(false); setPanel(null); setCmp(null); setGem(null); /* eslint-disable-next-line */ }, [ws, dokId]);
  // Hvis den viste version forsvinder (fx kladde publiceret), vis standard
  useEffect(() => { if (!alle.find((k) => k.key === viewKey)) setViewKey(standardKey()); /* eslint-disable-next-line */ }, [alle]);

  const kilde = alle.find((k) => k.key === viewKey) ?? alle[0] ?? null;
  const visTekst = kilde ? (kilde.version ? "v" + kilde.version : "kladde") : "";
  const erKladde = !!kilde && kilde.version === null;

  // HTML'en fryses under redigering, så markøren ikke hopper
  const htmlKey = editing ? `edit:${kilde?.rec.id}` : `${kilde?.key}:${kilde?.rec.id}:${kilde?.rec.opdateret}:${partner?.navn}:${partner?.logo?.length}`;
  const html = useMemo(() => kilde ? buildHtml({ dok, partner, sider: kilde.sider, versionTekst: visTekst, visVersion: true }) : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [htmlKey, dok?.css, dok?.label, dok?.sidefod_titel]);

  // ---------- ramme ----------
  const sizeFrame = useCallback(() => {
    const f = frameRef.current, wrap = wrapRef.current, stage = stageRef.current; if (!f || !wrap || !stage) return;
    try {
      const h = f.contentDocument!.documentElement.scrollHeight + 10;
      f.style.height = h + "px";
      const sc = Math.min(1, (stage.clientWidth - 44) / 820);
      f.style.transform = `scale(${sc})`; wrap.style.width = 820 * sc + "px"; wrap.style.height = h * sc + "px";
    } catch { /* ramme ikke klar */ }
  }, []);
  const checkOverflow = useCallback(() => {
    const w = frameRef.current?.contentDocument; if (!w) return [];
    const res: number[] = [];
    w.querySelectorAll(".overflow-flag").forEach((x) => x.remove());
    w.querySelectorAll(".page").forEach((pg, i) => {
      const m = pg.querySelector("main") as HTMLElement | null;
      if (m && m.scrollHeight - m.clientHeight > 2) { res.push(i + 1); pg.insertAdjacentHTML("beforeend", '<div class="overflow-flag">Teksten er for lang til siden</div>'); }
    });
    setOver(res); return res;
  }, []);
  const setEditable = useCallback((on: boolean) => {
    const w = frameRef.current?.contentDocument; if (!w?.body) return;
    w.body.classList.toggle("editing", on);
    w.querySelectorAll("main").forEach((m) => on ? m.setAttribute("contenteditable", "true") : m.removeAttribute("contenteditable"));
  }, []);
  useEffect(() => { setEditable(editing); }, [editing, setEditable]);
  useEffect(() => { const r = () => sizeFrame(); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [sizeFrame]);
  useEffect(() => { const t = setTimeout(sizeFrame, 180); return () => clearTimeout(t); }, [panel, sizeFrame]);

  // ---------- gem kladde ----------
  const gemNu = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const w = frameRef.current?.contentDocument; if (!w || !kladde) return;
    const sider = readPages(w);
    setGem("gemmer");
    const tabel = isTpl ? "ds_skabelon_versioner" : "ds_variant_versioner";
    const nu = new Date().toISOString();
    const { error } = await sb.from(tabel).update({ sider, opdateret: nu }).eq("id", kladde.id);
    if (error) { setGem("fejl"); toast("Kunne ikke gemme: " + fejltekst(error)); return; }
    patch((d) => isTpl
      ? { ...d, skabeloner: d.skabeloner.map((s) => s.id === kladde.id ? { ...s, sider, opdateret: nu } : s) }
      : { ...d, varianter: d.varianter.map((v) => v.id === kladde.id ? { ...v, sider, opdateret: nu } : v) });
    setGem("gemt");
  }, [kladde, isTpl, patch, toast]);

  const onInput = useCallback(() => {
    setGem("gemmer"); clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { gemNu(); checkOverflow(); sizeFrame(); }, 900);
  }, [gemNu, checkOverflow, sizeFrame]);

  const onLoad = () => {
    const w = frameRef.current?.contentDocument; if (!w) return;
    setEditable(editing);
    w.addEventListener("input", () => onInputRef.current());
    w.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); gemNuRef.current(); } });
    (w.fonts ? w.fonts.ready : Promise.resolve()).then(() => { sizeFrame(); checkOverflow(); });
    sizeFrame(); checkOverflow();
  };
  const onInputRef = useRef(() => {}); onInputRef.current = onInput;
  const gemNuRef = useRef(async () => {}); gemNuRef.current = gemNu;

  // ---------- handlinger ----------
  async function startRedigering() {
    if (!kilde || !kanRette) return;
    if (erKladde) { setEditing(true); return; }
    const sider = kilde.sider;
    if (isTpl) {
      const { data: row, error } = await sb.from("ds_skabelon_versioner").insert({ dok_id: dokId, status: "kladde", sider, forfatter_navn: mig?.navn ?? "" }).select().single();
      if (error) return toast(fejltekst(error));
      patch((d) => ({ ...d, skabeloner: [...d.skabeloner, row] }));
      setViewKey("s:kladde");
    } else {
      const baseret = kilde.type === "skabelon" ? kilde.version! : kilde.baseretPaa!;
      const { data: row, error } = await sb.from("ds_variant_versioner").insert({ partner_id: ws, dok_id: dokId, status: "kladde", baseret_paa: baseret, sider, forfatter_navn: mig?.navn ?? "" }).select().single();
      if (error) return toast(fejltekst(error));
      patch((d) => ({ ...d, varianter: [...d.varianter, row] }));
      setViewKey("v:kladde");
    }
    setEditing(true);
    toast(isTpl ? "Kladde oprettet. Partnerne ser den først, når den publiceres." : `Variantkladde oprettet for ${partner?.navn}.`);
  }
  async function stopRedigering() { await gemNu(); setEditing(false); }

  async function brug(k: Kilde, folgNyeste = false) {
    if (!pd) return;
    const upd = k.type === "variant"
      ? { tilstand: "variant", variant_version: k.version, opdateret: new Date().toISOString() }
      : { tilstand: "standard", skabelon_version: folgNyeste ? null : k.version, opdateret: new Date().toISOString() };
    const { error } = await sb.from("ds_partner_dokumenter").update(upd).eq("partner_id", ws).eq("dok_id", dokId);
    if (error) return toast(fejltekst(error));
    await log(k.type === "variant" ? `Bruger variant v${k.version}` : folgNyeste ? "Følger nyeste standard" : `Låst til standard v${k.version}`, { partner_id: ws, dok_id: dokId });
    await reload();
    setViewKey(k.key);
    toast(`${partner?.navn} bruger nu ${k.type === "variant" ? "variant v" + k.version : folgNyeste ? "nyeste standard" : "standard v" + k.version}`);
  }
  async function setStatus(s: Status) {
    const { error } = await sb.from("ds_partner_dokumenter").update({ status: s, opdateret: new Date().toISOString() }).eq("partner_id", ws).eq("dok_id", dokId);
    if (error) return toast(fejltekst(error));
    await log(`Status: ${STATUS_TEKST[s]}`, { partner_id: ws, dok_id: dokId });
    patch((d) => ({ ...d, partnerDoks: d.partnerDoks.map((x) => x.partner_id === ws && x.dok_id === dokId ? { ...x, status: s } : x) }));
  }
  function indsaetNavn() {
    const w = frameRef.current?.contentDocument; const sel = w?.getSelection();
    const node = sel && sel.rangeCount ? sel.anchorNode : null;
    const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    if (!w || !sel || !el || !el.closest("main[contenteditable]")) { toast("Klik først i teksten, der hvor navnet skal stå"); return; }
    const rg = sel.getRangeAt(0); rg.deleteContents();
    const span = w.createElement("span"); span.className = "tok"; span.dataset.tok = "partner"; span.contentEditable = "false";
    span.textContent = partner ? partner.navn : "Partnernavn";
    rg.insertNode(span); rg.setStartAfter(span); rg.collapse(true); sel.removeAllRanges(); sel.addRange(rg);
    onInput();
  }
  function udskriv(force = false) {
    const f = frameRef.current; if (!f) return;
    const o = checkOverflow();
    if (!force && (o.length || erKladde || isTpl)) { setModal("udskriv"); return; }
    setEditable(false); f.contentWindow!.focus(); f.contentWindow!.print(); setTimeout(() => setEditable(editing), 600);
  }

  // ---------- PDF med udfyldelige felter (laves af PDF-motoren på GitHub) ----------
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  async function lavPdf() {
    if (!kilde?.version || pdfStatus) return;
    const ver = kilde.version, type = kilde.type;
    const filnavn = `LEA ${dok.navn.replace(" · ", " - ")} - ${partner ? partner.navn : "Skabelon"} v${ver}.pdf`.replace(/[\\/:*?"<>|]/g, "");
    setPdfStatus("Starter PDF-motoren …");
    try {
      const { data: s } = await sb.auth.getSession();
      const uid = s.session?.user.id; if (!uid) throw new Error("Du er ikke logget ind");
      const { data: job, error } = await sb.from("ds_pdf_jobs")
        .insert({ partner_id: partner?.id ?? null, dok_id: dokId, kilde: type, version: ver, status: "venter", bestilt_af: uid }).select("id").single();
      if (error) throw error;
      const r = await sb.functions.invoke("ds-pdf-start", { body: { job_id: job.id } });
      if (r.error) {
        const j = await (r.error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(j?.fejl || "Kunne ikke starte PDF-motoren");
      }
      setPdfStatus("Laver PDF … (typisk 1–2 min)");
      const start = Date.now();
      for (;;) {
        await new Promise((res) => setTimeout(res, 5000));
        const { data: j } = await sb.from("ds_pdf_jobs").select("status, sti, fejl").eq("id", job.id).single();
        if (j?.status === "faerdig" && j.sti) {
          const { data: u, error: ue } = await sb.storage.from("ds-pdf").createSignedUrl(j.sti, 300, { download: filnavn });
          if (ue) throw ue;
          const a = document.createElement("a"); a.href = u.signedUrl; a.click();
          await log("PDF hentet", { partner_id: partner?.id ?? null, dok_id: dokId, detaljer: { version: ver, kilde: type } });
          toast("PDF'en er hentet");
          break;
        }
        if (j?.status === "fejl") throw new Error("PDF-motoren fejlede: " + (j.fejl ?? "ukendt fejl"));
        if (Date.now() - start > 6 * 60_000) throw new Error("PDF-motoren svarer ikke. Prøv igen om lidt.");
      }
    } catch (e) { toast(fejltekst(e)); } finally { setPdfStatus(null); }
  }

  if (!dok) return <div className="empty pad">Dokumentet findes ikke.</div>;
  if (!kilde) return <div className="empty pad">Der er ingen versioner af dette dokument endnu.</div>;

  // ---------- besked-linje ----------
  let notice: JSX.Element | null = null;
  const vis = (k: Kilde) => <button className="btn small" onClick={() => setViewKey(k.key)}>Vis {k.label.toLowerCase()}</button>;
  if (over.length) notice = <div className="notice show warn">Side {over.join(", ")} er for lang, og noget tekst bliver skåret af i udskriften. Kort teksten ned, eller bed Claude om at fordele indholdet på flere sider.</div>;
  else if (editing) notice = <div className="notice show edit">Redigering er slået til. Ændringer gemmes automatisk i kladden. Fed: <b>Ctrl/⌘ + B</b>. {isTpl ? "Det pink felt er partnernavnet og udskiftes hos hver partner." : "Det markerede navn følger partnerens navn."} Brug <b>＋ Partnernavn</b> til at indsætte navnet et nyt sted.</div>;
  else if (isTpl && erKladde) notice = <div className="notice show warn">Du ser <b>kladden</b>. Partnerne ser den først, når den er publiceret{erAdmin ? "." : ". Kun admin kan publicere skabeloner."}</div>;
  else if (isTpl && kladde) notice = <div className="notice show tpl">Der findes en ikke-publiceret kladde af skabelonen. {vis(alle.find((k) => k.key === "s:kladde")!)}</div>;
  else if (!isTpl && aktiv && kilde.key !== aktiv.key) notice = (
    <div className="notice show view">Du ser <b>{kilde.label}</b>. {partner?.navn} bruger <b>{aktiv.label}</b>.
      {kanRette && !erKladde && kilde.type === "variant" && <button className="btn small primary" onClick={() => brug(kilde)}>Brug denne variant</button>}
      {kanRette && kilde.type === "skabelon" && kilde.version === nyeste?.version && <button className="btn small primary" onClick={() => brug(kilde, true)}>Følg standarden</button>}
      {kanRette && kilde.type === "skabelon" && kilde.version !== nyeste?.version && <button className="btn small" onClick={() => brug(kilde)}>Lås til denne version</button>}
      <button className="btn small" onClick={() => setViewKey(aktiv.key)}>Tilbage til aktiv</button>
    </div>);
  else if (!isTpl && aktiv && nyeste) {
    if (aktiv.type === "variant" && aktiv.baseretPaa !== nyeste.version) notice = (
      <div className="notice show tpl">Standarden er opdateret til <b>v{nyeste.version}</b>. Varianten bygger på v{aktiv.baseretPaa}.
        <button className="btn small" onClick={() => { setCmp({ a: aktiv.key, b: "s:" + nyeste.version }); setPanel("compare"); }}>Sammenlign med standarden</button>
        {kanRette && <button className="btn small primary" onClick={() => brug(alle.find((k) => k.key === "s:" + nyeste.version)!, true)}>Skift til standarden</button>}
      </div>);
    else if (aktiv.type === "skabelon" && pd?.skabelon_version && pd.skabelon_version !== nyeste.version) notice = (
      <div className="notice show tpl">Dokumentet er låst til standard <b>v{pd.skabelon_version}</b>. Nyeste standard er v{nyeste.version}.
        <button className="btn small" onClick={() => { setCmp({ a: aktiv.key, b: "s:" + nyeste.version }); setPanel("compare"); }}>Se forskellen</button>
        {kanRette && <button className="btn small primary" onClick={() => brug(alle.find((k) => k.key === "s:" + nyeste.version)!, true)}>Følg nyeste</button>}
      </div>);
  }

  const gemTekst = gem === "gemmer" ? "Gemmer …" : gem === "gemt" ? "Gemt" : gem === "fejl" ? "Ikke gemt!" : "";

  return (
    <>
      <div className="toolbar">
        <div className="ttl"><h1>{dok.navn}</h1><span>{isTpl ? "Skabelon · master for alle partnere" : partner?.navn}</span></div>
        <select className="vsel" value={kilde.key} onChange={(e) => { if (editing) gemNu(); setEditing(false); setViewKey(e.target.value); }} title="Vælg version">
          {!isTpl && <optgroup label={partner?.navn}>{alle.filter((k) => k.type === "variant").map((k) => <option key={k.key} value={k.key}>{k.label}{aktiv?.key === k.key ? " · i brug" : ""}</option>)}</optgroup>}
          <optgroup label="Standard (skabelon)">{alle.filter((k) => k.type === "skabelon").map((k) => <option key={k.key} value={k.key}>{k.label}{aktiv?.key === k.key ? " · i brug" : ""}</option>)}</optgroup>
        </select>
        {!isTpl && pd && <select value={pd.status} disabled={!kanRette} onChange={(e) => setStatus(e.target.value as Status)} title="Status">
          {(["kladde", "til", "godk"] as Status[]).map((s) => <option key={s} value={s}>{STATUS_TEKST[s]}</option>)}</select>}
        {gemTekst && <span className={"savestate " + gem}>{gemTekst}</span>}
        <span className="grow" />
        <div className="dc">
          {kanRette && (editing
            ? <button className="btn pink" onClick={stopRedigering}>✓ Færdig</button>
            : <button className="btn pink" onClick={startRedigering}>{erKladde ? "✎ Rediger kladde" : isTpl ? "✎ Rediger (ny kladde)" : "✎ Lav variant"}</button>)}
          {editing && <button className="btn" onClick={indsaetNavn} title="Indsæt partnernavnet, hvor markøren står">＋ Partnernavn</button>}
          {erKladde && (isTpl ? erAdmin : kanRette) && <button className="btn primary" onClick={async () => { await gemNu(); setModal("publicer"); }}>Publicér</button>}
          {erKladde && kanRette && <button className="btn danger" onClick={() => setModal("kasser")}>Kassér</button>}
          <button className={"btn" + (panel === "history" ? " on" : "")} onClick={() => setPanel(panel === "history" ? null : "history")}>Versioner</button>
          <button className={"btn" + (panel === "compare" ? " on" : "")} onClick={() => { setCmp(null); setPanel(panel === "compare" ? null : "compare"); }}>Sammenlign</button>
          <button className="btn" onClick={() => udskriv()}>Udskriv</button>
          {!erKladde && !editing && <button className="btn" disabled={!!pdfStatus} onClick={lavPdf}
            title="Vektor-PDF i LEA-designet. Felter i dokumentet kan udfyldes direkte i PDF'en.">{pdfStatus ?? "Hent PDF"}</button>}
        </div>
      </div>
      {notice ?? <div className="notice" />}
      <div className="content">
        <div className="stage" ref={stageRef}>
          <div className="framewrap" ref={wrapRef}><iframe ref={frameRef} title="Dokument" srcDoc={html} onLoad={onLoad} /></div>
        </div>
        <div className={"panel" + (panel ? " open" : "")}>
          {panel === "history" && <Historik alle={alle} aktivKey={aktiv?.key} nyesteVersion={nyeste?.version ?? null} viewKey={kilde.key} isTpl={isTpl} erAdmin={erAdmin}
            onVis={setViewKey} onCmp={(a, b) => { setCmp({ a, b }); setPanel("compare"); }} onSlet={(k) => setModal({ slet: k })} onClose={() => setPanel(null)} />}
          {panel === "compare" && <Sammenlign alle={alle} navn={partner ? partner.navn : "[Partnernavn]"}
            a={cmp?.a ?? (alle[1]?.key ?? alle[0].key)} b={cmp?.b ?? kilde.key} onChange={setCmp} onClose={() => setPanel(null)} />}
        </div>
      </div>

      {modal === "publicer" && kladde && <PublicerDialog isTpl={isTpl} dokNavn={dok.navn} partnerNavn={partner?.navn}
        foelgere={isTpl ? data.partnerDoks.filter((x) => x.dok_id === dokId && x.tilstand === "standard" && !x.skabelon_version).length : 0}
        andre={isTpl ? data.partnerDoks.filter((x) => x.dok_id === dokId && (x.tilstand === "variant" || !!x.skabelon_version)).length : 0}
        seneste={isTpl ? nyeste?.version ?? null : alle.find((k) => k.type === "variant" && k.version)?.version ?? null}
        onClose={() => setModal(null)}
        onOk={async (stor, note) => {
          const { data: v, error } = isTpl
            ? await sb.rpc("ds_publicer_skabelon", { p_dok: dokId, p_stor: stor, p_note: note })
            : await sb.rpc("ds_publicer_variant", { p_partner: ws, p_dok: dokId, p_stor: stor, p_note: note });
          if (error) { toast(fejltekst(error)); return; }
          setEditing(false); setModal(null); await reload();
          setViewKey((isTpl ? "s:" : "v:") + v);
          toast(isTpl ? `Skabelon v${v} er publiceret` : `Variant v${v} er publiceret og i brug hos ${partner?.navn}`);
        }} />}
      {modal === "kasser" && kladde && <Confirm title="Kassér kladden?" danger ok="Kassér"
        text="Kladden og alle ændringer i den bliver slettet. Publicerede versioner påvirkes ikke." onClose={() => setModal(null)}
        onOk={async () => {
          const { error } = await sb.from(isTpl ? "ds_skabelon_versioner" : "ds_variant_versioner").delete().eq("id", kladde.id);
          if (error) return toast(fejltekst(error));
          setEditing(false); setModal(null); await reload(); setViewKey(isTpl ? "s:" + (nyeste?.version ?? "") : aktiv?.key ?? ""); toast("Kladden er kasseret");
        }} />}
      {modal === "udskriv" && <Confirm title="Før du udskriver" ok="Udskriv alligevel" onClose={() => setModal(null)} onOk={() => { setModal(null); setTimeout(() => udskriv(true), 50); }}>
        {over.length > 0 && <p>Side {over.join(", ")} er for lang, så noget tekst bliver skåret af.</p>}
        {erKladde && <p>Du udskriver en <b>kladde</b>. Sidefoden viser derfor "kladde" i stedet for et versionsnummer.</p>}
        {isTpl && <p>Du udskriver skabelonen med pladsholderen "Partnernavn". Vælg en partner for at få deres navn og logo med.</p>}
        <p>Husk at slå <b>Baggrundsgrafik</b> til i udskriftsvinduet.</p>
      </Confirm>}
      {modal && typeof modal === "object" && "slet" in modal && <Confirm title={`Slet ${modal.slet.label}?`} danger ok="Slet version"
        text="Versionen fjernes fra listen. Den kan ikke slettes, hvis en partner bruger den." onClose={() => setModal(null)}
        onOk={async () => {
          const { error } = await sb.rpc("ds_slet_version", { p_type: modal.slet.type, p_id: modal.slet.rec.id });
          if (error) return toast(fejltekst(error));
          setModal(null); await reload(); toast("Versionen er slettet");
        }} />}
    </>
  );
}

function Historik({ alle, aktivKey, nyesteVersion, viewKey, isTpl, erAdmin, onVis, onCmp, onSlet, onClose }: {
  alle: Kilde[]; aktivKey?: string; nyesteVersion: string | null; viewKey: string; isTpl: boolean; erAdmin: boolean;
  onVis: (k: string) => void; onCmp: (a: string, b: string) => void; onSlet: (k: Kilde) => void; onClose: () => void;
}) {
  const ref = aktivKey ?? (nyesteVersion ? "s:" + nyesteVersion : alle[0]?.key);
  return (<>
    <div className="ph"><b>Versioner</b><button className="btn ghost small" onClick={onClose}>✕</button></div>
    <div className="pb">
      {alle.map((k) => (
        <div key={k.key} className={"ver" + (k.key === viewKey ? " cur" : "")}>
          <div className="t"><b>{k.label}{k.key === aktivKey && <> <Chip kind="godk">I brug</Chip></>}</b><span className="d">{fmtTid(k.rec.publiceret ?? k.rec.opdateret)}</span></div>
          <div className="d">{k.rec.forfatter_navn}{k.baseretPaa ? ` · bygger på skabelon v${k.baseretPaa}` : ""}</div>
          {k.rec.note && <div className="note">{k.rec.note}</div>}
          <div className="a">
            <button className="btn small" onClick={() => onVis(k.key)}>Vis</button>
            {ref && k.key !== ref && <button className="btn small" onClick={() => onCmp(k.key, ref)}>Sammenlign med {isTpl ? "nyeste" : "aktiv"}</button>}
            {erAdmin && k.version && k.key !== aktivKey && <button className="btn small danger" onClick={() => onSlet(k)}>Slet</button>}
          </div>
        </div>))}
    </div>
  </>);
}

function Sammenlign({ alle, navn, a, b, onChange, onClose }: { alle: Kilde[]; navn: string; a: string; b: string; onChange: (x: { a: string; b: string }) => void; onClose: () => void }) {
  const A = alle.find((k) => k.key === a) ?? alle[0], B = alle.find((k) => k.key === b) ?? alle[0];
  const res = useMemo(() => diffHtml(subst(A.sider, navn), subst(B.sider, navn)), [A, B, navn]);
  const opts = alle.map((k) => <option key={k.key} value={k.key}>{k.label}</option>);
  return (<>
    <div className="ph"><b>Sammenlign</b><button className="btn ghost small" onClick={onClose}>✕</button></div>
    <div className="pb">
      <div className="cmp">
        <label>Fra<select value={A.key} onChange={(e) => onChange({ a: e.target.value, b: B.key })}>{opts}</select></label>
        <label>Til<select value={B.key} onChange={(e) => onChange({ a: A.key, b: e.target.value })}>{opts}</select></label>
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>{res.changes} {res.changes === 1 ? "ændring" : "ændringer"} i teksten. Formatering og layout sammenlignes ikke.</div>
      <div className="diff" dangerouslySetInnerHTML={{ __html: res.html }} />
    </div>
  </>);
}

function PublicerDialog({ isTpl, dokNavn, partnerNavn, seneste, foelgere, andre, onOk, onClose }: {
  isTpl: boolean; dokNavn: string; partnerNavn?: string; seneste: string | null; foelgere: number; andre: number;
  onOk: (stor: boolean, note: string) => Promise<void>; onClose: () => void;
}) {
  const [stor, setStor] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const naeste = (s: boolean) => !seneste ? "1.0" : s ? `${Number(seneste.split(".")[0]) + 1}.0` : `${seneste.split(".")[0]}.${Number(seneste.split(".")[1]) + 1}`;
  return (
    <Modal title={isTpl ? "Publicér skabelon" : `Publicér variant for ${partnerNavn}`} onClose={onClose}>
      <p>{esc(dokNavn)} · {seneste ? `nu v${seneste}` : "første version"}</p>
      {isTpl && <p className="infobox">Slår igennem med det samme hos <b>{foelgere}</b> {foelgere === 1 ? "partner" : "partnere"}, der følger standarden.{andre > 0 && <> {andre} med variant eller låst version får besked om, at standarden er opdateret.</>}</p>}
      {!isTpl && <p className="infobox">Varianten bliver den version, {partnerNavn} bruger. Standarden påvirkes ikke.</p>}
      <label>Type ændring<div className="radios">
        <label><input type="radio" checked={!stor} onChange={() => setStor(false)} /> Mindre rettelse → v{naeste(false)}</label>
        <label><input type="radio" checked={stor} onChange={() => setStor(true)} /> Større ændring → v{naeste(true)}</label></div></label>
      <label>Hvad er ændret?<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Fx: Rabatmandat rettet til egen provision." autoFocus /></label>
      <div className="row">
        <button className="btn" onClick={onClose}>Annullér</button>
        <button className="btn primary" disabled={busy || !note.trim()} onClick={async () => { setBusy(true); try { await onOk(stor, note.trim()); } finally { setBusy(false); } }}>Publicér v{naeste(stor)}</button>
      </div>
    </Modal>
  );
}
