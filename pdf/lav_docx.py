"""Helle Dokumentstudie – Word-udgave (.docx) af et dokument.

Bygger et redigerbart Word-dokument ud fra samme HTML som PDF'en (efter at udfyldte felter er sat ind).
Layoutet er tilnærmet: overskrifter, afsnit, punkter, tabeller og bokse genskabes i Word-format, så
teksten kan redigeres. Tomme felter bliver til streger (____), som kan skrives på. Skriver aldrig
dokumentindhold i loggen.
"""
import re
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_COLOR_INDEX, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

FONT = "DM Sans"
INK = RGBColor(0x31, 0x11, 0x34)
MUTED = RGBColor(0x6E, 0x59, 0x70)
PINK = RGBColor(0xC2, 0x4F, 0xCB)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
CARD = "F2E9F9"
LINE = "E2D3EA"
CONTENT_W = 182  # mm mellem margener

INLINE = {"span", "b", "strong", "i", "em", "u", "a", "small", "sup", "sub", "br", "code", "mark", "label"}
BOX = {"tile": CARD, "hero": CARD, "stat": CARD, "prev": "F1EEF2", "hlb": "FFF6C4", "bar": "311134", "box": None}
GRID_COLS = {"parts": 2, "sigs": 2, "grid2": 2, "grid3": 3, "grid4": 4, "cols2": 2, "cols": 2}


# ---------- små XML-hjælpere ----------
def _shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def _cell_borders(cell, **sides):
    """sides: top/bottom/left/right = (størrelse i 1/8 pt, farve)."""
    tcPr = cell._tc.get_or_add_tcPr()
    b = tcPr.find(qn("w:tcBorders"))
    if b is None:
        b = OxmlElement("w:tcBorders"); tcPr.append(b)
    for side, (sz, color) in sides.items():
        e = OxmlElement(f"w:{side}"); e.set(qn("w:val"), "single"); e.set(qn("w:sz"), str(sz)); e.set(qn("w:space"), "0"); e.set(qn("w:color"), color)
        b.append(e)


def _cell_margins(table, top=2.5, bottom=2.5, left=3.5, right=3.5):
    tblPr = table._tbl.tblPr
    m = OxmlElement("w:tblCellMar")
    for side, v in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        e = OxmlElement(f"w:{side}"); e.set(qn("w:w"), str(int(v * 56.7))); e.set(qn("w:type"), "dxa"); m.append(e)
    tblPr.append(m)


def _no_table_borders(table):
    tblPr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{side}"); e.set(qn("w:val"), "nil"); b.append(e)
    tblPr.append(b)


def _par_bottom_border(par, sz=10, color="311134"):
    pPr = par._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr"); e = OxmlElement("w:bottom")
    e.set(qn("w:val"), "single"); e.set(qn("w:sz"), str(sz)); e.set(qn("w:space"), "1"); e.set(qn("w:color"), color)
    bdr.append(e); pPr.append(bdr)


def _field(par, instr):
    f = OxmlElement("w:fldSimple"); f.set(qn("w:instr"), instr)
    r = OxmlElement("w:r"); rpr = OxmlElement("w:rPr")
    for tag, val in (("w:color", "6E5970"), ("w:sz", "14"), ("w:szCs", "14")):
        e = OxmlElement(tag); e.set(qn("w:val"), val); rpr.append(e)
    r.append(rpr); t = OxmlElement("w:t"); t.text = "1"; r.append(t); f.append(r)
    par._p.append(f)


def _classes(el):
    return set(el.get("class") or []) if isinstance(el, Tag) else set()


def _is_block(el):
    if not isinstance(el, Tag):
        return False
    c = _classes(el)
    if "field" in c:
        return "inl" not in c
    return el.name not in INLINE


class Builder:
    def __init__(self, doc: Document):
        self.doc = doc

    # ----- afsnit -----
    def par(self, cont, style=None, indent=0.0, hang=0.0, after=3.0, before=0.0, align=None):
        if hasattr(cont, "_fresh") and cont._fresh:
            p = cont.paragraphs[0]; cont._fresh = False
        else:
            p = cont.add_paragraph()
        pf = p.paragraph_format
        pf.space_after = Pt(after); pf.space_before = Pt(before)
        if indent or hang:
            pf.left_indent = Mm(indent + hang)
            if hang:
                pf.first_line_indent = Mm(-hang)
        if align:
            p.alignment = align
        p._lea = style or {}
        return p

    def run(self, p, text, fmt):
        if not text:
            return
        if not p.text or p.text.endswith(("\t", "\n", " ")):
            text = text.lstrip()
        if not text:
            return
        r = p.add_run(text)
        st = {**getattr(p, "_lea", {}), **fmt}
        f = r.font
        if st.get("size"): f.size = Pt(st["size"])
        if st.get("bold"): f.bold = True
        if st.get("italic"): f.italic = True
        if st.get("caps"): f.all_caps = True
        if st.get("color") is not None: f.color.rgb = st["color"]
        if st.get("hl"): f.highlight_color = st["hl"]
        if st.get("underline"): f.underline = True
        return r

    # ----- inline-indhold -----
    def inline(self, el, p, fmt):
        for ch in (el.children if isinstance(el, (Tag, _Wrap)) else [el]):
            if isinstance(ch, NavigableString):
                if type(ch).__name__ in ("Comment", "Doctype"):
                    continue
                self.run(p, re.sub(r"\s+", " ", str(ch)), fmt)
                continue
            if not isinstance(ch, Tag):
                continue
            c = _classes(ch)
            if ch.name == "br":
                p.add_run().add_break(); continue
            if ch.name in ("style", "script", "img"):
                continue
            if "field" in c or ch.has_attr("data-f"):
                self.felt(ch, p, fmt); continue
            f = dict(fmt)
            if ch.name in ("b", "strong") or "k" in c or "num" in c: f["bold"] = True
            if ch.name in ("i", "em"): f["italic"] = True
            if ch.name == "u": f["underline"] = True
            if ch.name == "small" or "small" in c: f["size"] = 7.6
            if "no" in c: f.update(bold=True, color=PINK)
            if "hl" in c: f["hl"] = WD_COLOR_INDEX.YELLOW
            if "ph" in c: f.update(hl=WD_COLOR_INDEX.PINK, bold=True)
            if "pill" in c or "tag" in c: f.update(bold=True, caps=True, size=6.8)
            if "muted" in c or "fhelp" in c: f["color"] = MUTED
            if "acc" in c: f["color"] = RGBColor(0xF4, 0xAF, 0xF9)
            if ch.name == "small" and ch.parent is not None and ch.parent.name == "th":
                p.add_run().add_break()
            if ch.name in INLINE or not _is_block(ch):
                self.inline(ch, p, f)
                if "no" in c:
                    p.add_run("  ")
            else:  # blok inde i inline-sammenhæng: læg teksten ind med mellemrum
                self.run(p, " ", f); self.inline(ch, p, f)

    def felt(self, el, p, fmt):
        c = _classes(el)
        if el.get("data-k") == "check" or "cb" in c:
            self.run(p, ("☒" if "udfyldt" in c else "☐") + " ", fmt); return
        if "udfyldt" in c:
            self.inline(el, p, fmt); return
        self.run(p, " " + ("_" * (14 if "inl" in c else 34)) + " ", {**fmt, "color": MUTED})

    # ----- blokke -----
    def blocks(self, el, cont, ind=0.0, fmt=None):
        """Gennemgår børn af el; inline-indhold samles i afsnit, blokke håndteres hver for sig."""
        fmt = fmt or {}
        cur = None
        for ch in el.children:
            if isinstance(ch, NavigableString):
                if type(ch).__name__ in ("Comment", "Doctype") or not str(ch).strip():
                    continue
                if cur is None: cur = self.par(cont, fmt, indent=ind)
                self.run(cur, re.sub(r"\s+", " ", str(ch)), {}); continue
            if not isinstance(ch, Tag) or ch.name in ("style", "script", "img"):
                continue
            if not _is_block(ch):
                if cur is None: cur = self.par(cont, fmt, indent=ind)
                if ch.name == "br": cur.add_run().add_break()
                elif "field" in _classes(ch) or ch.has_attr("data-f"): self.felt(ch, cur, {})
                else: self.inline(_Wrap(ch), cur, {})
                continue
            cur = None
            self.block(ch, cont, ind, fmt)

    def block(self, el, cont, ind=0.0, fmt=None):
        fmt = dict(fmt or {})
        c = _classes(el); n = el.name
        if "pb" in c or "spacer" in c:
            return
        if "field" in c or el.has_attr("data-f"):
            p = self.par(cont, fmt, indent=ind); self.felt(el, p, {})
            if "multi" in c:
                for _ in range(2):
                    q = self.par(cont, fmt, indent=ind); self.felt(el, q, {})
            return
        if "sigline" in c:
            p = self.par(cont, fmt, indent=ind, before=26, after=4); _par_bottom_border(p); return
        # bokse og gitre
        for k, cols in GRID_COLS.items():
            if k in c:
                return self.grid(el, cont, cols, ind, fmt)
        if "frow" in c:
            cols = 3 if "c3" in c else 2 if "c2" in c else 1
            return self.grid(el, cont, cols, ind, fmt) if cols > 1 else self.blocks(el, cont, ind, fmt)
        for k, fill in BOX.items():
            if k in c:
                return self.box(el, cont, fill, ind, fmt, border=(k == "box"))
        if n == "table":
            return self.table(el, cont, ind)
        if n in ("ol", "ul"):
            return self.liste(el, cont, ind, fmt)
        if n == "dl":
            return self.dl(el, cont, ind, fmt)
        if "cl" in c:
            return self.klausul(el, cont, ind, fmt)
        # overskrifter og tekst
        st = dict(fmt); after = 3.0; before = 0.0
        if n == "h1": st.update(size=24, bold=True); after = 6
        elif n == "h2": st.update(size=12.6 if "sect" in c else 14, bold=True); before = 8; after = 4
        elif n == "h3": st.update(size=10.4, bold=True); after = 2
        elif "bh" in c: st.update(size=15, bold=True); after = 5
        elif "eyebrow" in c: st.update(size=7.8, caps=True); after = 2
        elif "sub" in c: st.update(size=9.6, bold=True); before = 4; after = 2
        elif "flabel" in c: st.update(size=8.4, bold=True); after = 1
        elif "lead" in c:
            prev = el.find_previous_sibling()
            efter_eyebrow = prev is not None and "eyebrow" in _classes(prev)
            st.update(size=12 if efter_eyebrow else 10.6, bold=efter_eyebrow); after = 4
        elif {"role", "fn", "small", "muted", "fhelp", "legend"} & c: st.update(size=7.8, color=MUTED)
        elif "n" in c and el.find_parent(class_="stat"): st.update(size=16, bold=True); after = 1
        elif "l" in c and el.find_parent(class_="stat"): st.update(size=8)
        elif "check" in c: pass
        if any(isinstance(x, Tag) and _is_block(x) for x in el.children):
            if n in ("h1", "h2", "h3") or {"bh", "eyebrow", "sub", "flabel"} & c:
                p = self.par(cont, st, indent=ind, before=before, after=after); self.inline(el, p, {})
                return
            return self.blocks(el, cont, ind, st)
        p = self.par(cont, st, indent=ind, before=before, after=after)
        self.inline(el, p, {})

    def klausul(self, el, cont, ind, fmt):
        kids = [x for x in el.children if isinstance(x, Tag)]
        nr = kids[0] if kids and "nr" in _classes(kids[0]) else None
        body = kids[1] if nr is not None and len(kids) > 1 else el
        p = self.par(cont, fmt, indent=ind, hang=9)
        if nr is not None:
            self.run(p, nr.get_text(" ", strip=True), {"bold": True, "color": PINK}); p.add_run("\t")
        first = True
        for ch in body.children:
            if isinstance(ch, Tag) and _is_block(ch):
                self.block(ch, cont, ind + 9, fmt); first = False
            elif first:
                self.inline(_Wrap(ch), p, {})
            else:
                q = self.par(cont, fmt, indent=ind + 9); self.inline(_Wrap(ch), q, {}); p = q; first = True

    def liste(self, el, cont, ind, fmt):
        ordered = el.name == "ol"; i = 0
        for li in el.find_all("li", recursive=False):
            i += 1
            marker = li.find("i", recursive=False)
            p = self.par(cont, fmt, indent=ind, hang=6.5, after=1.5)
            mtxt = marker.get_text(strip=True) if marker else (f"{i}." if ordered else "•")
            self.run(p, mtxt, {"color": MUTED if marker else None}); p.add_run("\t")
            for ch in li.children:
                if ch is marker:
                    continue
                if isinstance(ch, Tag) and _is_block(ch) and ch.name in ("ol", "ul", "table"):
                    self.block(ch, cont, ind + 6.5, fmt)
                elif isinstance(ch, Tag) and ch.name == "div" and not ch.find(["ol", "ul", "table"]):
                    self.inline(ch, p, {})
                elif isinstance(ch, Tag) and _is_block(ch):
                    self.block(ch, cont, ind + 6.5, fmt)
                else:
                    self.inline(_Wrap(ch), p, {})

    def dl(self, el, cont, ind, fmt):
        dts = el.find_all("dt", recursive=False)
        for dt in dts:
            dd = dt.find_next_sibling("dd")
            p = self.par(cont, fmt, indent=ind, after=2)
            p.paragraph_format.tab_stops.add_tab_stop(Mm(ind + 17))
            self.run(p, dt.get_text(" ", strip=True), {"size": 7.6, "bold": True, "color": MUTED}); p.add_run("\t")
            if dd is not None:
                self.inline(dd, p, {})

    def _table(self, cont, rows, cols, width):
        t = cont.add_table(rows=rows, cols=cols)
        t.alignment = WD_TABLE_ALIGNMENT.LEFT; t.autofit = False
        _no_table_borders(t)
        for col in t.columns:
            for cell in col.cells:
                cell.width = Mm(width / cols)
        for row in t.rows:
            for cell in row.cells:
                cell._fresh = True
        return t

    def _after_table(self, cont):
        if hasattr(cont, "_fresh"):
            return  # i en celle tilføjer Word selv et afsnit efter tabellen
        p = cont.add_paragraph(); p.paragraph_format.space_after = Pt(2)
        r = p.add_run(""); r.font.size = Pt(4)

    def box(self, el, cont, fill, ind, fmt, border=False):
        t = self._table(cont, 1, 1, CONTENT_W - ind)
        _cell_margins(t, 3.5, 3.5, 4.5, 4.5)
        cell = t.cell(0, 0)
        f = dict(fmt)
        if fill: _shade(cell, fill)
        if fill == "311134": f["color"] = WHITE
        if border:
            for s in ("top", "bottom", "left", "right"): _cell_borders(cell, **{s: (10, "311134")})
        self.blocks(el, cell, 0, f)
        self._after_table(cont)

    def grid(self, el, cont, cols, ind, fmt):
        kids = [x for x in el.children if isinstance(x, Tag)]
        if not kids:
            return
        cols = max(1, min(cols, len(kids)))
        rows = (len(kids) + cols - 1) // cols
        t = self._table(cont, rows, cols, CONTENT_W - ind)
        _cell_margins(t, 2.5, 2.5, 3.5, 3.5)
        for i, k in enumerate(kids):
            cell = t.cell(i // cols, i % cols)
            kc = _classes(k)
            boxk = next((b for b in BOX if b in kc), None)
            f = dict(fmt)
            if boxk and BOX[boxk]:
                _shade(cell, BOX[boxk])
                if BOX[boxk] == "311134": f["color"] = WHITE
            if boxk:
                self.blocks(k, cell, 0, f)
            elif _is_block(k):
                self.block(k, cell, 0, f)
            else:
                p = self.par(cell, f); self.inline(_Wrap(k), p, {})
        # gitre med bokse får luft imellem via hvide kanter
        if any(next((b for b in BOX if b in _classes(k)), None) for k in kids):
            for row in t.rows:
                for cell in row.cells:
                    _cell_borders(cell, left=(24, "FFFFFF"), right=(24, "FFFFFF"), top=(24, "FFFFFF"), bottom=(24, "FFFFFF"))
        self._after_table(cont)

    def table(self, el, cont, ind):
        trs = el.find_all("tr")
        if not trs:
            return
        cols = max(len(tr.find_all(["td", "th"], recursive=False)) for tr in trs)
        t = self._table(cont, len(trs), cols, CONTENT_W - ind)
        _cell_margins(t, 1.6, 1.6, 0, 2.5)
        c = _classes(el)
        for r, tr in enumerate(trs):
            for k, td in enumerate(tr.find_all(["td", "th"], recursive=False)):
                cell = t.cell(r, k)
                th = td.name == "th"
                st = {"size": 7.6, "bold": True, "caps": "t" in c or "roles" in c or "review" in c} if th else {"size": 8.7}
                if not th and k == 0 and ("t" in c or "rate" in c): st["bold"] = True
                if "big" in _classes(td): st.update(bold=True, size=11)
                if any(isinstance(x, Tag) and _is_block(x) for x in td.children):
                    self.blocks(td, cell, 0, st)
                else:
                    p = self.par(cell, st, after=0, align=WD_ALIGN_PARAGRAPH.CENTER if "rate" in c and k > 0 else None)
                    self.inline(td, p, {})
                _cell_borders(cell, bottom=(12, "311134") if th else (4, LINE))
        self._after_table(cont)


class _Wrap:
    """Lader en enkelt node blive behandlet som 'element med børn' i inline()."""
    def __init__(self, node):
        self.children = [node]


def lav_docx(dok: dict, partner, sider: list[str], version: str, logo: Path | None, out: Path, partnernavn_html: str = "") -> None:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.left_margin = sec.right_margin = Mm(14)
    sec.top_margin, sec.bottom_margin = Mm(30), Mm(22)
    sec.header_distance, sec.footer_distance = Mm(12), Mm(10)

    st = doc.styles["Normal"]
    st.font.name = FONT; st.font.size = Pt(9); st.font.color.rgb = INK
    rf = st.element.get_or_add_rPr().get_or_add_rFonts()
    for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rf.set(qn(a), FONT)
    st.paragraph_format.line_spacing = 1.2
    st.paragraph_format.space_after = Pt(3)

    # sidehoved med Helle-logo (og partnernavn, hvis dokumentet viser det)
    hp = sec.header.paragraphs[0]; hp.style = doc.styles["Normal"]
    hp.paragraph_format.tab_stops.add_tab_stop(Mm(CONTENT_W), WD_TAB_ALIGNMENT.RIGHT)
    if logo and logo.exists():
        hp.add_run().add_picture(str(logo), height=Mm(8))
    css = dok.get("css") or ""
    if partnernavn_html and ".top .partner{display:none}" not in css:
        foran = "Aftale med" if 'content:"Aftale med"' in css else "Partnermateriale til"
        hp.add_run("\t")
        r = hp.add_run(f"{foran} "); r.font.size = Pt(7.6); r.font.color.rgb = MUTED
        r = hp.add_run(partnernavn_html); r.font.size = Pt(8.6); r.font.bold = True

    # sidefod som i PDF'en
    fp = sec.footer.paragraphs[0]; fp.style = doc.styles["Normal"]
    fp.paragraph_format.tab_stops.add_tab_stop(Mm(CONTENT_W), WD_TAB_ALIGNMENT.RIGHT)
    _par_top = OxmlElement("w:pBdr"); e = OxmlElement("w:top")
    e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "4"); e.set(qn("w:space"), "4"); e.set(qn("w:color"), LINE)
    _par_top.append(e); fp._p.get_or_add_pPr().append(_par_top)
    def fr(t, bold=False):
        r = fp.add_run(t); r.font.size = Pt(6.8); r.font.color.rgb = INK if bold else MUTED; r.font.bold = bold
    fr("Helle Forsikringsformidling A/S", True)
    fr(" · Strandgade 12, 1401 København K · CVR 45418669 · FT-nr. 48105\t")
    fr(f"{dok.get('sidefod_titel', '')} · {dok.get('label', '')} · v{version} · Side ")
    _field(fp, "PAGE"); fr(" af "); _field(fp, "NUMPAGES")
    for r in fp.runs:
        r.font.size = Pt(6.8)

    b = Builder(doc)
    for i, html in enumerate(sider):
        if i > 0:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        soup = BeautifulSoup(f"<div>{html}</div>", "html.parser")
        b.blocks(soup.div, doc, 0, {})
    # fjern tomt første afsnit, hvis dokumentet starter med en tabel
    body = doc.element.body
    first = body[0] if len(body) else None
    if first is not None and first.tag == qn("w:p") and not "".join(first.itertext()).strip() and len(body) > 1:
        body.remove(first)
    doc.save(out)
