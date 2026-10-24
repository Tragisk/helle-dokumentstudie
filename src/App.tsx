import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { sb } from "./lib/supabase";
import { LEA_LOGO, pagesToLines, subst, esc } from "./lib/doc";
import { StoreProvider, useStore, tplKladde, varKladde, pDok, brugBeskrivelse, aktivKilde, tplNyeste } from "./lib/store";
import { ROLLE_TEKST, STATUS_TEKST } from "./lib/types";
import Login from "./components/Login";
import DocView from "./components/DocView";
import { TplOverview, PartnerOverview, NyPartner } from "./components/Overview";
import { Brugere, Log, hentBackup } from "./components/Admin";
import { Chip, Modal, ToastProvider } from "./components/ui";

export type Nav = { ws: string; view: "overview" | "doc" | "brugere" | "log"; dok?: string };

function lesHash(): Nav {
  const [ws, view, dok] = window.location.hash.replace(/^#\/?/, "").split("/");
  if (!ws) return { ws: "tpl", view: "overview" };
  return { ws, view: (view as Nav["view"]) || "overview", dok };
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="loading">Indlæser …</div>;
  return <ToastProvider>{session ? <StoreProvider userId={session.user.id}><Studio email={session.user.email ?? ""} /></StoreProvider> : <Login />}</ToastProvider>;
}

function Studio({ email }: { email: string }) {
  const { data, mig, loading, fejl, kanRette, erAdmin } = useStore();
  const [nav, setNav] = useState<Nav>(lesHash);
  const [nyPartner, setNyPartner] = useState(false);
  const [sog, setSog] = useState(false);
  const go = (n: Nav) => { setNav(n); window.location.hash = `/${n.ws}/${n.view}${n.dok ? "/" + n.dok : ""}`; };
  useEffect(() => { const h = () => setNav(lesHash()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  // Ryd login-koden fra adresselinjen efter login
  useEffect(() => { if (/[?&]code=/.test(window.location.search)) window.history.replaceState(null, "", window.location.pathname + window.location.hash); }, []);

  if (loading) return <div className="loading">Henter dokumenter …</div>;
  if (!mig) return (
    <div className="login"><div className="logincard"><img src={LEA_LOGO} className="loginlogo" alt="LEA" /><h1>Ingen adgang</h1>
      <p className="hint">{email} er ikke aktiv bruger af Dokumentstudie. Bed en admin om adgang.</p>{fejl && <div className="msg bad">{fejl}</div>}
      <button className="btn" onClick={() => sb.auth.signOut()}>Log ud</button></div></div>);

  const ws = nav.ws === "tpl" || data.partnere.some((p) => p.id === nav.ws) ? nav.ws : "tpl";
  const partner = ws === "tpl" ? null : data.partnere.find((p) => p.id === ws)!;
  const docIds = ws === "tpl" ? data.dokTyper.map((d) => d.id) : data.dokTyper.filter((d) => pDok(data, ws, d.id)).map((d) => d.id);
  const view = nav.view === "doc" && (!nav.dok || !docIds.includes(nav.dok)) ? "overview" : (nav.view === "brugere" || nav.view === "log") && !erAdmin && nav.view === "brugere" ? "overview" : nav.view;
  let sidste: string | null = null; try { sidste = localStorage.getItem("ds-sidste-backup"); } catch { /* ok */ }
  const backupGammel = !sidste || Date.now() - new Date(sidste).getTime() > 30 * 864e5;

  return (
    <div className={"app" + (view !== "doc" ? " ov" : "")}>
      <aside className="side">
        <div className="brand"><img src={LEA_LOGO} alt="LEA" /><div><b>Dokumentstudie</b><span>{mig.navn || mig.email} · {ROLLE_TEKST[mig.rolle]}</span></div></div>
        <div className="ws">
          <label htmlFor="wsSelect">Arbejdsområde</label>
          <div className="row">
            <select id="wsSelect" value={ws} onChange={(e) => go({ ws: e.target.value, view: "overview" })}>
              <option value="tpl">LEA skabeloner</option>
              <optgroup label="Partnere">{data.partnere.map((p) => <option key={p.id} value={p.id}>{p.navn}</option>)}</optgroup>
            </select>
            {kanRette && <button className="btn small" onClick={() => setNyPartner(true)} title="Opret ny partner">+ Partner</button>}
          </div>
          <div className="wslogo">{partner ? (partner.logo ? <><img src={partner.logo} alt="" /><span>{partner.navn}</span></> : <span>Intet logo endnu</span>) : <span>Master for alle partnere</span>}</div>
          <button className="btn small" style={{ width: "100%", marginTop: 8 }} onClick={() => setSog(true)}>⌕ Søg i dokumenterne</button>
        </div>
        <nav className="doclist">
          <button className={"docitem ovitem" + (view === "overview" ? " active" : "")} onClick={() => go({ ws, view: "overview" })}>
            <div className="n">Oversigt</div><div className="m">{partner ? "Partnerinfo og onboarding" : `${data.partnere.length} partnere`}</div></button>
          <div className="sep" />
          {docIds.map((id) => {
            const d = data.dokTyper.find((x) => x.id === id)!;
            let chips: JSX.Element;
            if (!partner) {
              chips = <><span>v{tplNyeste(data, id)?.version ?? "–"}</span>{tplKladde(data, id) && <Chip kind="draft">Kladde</Chip>}</>;
            } else {
              const pd = pDok(data, ws, id)!, b = brugBeskrivelse(data, ws, id), ak = aktivKilde(data, ws, id);
              chips = <><span>{ak?.type === "variant" ? `Variant v${ak.version}` : `v${ak?.version ?? "–"}`}</span><Chip kind={pd.status}>{STATUS_TEKST[pd.status]}</Chip>
                {b.bagud && <Chip kind="old">Ny standard</Chip>}{varKladde(data, ws, id) && <Chip kind="draft">Kladde</Chip>}</>;
            }
            return <button key={id} className={"docitem" + (view === "doc" && nav.dok === id ? " active" : "")} onClick={() => go({ ws, view: "doc", dok: id })}>
              <div className="n">{d.navn}</div><div className="m">{chips}</div></button>;
          })}
          <div className="sep" />
          {erAdmin && <button className={"docitem" + (view === "brugere" ? " active" : "")} onClick={() => go({ ws, view: "brugere" })}><div className="n">Brugere og adgang</div></button>}
          <button className={"docitem" + (view === "log" ? " active" : "")} onClick={() => go({ ws, view: "log" })}><div className="n">Log</div></button>
        </nav>
        <div className="sidefoot">
          <button className="btn" onClick={() => hentBackup(data)}>⬇ Hent backup</button>
          <div className={"hint" + (backupGammel ? " warntext" : "")}>{sidste ? `Seneste backup hentet ${new Date(sidste).toLocaleDateString("da-DK")}.` : "Du har ikke hentet en backup fra denne browser endnu."}{backupGammel && " Hent en backup jævnligt."}</div>
          <button className="btn ghost small" onClick={() => sb.auth.signOut()}>Log ud</button>
        </div>
      </aside>
      <div className="mainwrap">
        {view === "doc" && nav.dok ? <DocView key={ws + nav.dok} ws={ws} dokId={nav.dok} />
          : <div className="scroll">
            {view === "overview" && (partner ? <PartnerOverview key={ws} pid={ws} go={go} /> : <TplOverview go={go} onNyPartner={() => setNyPartner(true)} />)}
            {view === "brugere" && erAdmin && <Brugere />}
            {view === "log" && <Log />}
          </div>}
      </div>
      {nyPartner && <NyPartner onClose={() => setNyPartner(false)} go={go} />}
      {sog && <Sog ws={ws} onClose={() => setSog(false)} onOpen={(id) => { setSog(false); go({ ws, view: "doc", dok: id }); }} />}
    </div>
  );
}

function Sog({ ws, onClose, onOpen }: { ws: string; onClose: () => void; onOpen: (dok: string) => void }) {
  const { data } = useStore();
  const [q, setQ] = useState("");
  const partner = ws === "tpl" ? null : data.partnere.find((p) => p.id === ws) ?? null;
  const hits = useMemo(() => {
    if (q.trim().length < 2) return [];
    const needle = q.trim().toLowerCase();
    const out: { id: string; navn: string; kilde: string; linjer: string[] }[] = [];
    for (const d of data.dokTyper) {
      let sider: string[] | null = null, kilde = "";
      if (!partner) { const k = tplKladde(data, d.id) ?? tplNyeste(data, d.id); if (k) { sider = k.sider; kilde = k.version ? "v" + k.version : "kladde"; } }
      else { const ak = aktivKilde(data, ws, d.id); if (ak) { sider = ak.sider; kilde = ak.label; } }
      if (!sider) continue;
      const linjer = pagesToLines(subst(sider, partner ? partner.navn : "[Partnernavn]")).filter((l) => !l.sep && l.t.toLowerCase().includes(needle)).map((l) => l.t);
      if (linjer.length) out.push({ id: d.id, navn: d.navn, kilde, linjer });
    }
    return out;
  }, [q, data, ws, partner]);
  const mark = (t: string) => esc(t).replace(new RegExp(esc(q.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`);
  return (
    <Modal title={`Søg i ${partner ? partner.navn : "skabelonerne"}`} onClose={onClose} wide>
      <label>Søg efter<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fx 9 % eller selvrisiko" autoFocus /></label>
      <div className="hits">
        {q.trim().length >= 2 && !hits.length && <div className="empty">Ingen forekomster.</div>}
        {hits.map((h) => <div key={h.id} className="hit" onClick={() => onOpen(h.id)}><b>{h.navn}</b> <Chip>{h.linjer.length}</Chip> <span className="hint">{h.kilde}</span>
          {h.linjer.slice(0, 4).map((l, i) => <div key={i} className="s" dangerouslySetInnerHTML={{ __html: mark(l) }} />)}
          {h.linjer.length > 4 && <div className="s">… og {h.linjer.length - 4} linjer mere</div>}</div>)}
      </div>
      <div className="hint">Søger i {partner ? "de versioner, partneren bruger" : "kladder og nyeste publicerede skabeloner"}.</div>
    </Modal>
  );
}
