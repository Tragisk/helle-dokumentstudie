import { useEffect, useState } from "react";
import { sb, fejltekst, SUPABASE_URL } from "../lib/supabase";
import { fmtTid } from "../lib/doc";
import { useStore } from "../lib/store";
import { ROLLE_TEKST, type Bruger, type LogLinje, type Rolle } from "../lib/types";
import { Chip, Confirm, Modal, useToast } from "./ui";

export function Brugere() {
  const { data, mig, reload, log } = useStore();
  const toast = useToast();
  const [ny, setNy] = useState(false);
  const [kode, setKode] = useState<Bruger | null>(null);
  const [fjern, setFjern] = useState<Bruger | null>(null);

  async function opdater(b: Bruger, f: Partial<Bruger>) {
    const { error } = await sb.from("ds_brugere").update(f).eq("email", b.email);
    if (error) return toast(fejltekst(error));
    await log("Bruger ændret", { detaljer: { email: b.email, ...f } }); await reload();
  }
  return (
    <div className="ovwrap">
      <div className="ovhead"><h2>Brugere og adgang</h2><span className="grow" /><button className="btn primary" onClick={() => setNy(true)}>+ Tilføj bruger</button></div>
      <section className="card wide">
        <table className="dt"><thead><tr><th>Navn</th><th>E-mail</th><th>Rolle</th><th>Login</th><th>Aktiv</th><th /></tr></thead><tbody>
          {data.brugere.map((b) => (
            <tr key={b.email}>
              <td className="nm">{b.navn || "–"}</td><td>{b.email}</td>
              <td><select value={b.rolle} disabled={b.email === mig?.email} onChange={(e) => opdater(b, { rolle: e.target.value as Rolle })}>
                {(["admin", "rediger", "laes"] as Rolle[]).map((r) => <option key={r} value={r}>{ROLLE_TEKST[r]}</option>)}</select></td>
              <td>{b.bruger_id ? <Chip kind="godk">Har logget ind</Chip> : <Chip>Ikke endnu</Chip>}</td>
              <td><input type="checkbox" checked={b.aktiv} disabled={b.email === mig?.email} onChange={(e) => opdater(b, { aktiv: e.target.checked })} /></td>
              <td className="actions"><button className="btn small" onClick={() => setKode(b)}>Sæt adgangskode</button>
                {b.email !== mig?.email && <button className="btn small danger" onClick={() => setFjern(b)}>Fjern</button>}</td>
            </tr>))}
        </tbody></table>
        <div className="hint" style={{ marginTop: 12 }}>
          <b>Admin</b> kan alt, inklusive at publicere skabeloner og styre brugere. <b>Rediger</b> kan lave kladder, varianter og partnere. <b>Læs og download</b> kan se og udskrive.
          Kun @leaforsikring.dk-adresser på listen kan logge ind. Login-links på mail virker kun for adresser, der er med i Supabase-teamet; andre logger ind med den adgangskode, du sætter her.
        </div>
      </section>
      {ny && <NyBruger onClose={() => setNy(false)} onDone={async () => { setNy(false); await reload(); }} />}
      {kode && <SaetKode bruger={kode} onClose={() => setKode(null)} onDone={async () => { setKode(null); await reload(); }} />}
      {fjern && <Confirm title={`Fjern ${fjern.email}?`} danger ok="Fjern adgang" onClose={() => setFjern(null)}
        text="Personen mister adgang med det samme. Deres navn bliver stående i loggen."
        onOk={async () => { const { error } = await sb.from("ds_brugere").delete().eq("email", fjern.email); if (error) return toast(fejltekst(error));
          await log("Bruger fjernet", { detaljer: { email: fjern.email } }); setFjern(null); await reload(); toast("Adgangen er fjernet"); }} />}
    </div>
  );
}

function NyBruger({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { log } = useStore(); const toast = useToast();
  const [email, setEmail] = useState(""), [navn, setNavn] = useState(""), [rolle, setRolle] = useState<Rolle>("rediger");
  return (
    <Modal title="Tilføj bruger" onClose={onClose}>
      <label>E-mail<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="navn@leaforsikring.dk" autoFocus /></label>
      <label>Navn<input value={navn} onChange={(e) => setNavn(e.target.value)} /></label>
      <label>Rolle<select value={rolle} onChange={(e) => setRolle(e.target.value as Rolle)}>{(["admin", "rediger", "laes"] as Rolle[]).map((r) => <option key={r} value={r}>{ROLLE_TEKST[r]}</option>)}</select></label>
      <div className="row"><button className="btn" onClick={onClose}>Annullér</button><button className="btn primary" onClick={async () => {
        const e = email.trim().toLowerCase();
        if (!/^[^@\s]+@leaforsikring\.dk$/.test(e)) return toast("Kun @leaforsikring.dk-adresser");
        const { error } = await sb.from("ds_brugere").insert({ email: e, navn: navn.trim(), rolle });
        if (error) return toast(fejltekst(error));
        await log("Bruger tilføjet", { detaljer: { email: e, rolle } }); toast("Brugeren er tilføjet. Sæt en adgangskode, så de kan logge ind."); onDone();
      }}>Tilføj</button></div>
    </Modal>
  );
}

function SaetKode({ bruger, onClose, onDone }: { bruger: Bruger; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kode, setKode] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 55]).join(""));
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Adgangskode til ${bruger.navn || bruger.email}`} onClose={onClose}>
      <p>Giv koden til personen på en sikker måde, fx mundtligt eller via Teams. De kan bruge den sammen med deres e-mail på login-siden.</p>
      <label>Adgangskode<input value={kode} onChange={(e) => setKode(e.target.value)} /></label>
      <div className="row"><button className="btn" onClick={onClose}>Annullér</button><button className="btn primary" disabled={busy || kode.length < 10} onClick={async () => {
        setBusy(true);
        try {
          const { data: s } = await sb.auth.getSession();
          const r = await fetch(`${SUPABASE_URL}/functions/v1/ds-admin-brugere`, { method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token}` },
            body: JSON.stringify({ action: "saet_kode", email: bruger.email, kode }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.fejl || "Kunne ikke sætte koden");
          await navigator.clipboard?.writeText(kode).catch(() => {});
          toast("Adgangskoden er sat og kopieret"); onDone();
        } catch (e) { toast(fejltekst(e)); } finally { setBusy(false); }
      }}>Sæt kode</button></div>
      <div className="hint">Mindst 10 tegn.</div>
    </Modal>
  );
}

export function Log() {
  const { data } = useStore();
  const [linjer, setLinjer] = useState<LogLinje[] | null>(null);
  useEffect(() => { sb.from("ds_log").select("*").order("id", { ascending: false }).limit(300).then(({ data }) => setLinjer(data ?? [])); }, []);
  const pnavn = (id: string | null) => id ? data.partnere.find((p) => p.id === id)?.navn ?? "(slettet partner)" : "";
  const dnavn = (id: string | null) => id ? data.dokTyper.find((d) => d.id === id)?.navn ?? id : "";
  return (
    <div className="ovwrap">
      <div className="ovhead"><h2>Log</h2></div>
      <section className="card wide">
        {!linjer ? <div className="empty">Henter …</div> : <table className="dt"><thead><tr><th>Tid</th><th>Hvem</th><th>Hvad</th><th>Partner</th><th>Dokument</th><th>Detaljer</th></tr></thead><tbody>
          {linjer.map((l) => <tr key={l.id}><td>{fmtTid(l.tid)}</td><td>{l.bruger_navn}</td><td className="nm">{l.handling}</td><td>{pnavn(l.partner_id)}</td><td>{dnavn(l.dok_id)}</td>
            <td className="hint">{Object.entries(l.detaljer || {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}</td></tr>)}
        </tbody></table>}
      </section>
    </div>
  );
}

/** Henter alt, brugeren kan se, som én JSON-fil. */
export async function hentBackup(data: ReturnType<typeof useStore>["data"]) {
  const { data: logLinjer } = await sb.from("ds_log").select("*").order("id", { ascending: false }).limit(2000);
  const blob = new Blob([JSON.stringify({ app: "lea-dokumentstudie", schema: 3, tid: new Date().toISOString(), ...data, log: logLinjer ?? [] }, null, 1)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `Dokumentstudie backup ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  try { localStorage.setItem("ds-sidste-backup", new Date().toISOString()); } catch { /* ok */ }
}
