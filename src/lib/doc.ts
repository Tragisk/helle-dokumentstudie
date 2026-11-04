import { BASE_CSS } from "./baseCss";
import f400 from "@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2?url";
import f500 from "@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2?url";
import f600 from "@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff2?url";
import f700 from "@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff2?url";
import f800 from "@fontsource/dm-sans/files/dm-sans-latin-800-normal.woff2?url";
import type { DokType, Felter, Partner } from "./types";

export const TOK = "{{partner}}";
const abs = (u: string) => new URL(u, document.baseURI).href;
export const LOGO = abs(import.meta.env.BASE_URL + "helle-logo.svg");

export const FONT_CSS = ([[400, f400], [500, f500], [600, f600], [700, f700], [800, f800]] as [number, string][])
  .map(([w, u]) => `@font-face{font-family:'DM Sans';font-style:normal;font-weight:${w};font-display:swap;src:url(${abs(u)}) format('woff2')}`)
  .join("");

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const EXTRA_CSS = `
.partner img{height:8.5mm;max-width:34mm;object-fit:contain}
.logoph{display:inline-flex;align-items:center;justify-content:center;width:24mm;height:8.5mm;border:1px dashed #c24fcb;border-radius:1.5mm;font:600 6.5pt 'DM Sans',sans-serif;color:#c24fcb}
body.tpl .tok{background:rgba(244,175,249,.5);border-radius:1mm;padding:0 .6mm}
body.editing .tok{background:rgba(244,175,249,.45);border-radius:1mm;box-shadow:0 0 0 1px rgba(194,79,203,.45)}
@media screen{html,body{background:transparent!important}.page{margin:0 auto 22px;box-shadow:0 6px 24px rgba(49,17,52,.14);background:#fff}}
body.editing main{outline:2px dashed rgba(194,79,203,.55);outline-offset:3px;cursor:text}
body.editing main:focus{outline-color:#c24fcb}
.overflow-flag{position:absolute;right:8mm;bottom:14mm;background:#b3261e;color:#fff;font:700 9pt 'DM Sans',sans-serif;padding:1.5mm 3mm;border-radius:2mm;z-index:5}
@media print{.overflow-flag{display:none}.tok{background:none!important;box-shadow:none!important;padding:0!important}}
.field.udfyldt{background:transparent!important;border:0!important;border-radius:0!important;display:block!important;height:auto!important;min-height:0!important;width:auto!important;padding:0!important;margin:0!important;font:inherit!important;color:inherit!important;white-space:pre-wrap}
.field.inl.udfyldt{display:inline!important;vertical-align:baseline!important}
.cb.udfyldt{display:flex;align-items:center;justify-content:center;font-weight:800;font-size:8pt;line-height:1}
body.editing .udfyldt{outline:1px dashed rgba(194,79,203,.6)}
`;

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (attrs: string, navn: string) => { const d = new RegExp(`\\b${navn}="([^"]*)"`).exec(attrs); return d ? unesc(d[1]) : ""; };
const tom = (v: unknown) => v === undefined || v === null || v === "";

/** Værdien for et tomt tekstfelt: først det felt, der står i data-dfra (fx Bilag 5's underskriver = aftalens),
 *  derefter standardværdien i data-d (fx Per Reslow Olsen). */
function standardVaerdi(attrs: string, felter: Felter): string {
  const fra = attr(attrs, "data-dfra");
  if (fra && !tom(felter[fra]) && typeof felter[fra] === "string") return String(felter[fra]);
  return attr(attrs, "data-d");
}

/** Sætter udfyldte værdier ind i tomme felter (elementer med data-f). Tomme tekstfelter får standardværdien (data-dfra/data-d).
 *  Elementet beholder data-f, så readPages kan tømme det igen. */
export function anvendFelter(html: string, felter?: Felter): string {
  const fl = felter || {};
  return html.replace(/<(div|span)\b([^>]*?\bdata-f="([^"]+)"[^>]*)><\/\1>/g, (m, tag: string, attrs: string, navn: string) => {
    const kind = /data-k="check"/.test(attrs) ? "check" : "text";
    let v = fl[navn];
    if (tom(v) && kind === "text") v = standardVaerdi(attrs, fl);
    if (v === undefined || v === "" || v === false) return m;
    if (kind === "check" && v !== true) return m;
    const a = /class="/.test(attrs) ? attrs.replace(/class="/, 'class="udfyldt ') : attrs + ' class="udfyldt"';
    return `<${tag}${a}>${kind === "check" ? "✓" : esc(String(v))}</${tag}>`;
  });
}

/** standard = data-d. fra = data-dfra: feltet arver værdien fra dette felt, når det står tomt. */
export interface FeltInfo { navn: string; label: string; kind: "text" | "multi" | "check"; gruppe: string; standard: string; fra: string; }
/** Finder alle felter i siderne i den rækkefølge, de står, med en etiket og den overskrift, de hører under. */
export function feltListe(sider: string[]): FeltInfo[] {
  const d = new DOMParser().parseFromString(`<div>${sider.join("")}</div>`, "text/html");
  const ud: FeltInfo[] = []; const set = new Set<string>(); let gruppe = "";
  d.body.querySelectorAll<HTMLElement>("h1, h2, .bh, [data-f]").forEach((el) => {
    if (!el.dataset.f) { gruppe = [...el.childNodes].map((n) => n.textContent || "").join(" ").replace(/\s+/g, " ").trim(); return; }
    const navn = el.dataset.f; if (set.has(navn)) return; set.add(navn);
    let label = el.dataset.l || "";
    if (!label) { const prev = el.previousElementSibling; if (prev?.classList.contains("flabel")) label = (prev.firstChild?.textContent || prev.textContent || "").trim(); }
    if (!label) label = navn.replace(/_/g, " ");
    const k = el.dataset.k === "check" ? "check" : el.dataset.k === "multi" ? "multi" : "text";
    ud.push({ navn, label, kind: k, gruppe, standard: k === "check" ? "" : el.dataset.d || "", fra: k === "check" ? "" : el.dataset.dfra || "" });
  });
  return ud;
}

export interface BuildOpts { dok: DokType; partner: Partner | null; sider: string[]; versionTekst: string; visVersion: boolean; felter?: Felter; }

/** Bygger et komplet HTML-dokument (alle sider) til visning, redigering og udskrift. */
export function buildHtml({ dok, partner, sider, versionTekst, visVersion, felter }: BuildOpts): string {
  const navn = partner ? (typeof felter?._navn === "string" && felter._navn.trim() ? felter._navn.trim() : partner.navn) : "Partnernavn";
  const tok = `<span class="tok" data-tok="partner" contenteditable="false">${esc(navn)}</span>`;
  const logo = partner ? (partner.logo ? `<img src="${partner.logo}" alt="">` : "") : '<span class="logoph">Partnerlogo</span>';
  const head = `<div class="partner"><div>Partnermateriale til<b>${tok}</b></div>${logo}</div>`;
  const vtxt = visVersion && versionTekst ? ` · ${esc(versionTekst)}` : "";
  const total = sider.length;
  const body = sider.map((pg, i) => `
<section class="page">
  <header class="top"><img class="lea" src="${LOGO}" alt="Helle">${head}</header>
  <main>${anvendFelter(String(pg).split(TOK).join(tok), felter)}</main>
  <footer class="foot">
    <span><b>Helle Forsikringsformidling A/S</b> · Strandgade 12, 1401 København K · CVR 45418669 · FT-nr. 48105</span>
    <span>${esc(dok.sidefod_titel)} · ${esc(dok.label)}${vtxt} · Side ${i + 1} af ${total}</span>
  </footer>
</section>`).join("");
  const titel = `Helle ${dok.navn.replace(" · ", " - ")} - ${partner ? partner.navn : "Skabelon"}${versionTekst ? " " + versionTekst : ""}`;
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${FONT_CSS}${BASE_CSS}${dok.css}${EXTRA_CSS}</style></head><body class="${partner ? "" : "tpl"}">${body}</body></html>`;
}

/** Læser siderne tilbage fra den viste ramme og gør partnernavnet til {{partner}} igen. */
export function readPages(doc: Document): string[] {
  return [...doc.querySelectorAll("main")].map((m) => {
    const c = m.cloneNode(true) as HTMLElement;
    c.querySelectorAll<HTMLElement>("[data-tok]").forEach((s) => s.replaceWith(doc.createTextNode("{{" + s.dataset.tok + "}}")));
    c.querySelectorAll<HTMLElement>("[data-f].udfyldt").forEach((f) => { f.innerHTML = ""; f.classList.remove("udfyldt"); });
    return c.innerHTML;
  });
}

export function cmpVer(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;   // kladde regnes som nyest
  if (b === null) return -1;
  const [a1, a2] = a.split(".").map(Number), [b1, b2] = b.split(".").map(Number);
  return a1 !== b1 ? a1 - b1 : a2 - b2;
}

// ---------- tekstudtræk og sammenligning ----------
export function subst(sider: string[], navn: string) { return sider.map((h) => String(h).split(TOK).join(navn)); }
type Linje = { sep?: boolean; t: string };
export function pagesToLines(sider: string[]): Linje[] {
  const out: Linje[] = [];
  sider.forEach((html, i) => {
    out.push({ sep: true, t: `Side ${i + 1}` });
    const h = String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|h1|h2|h3|li|div|tr|td|th|section|table|ul|ol)>/gi, "$&\n");
    (new DOMParser().parseFromString(`<div>${h}</div>`, "text/html").body.textContent || "")
      .split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).forEach((t) => out.push({ t }));
  });
  return out;
}
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [string, T | null, T | null][] {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: [string, T | null, T | null][] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (eq(a[i], b[j])) { ops.push(["=", a[i], b[j]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(["-", a[i], null]); i++; } else { ops.push(["+", null, b[j]]); j++; } }
  while (i < n) ops.push(["-", a[i++], null]); while (j < m) ops.push(["+", null, b[j++]]);
  return ops;
}
function wordDiff(a: string, b: string) {
  return lcs(a.split(/(\s+)/), b.split(/(\s+)/), (x, y) => x === y)
    .map(([op, x, y]) => op === "=" ? esc(x) : op === "-" ? `<del>${esc(x)}</del>` : `<ins>${esc(y)}</ins>`).join("");
}
export function diffHtml(a: string[], b: string[]): { changes: number; html: string } {
  const A = pagesToLines(a), B = pagesToLines(b);
  const ops = lcs(A, B, (x, y) => x.t === y.t && !!x.sep === !!y.sep);
  const rows: { sep?: string; cls?: string; tag?: string; html?: string }[] = []; let k = 0, changes = 0;
  while (k < ops.length) {
    const [op, x] = ops[k];
    if (op === "=") { if (x!.sep) rows.push({ sep: x!.t }); k++; continue; }
    const dels: Linje[] = [], adds: Linje[] = [];
    while (k < ops.length && ops[k][0] !== "=") { if (ops[k][0] === "-") dels.push(ops[k][1]!); else adds.push(ops[k][2]!); k++; }
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      const d = dels[i], ad = adds[i];
      if ((d && d.sep) || (ad && ad.sep)) { if (ad && ad.sep) rows.push({ sep: ad.t }); continue; }
      changes++;
      if (d && ad) rows.push({ cls: "chg", tag: "ÆNDRET", html: wordDiff(d.t, ad.t) });
      else if (d) rows.push({ cls: "del", tag: "SLETTET", html: esc(d.t) });
      else rows.push({ cls: "add", tag: "TILFØJET", html: esc(ad!.t) });
    }
  }
  if (!changes) return { changes: 0, html: '<div class="empty">Ingen tekstforskelle mellem de to versioner.</div>' };
  let html = "", pend: string | null = null;
  for (const r of rows) {
    if (r.sep) { pend = r.sep; continue; }
    if (pend) { html += `<div class="pg">${esc(pend)}</div>`; pend = null; }
    html += `<div class="ln ${r.cls}"><span class="tag">${r.tag}</span>${r.html}</div>`;
  }
  return { changes, html };
}

/** Skalerer et logo ned, så det fylder lidt i databasen (PNG, maks. 240 px høj). */
export function laesLogo(file: File): Promise<string> {
  return new Promise((res, rej) => {
    if (file.size > 4e6) return rej(new Error("Filen er over 4 MB"));
    const fr = new FileReader();
    fr.onerror = () => rej(fr.error);
    fr.onload = () => {
      const url = String(fr.result);
      if (file.type === "image/svg+xml") return file.size < 250000 ? res(url) : rej(new Error("SVG-filen er for stor"));
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 240 / img.height, 900 / img.width);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/png"));
      };
      img.onerror = () => rej(new Error("Billedet kunne ikke læses"));
      img.src = url;
    };
    fr.readAsDataURL(file);
  });
}

export const fmtDato = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" }) : "–";
export const fmtTid = (iso?: string | null) => iso ? fmtDato(iso) + " kl. " + new Date(iso).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }) : "–";
