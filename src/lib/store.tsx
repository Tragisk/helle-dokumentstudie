import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { sb, fejltekst } from "./supabase";
import { cmpVer } from "./doc";
import type { Bruger, Data, Kilde, Partner, PartnerDok, SkabelonVersion, VariantVersion } from "./types";

const TOM: Data = { dokTyper: [], skabeloner: [], partnere: [], partnerDoks: [], varianter: [], brugere: [] };

interface Store {
  data: Data;
  mig: Bruger | null;
  loading: boolean;
  fejl: string | null;
  reload: () => Promise<void>;
  patch: (fn: (d: Data) => Data) => void;
  kanRette: boolean;
  erAdmin: boolean;
  log: (handling: string, extra?: { partner_id?: string | null; dok_id?: string | null; detaljer?: Record<string, unknown> }) => Promise<void>;
}
const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export function StoreProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [data, setData] = useState<Data>(TOM);
  const [loading, setLoading] = useState(true);
  const [fejl, setFejl] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [d, s, p, pd, v, b] = await Promise.all([
        sb.from("ds_dokumenttyper").select("*").eq("arkiveret", false).order("sortering"),
        sb.from("ds_skabelon_versioner").select("*").eq("slettet", false),
        sb.from("ds_partnere").select("*").eq("arkiveret", false).order("navn"),
        sb.from("ds_partner_dokumenter").select("*"),
        sb.from("ds_variant_versioner").select("*").eq("slettet", false),
        sb.from("ds_brugere").select("*").order("navn"),
      ]);
      const err = [d, s, p, pd, v, b].find((r) => r.error)?.error;
      if (err) throw err;
      setData({ dokTyper: d.data!, skabeloner: s.data!, partnere: p.data!, partnerDoks: pd.data!, varianter: v.data!, brugere: b.data! });
      setFejl(null);
    } catch (e) { setFejl(fejltekst(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const mig = useMemo(() => data.brugere.find((b) => b.bruger_id === userId && b.aktiv) ?? null, [data.brugere, userId]);
  const log = useCallback(async (handling: string, extra: { partner_id?: string | null; dok_id?: string | null; detaljer?: Record<string, unknown> } = {}) => {
    await sb.from("ds_log").insert({ handling, bruger: userId, bruger_navn: mig?.navn || mig?.email || "", partner_id: extra.partner_id ?? null, dok_id: extra.dok_id ?? null, detaljer: extra.detaljer ?? {} });
  }, [userId, mig]);

  const value: Store = {
    data, mig, loading, fejl, reload, patch: (fn) => setData((d) => fn(d)),
    kanRette: mig?.rolle === "admin" || mig?.rolle === "rediger", erAdmin: mig?.rolle === "admin", log,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------- opslag ----------
export const tplPublicerede = (d: Data, dok: string) =>
  d.skabeloner.filter((s) => s.dok_id === dok && s.status === "publiceret").sort((a, b) => cmpVer(b.version, a.version));
export const tplKladde = (d: Data, dok: string) => d.skabeloner.find((s) => s.dok_id === dok && s.status === "kladde") ?? null;
export const tplNyeste = (d: Data, dok: string): SkabelonVersion | null => tplPublicerede(d, dok)[0] ?? null;
export const varPublicerede = (d: Data, pid: string, dok: string) =>
  d.varianter.filter((v) => v.partner_id === pid && v.dok_id === dok && v.status === "publiceret").sort((a, b) => cmpVer(b.version, a.version));
export const varKladde = (d: Data, pid: string, dok: string) => d.varianter.find((v) => v.partner_id === pid && v.dok_id === dok && v.status === "kladde") ?? null;
export const pDok = (d: Data, pid: string, dok: string): PartnerDok | null => d.partnerDoks.find((x) => x.partner_id === pid && x.dok_id === dok) ?? null;
export const partnerAf = (d: Data, pid: string): Partner | null => d.partnere.find((p) => p.id === pid) ?? null;

const tplKilde = (s: SkabelonVersion, nyeste: string | null): Kilde => ({
  key: s.version ? "s:" + s.version : "s:kladde", type: "skabelon", version: s.version, sider: s.sider, rec: s,
  label: s.version ? `Skabelon v${s.version}${s.version === nyeste ? " (nyeste)" : ""}` : "Skabelon – kladde",
});
const varKilde = (v: VariantVersion): Kilde => ({
  key: v.version ? "v:" + v.version : "v:kladde", type: "variant", version: v.version, sider: v.sider, rec: v, baseretPaa: v.baseret_paa,
  label: v.version ? `Variant v${v.version}` : "Variant – kladde",
});

/** Alle versioner, der kan vises for et dokument i et arbejdsområde. */
export function kilder(d: Data, ws: string, dok: string): Kilde[] {
  const nyeste = tplNyeste(d, dok)?.version ?? null;
  const out: Kilde[] = [];
  if (ws === "tpl") {
    const k = tplKladde(d, dok); if (k) out.push(tplKilde(k, nyeste));
    tplPublicerede(d, dok).forEach((s) => out.push(tplKilde(s, nyeste)));
  } else {
    const k = varKladde(d, ws, dok); if (k) out.push(varKilde(k));
    varPublicerede(d, ws, dok).forEach((v) => out.push(varKilde(v)));
    tplPublicerede(d, dok).forEach((s) => out.push(tplKilde(s, nyeste)));
  }
  return out;
}

/** Den version, en partner aktuelt bruger af et dokument. */
export function aktivKilde(d: Data, pid: string, dok: string): Kilde | null {
  const pd = pDok(d, pid, dok); if (!pd) return null;
  const nyeste = tplNyeste(d, dok)?.version ?? null;
  if (pd.tilstand === "variant" && pd.variant_version) {
    const v = varPublicerede(d, pid, dok).find((x) => x.version === pd.variant_version);
    if (v) return varKilde(v);
  }
  const s = pd.skabelon_version ? tplPublicerede(d, dok).find((x) => x.version === pd.skabelon_version) : tplNyeste(d, dok);
  return s ? tplKilde(s, nyeste) : (tplNyeste(d, dok) ? tplKilde(tplNyeste(d, dok)!, nyeste) : null);
}

/** Kort beskrivelse af hvad en partner bruger, og om den er bagud. */
export function brugBeskrivelse(d: Data, pid: string, dok: string): { tekst: string; bagud: boolean } {
  const pd = pDok(d, pid, dok); const ny = tplNyeste(d, dok)?.version;
  if (!pd) return { tekst: "Ikke med", bagud: false };
  if (pd.tilstand === "variant" && pd.variant_version) {
    const v = varPublicerede(d, pid, dok).find((x) => x.version === pd.variant_version);
    const bagud = !!v && !!ny && v.baseret_paa !== ny;
    return { tekst: `Variant v${pd.variant_version}` + (v ? ` (bygger på v${v.baseret_paa})` : ""), bagud };
  }
  if (pd.skabelon_version) return { tekst: `Standard v${pd.skabelon_version} (låst)`, bagud: pd.skabelon_version !== ny };
  return { tekst: `Standard, følger nyeste (v${ny ?? "–"})`, bagud: false };
}
