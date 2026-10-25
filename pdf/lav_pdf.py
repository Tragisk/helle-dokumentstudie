"""LEA Dokumentstudie – PDF-motor (kører i GitHub Actions).

Henter ét PDF-job fra Supabase, bygger dokumentet i LEA-designet, gemmer det som vektor-PDF med Chromium
og lægger udfyldelige felter på (felter er markeret med data-f i dokumentets HTML). PDF'en uploades til den
private lagerplads 'ds-pdf'. Scriptet skriver aldrig dokumentindhold i loggen, da repoet er offentligt.
"""
import asyncio, json, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pymupdf
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
JOB = os.environ.get("JOB_ID", "")
TOK = "{{partner}}"
INK = (0x31 / 255, 0x11 / 255, 0x34 / 255)


def api(method: str, path: str, body=None, headers=None, raw: bytes | None = None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    if headers: h.update(headers)
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    if data is not None and "Content-Type" not in h: h["Content-Type"] = "application/json"
    req = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        txt = r.read()
        return json.loads(txt) if txt and r.headers.get("Content-Type", "").startswith("application/json") else None


def one(table: str, **flt):
    q = "&".join(f"{k}=eq.{urllib.parse.quote(str(v))}" for k, v in flt.items())
    rows = api("GET", f"/rest/v1/{table}?{q}&select=*")
    if not rows: raise RuntimeError(f"Fandt ikke række i {table}")
    return rows[0]


def set_job(**fields):
    api("PATCH", f"/rest/v1/ds_pdf_jobs?id=eq.{JOB}", fields, {"Prefer": "return=minimal"})


def esc(s) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def base_css() -> str:
    src = (ROOT / "src/lib/baseCss.ts").read_text(encoding="utf-8")
    return json.loads(re.search(r"BASE_CSS = (\".*\");", src, re.S).group(1))


def font_css() -> str:
    d = ROOT / "node_modules/@fontsource/dm-sans/files"
    return "".join(
        f"@font-face{{font-family:'DM Sans';font-style:normal;font-weight:{w};src:url({(d / f'dm-sans-latin-{w}-normal.woff2').as_uri()}) format('woff2')}}"
        for w in (400, 500, 600, 700, 800))


def build_html(dok, partner, sider, version) -> str:
    navn = partner["navn"] if partner else "Partnernavn"
    tok = f'<span class="tok">{esc(navn)}</span>'
    logo = (f'<img src="{partner["logo"]}" alt="">' if partner and partner.get("logo") else "") if partner else ""
    head = f'<div class="partner"><div>Partnermateriale til<b>{tok}</b></div>{logo}</div>'
    lea = (ROOT / "public/lea-logo.png").as_uri()
    total = len(sider)
    pages = "".join(f"""
<section class="page"><header class="top"><img class="lea" src="{lea}" alt="LEA">{head}</header>
<main>{str(pg).replace(TOK, tok)}</main>
<footer class="foot"><span><b>LEA Forsikringsformidling A/S</b> · Strandgade 12, 1401 København K · CVR 45418669 · FT-nr. 48105</span>
<span>{esc(dok['sidefod_titel'])} · {esc(dok['label'])} · v{esc(version)} · Side {i + 1} af {total}</span></footer></section>""" for i, pg in enumerate(sider))
    extra = ".partner img{height:8.5mm;max-width:34mm;object-fit:contain}"
    return f"<!doctype html><html lang='da'><head><meta charset='utf-8'><style>{font_css()}{base_css()}{dok['css']}{extra}</style></head><body>{pages}</body></html>"


async def render(html: str, out: Path) -> int:
    tmp_html = out.with_suffix(".html"); tmp_pdf = out.with_suffix(".flat.pdf")
    tmp_html.write_text(html, encoding="utf-8")
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        await pg.goto(tmp_html.as_uri()); await pg.evaluate("document.fonts.ready"); await pg.wait_for_timeout(400)
        fields = await pg.evaluate("""() => {
          const pages=[...document.querySelectorAll('.page')];
          return [...document.querySelectorAll('[data-f]')].map(el=>{
            const pg=el.closest('.page'); const pr=pg.getBoundingClientRect(); const r=el.getBoundingClientRect();
            return {name:el.dataset.f, kind:el.dataset.k||'text', page:pages.indexOf(pg), x:r.left-pr.left, y:r.top-pr.top, w:r.width, h:r.height};
          });}""")
        await pg.pdf(path=str(tmp_pdf), format="A4", print_background=True, prefer_css_page_size=True)
        await b.close()
    doc = pymupdf.open(tmp_pdf); k = 72 / 96; brugt = set()
    for f in fields:
        if f["page"] < 0 or f["page"] >= len(doc): continue
        name = f["name"]; i = 2
        while name in brugt: name = f"{f['name']}_{i}"; i += 1
        brugt.add(name)
        r = pymupdf.Rect(f["x"] * k, f["y"] * k, (f["x"] + f["w"]) * k, (f["y"] + f["h"]) * k)
        w = pymupdf.Widget(); w.field_name = name; w.border_width = 0; w.border_color = None; w.fill_color = None
        w.text_color = INK; w.text_font = "Helv"
        if f["kind"] == "check":
            w.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX; w.rect = r; w.field_value = False
        else:
            w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
            w.rect = pymupdf.Rect(r.x0 + 3, r.y0 + 1, r.x1 - 3, r.y1 - 1)
            w.text_fontsize = 9 if f["kind"] == "multi" else 9.5
            if f["kind"] == "multi": w.field_flags |= pymupdf.PDF_TX_FIELD_IS_MULTILINE
        doc[f["page"]].add_widget(w)
    doc.save(out, garbage=3, deflate=True)
    return len(fields)


def main():
    if not re.fullmatch(r"[0-9a-f-]{36}", JOB): sys.exit("Ugyldigt job-id")
    try:
        job = one("ds_pdf_jobs", id=JOB)
        if job["status"] not in ("venter", "fejl"): print("Jobbet er allerede behandlet"); return
        set_job(status="koerer")
        dok = one("ds_dokumenttyper", id=job["dok_id"])
        if job["kilde"] == "skabelon":
            ver = one("ds_skabelon_versioner", dok_id=job["dok_id"], status="publiceret", version=job["version"], slettet="false")
        else:
            ver = one("ds_variant_versioner", partner_id=job["partner_id"], dok_id=job["dok_id"], status="publiceret", version=job["version"], slettet="false")
        partner = one("ds_partnere", id=job["partner_id"]) if job.get("partner_id") else None
        out = Path("/tmp") / f"{JOB}.pdf"
        n = asyncio.run(render(build_html(dok, partner, ver["sider"], job["version"]), out))
        sti = f"{JOB}.pdf"
        api("POST", f"/storage/v1/object/ds-pdf/{sti}", raw=out.read_bytes(),
            headers={"Content-Type": "application/pdf", "x-upsert": "true"})
        set_job(status="faerdig", sti=sti, fejl=None, faerdig=datetime.now(timezone.utc).isoformat())
        print(f"PDF færdig ({len(ver['sider'])} sider, {n} felter)")
    except Exception as e:  # skriv kun fejltype i loggen, ikke indhold
        print("Fejl:", type(e).__name__)
        try: set_job(status="fejl", fejl=f"{type(e).__name__}: {str(e)[:200]}")
        except Exception: pass
        sys.exit(1)


if __name__ == "__main__":
    main()
