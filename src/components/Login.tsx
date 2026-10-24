import { useState } from "react";
import { sb, fejltekst } from "../lib/supabase";
import { LEA_LOGO } from "../lib/doc";

export default function Login() {
  const [email, setEmail] = useState("");
  const [kode, setKode] = useState("");
  const [mode, setMode] = useState<"link" | "kode">("link");
  const [busy, setBusy] = useState(false);
  const [besked, setBesked] = useState<{ ok: boolean; t: string } | null>(null);

  const ok = /^[^@\s]+@leaforsikring\.dk$/i.test(email.trim());

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) { setBesked({ ok: false, t: "Brug din @leaforsikring.dk-adresse." }); return; }
    setBusy(true); setBesked(null);
    try {
      if (mode === "link") {
        const { error } = await sb.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
        });
        if (error) throw error;
        setBesked({ ok: true, t: "Tjek din indbakke. Klik på linket i mailen fra Supabase i denne browser." });
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: kode });
        if (error) throw error;
      }
    } catch (err) {
      const m = fejltekst(err);
      setBesked({
        ok: false,
        t: /Database error saving new user|Signups not allowed/i.test(m) ? "Din e-mail er ikke inviteret. Bed en admin om adgang."
          : /rate limit|For security purposes/i.test(m) ? "Der er sendt for mange login-mails. Vent lidt, eller log ind med adgangskode."
          : /Invalid login credentials/i.test(m) ? "Forkert e-mail eller adgangskode."
          : m,
      });
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form className="logincard" onSubmit={send}>
        <img src={LEA_LOGO} alt="LEA" className="loginlogo" />
        <h1>Dokumentstudie</h1>
        <p className="hint">Partnermateriale med skabeloner og varianter. Kun for LEA-medarbejdere.</p>
        <div className="seg">
          <button type="button" className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>Login-link på mail</button>
          <button type="button" className={mode === "kode" ? "on" : ""} onClick={() => setMode("kode")}>Adgangskode</button>
        </div>
        <label>E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="navn@leaforsikring.dk" required /></label>
        {mode === "kode" && <label>Adgangskode<input type="password" autoComplete="current-password" value={kode} onChange={(e) => setKode(e.target.value)} required /></label>}
        <button className="btn primary big" disabled={busy}>{busy ? "Vent …" : mode === "link" ? "Send login-link" : "Log ind"}</button>
        {besked && <div className={"msg " + (besked.ok ? "ok" : "bad")}>{besked.t}</div>}
      </form>
    </div>
  );
}
