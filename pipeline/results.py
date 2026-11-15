"""Headline results from the filing itself: the XBRL attached to each quarter's
Integrated Filing on NSE. Exact rupees, read by code, no model.

EBITDA is not a line in the filing, so code builds it:
  PBT + finance costs + depreciation - other income - exceptional items
(operating EBITDA: before financing, accounting and one-offs). Lenders get no
EBITDA; for a bank or NBFC it means nothing.
"""
import json
from datetime import datetime

from lxml import etree

from .config import DATA
from .nse import NSE

RESULTS = DATA / "results"
LENDERS = {"HDFCBANK", "CHOLAFIN", "MANAPPURAM", "CREDITACC", "BAJFINANCE", "ICICIBANK"}
XBRLI = "{http://www.xbrl.org/2003/instance}"
XBRLDI = "{http://xbrl.org/2006/xbrldi}"

# First tag found wins; banks and NBFCs use different names for the same idea.
TAGS = {
    "revenue": ["RevenueFromOperations", "InterestEarned", "TotalIncomeFromOperations"],
    "other_income": ["OtherIncome"],
    "finance": ["FinanceCosts"],
    "dna": ["DepreciationDepletionAndAmortisationExpense", "DepreciationAndAmortisationExpense"],
    "exceptional": ["ExceptionalItemsBeforeTax", "ExceptionalItems"],
    "pbt": ["ProfitBeforeTax", "ProfitLossFromOrdinaryActivitiesBeforeTax", "ProfitLossBeforeTax"],
    "tax": ["TaxExpense", "TaxExpenses"],
    "disc": ["ProfitLossFromDiscontinuedOperationsAfterTax", "ProfitLossFromDiscontinuedOperations"],
    "assoc": ["ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod",
              "ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethodNetOfTax"],
    "pat": ["ProfitLossForPeriod", "ProfitLossForThePeriod", "NetProfitLossForThePeriod", "ProfitLossForPeriodFromContinuingOperations"],
}


def filings_list(nse: NSE, sym: str) -> list[dict]:
    data = nse.api("integrated-filing-results", index="equities", symbol=sym,
                   type="Integrated Filing- Financials", page=1, size=20)
    return data.get("data", []) if isinstance(data, dict) else []


def quarter_values(xml: bytes, qe: datetime) -> dict:
    """Values for the three months ending `qe`, from contexts with no dimensions."""
    root = etree.fromstring(xml)
    ctx = {}
    for c in root.iter(f"{XBRLI}context"):
        p = c.find(f"{XBRLI}period")
        start, end = p.findtext(f"{XBRLI}startDate"), p.findtext(f"{XBRLI}endDate")
        if not start or not end or c.find(f".//{XBRLDI}explicitMember") is not None:
            continue
        s, e = datetime.fromisoformat(start), datetime.fromisoformat(end)
        if e.date() == qe.date() and 80 <= (e - s).days <= 100:
            ctx[c.get("id")] = True
    found = {}
    for el in root:
        tag = etree.QName(el).localname if isinstance(el.tag, str) else ""
        if el.get("contextRef") in ctx and el.text:
            try:
                found.setdefault(tag, float(el.text))
            except ValueError:
                pass
    out = {}
    for key, names in TAGS.items():
        out[key] = next((found[n] for n in names if n in found), None)
    return out


def headline(sym: str, v: dict) -> dict:
    cr = lambda x: None if x is None else round(x / 1e7, 2)   # rupees -> crore
    ebitda = None
    if sym not in LENDERS and None not in (v["pbt"], v["finance"], v["dna"]):
        ebitda = v["pbt"] + v["finance"] + v["dna"] - (v["other_income"] or 0) - (v["exceptional"] or 0)
    return {"revenue": cr(v["revenue"]), "ebitda": cr(ebitda), "pbt": cr(v["pbt"]), "pat": cr(v["pat"]),
            "tax": cr(v["tax"]), "after_tax_items": [cr(v["disc"]) or 0, cr(v["assoc"]) or 0]}


def change(cur, base):
    if cur is None or base in (None, 0):
        return None
    return round((cur / base - 1) * 100 * (1 if base > 0 else -1), 1)


def fetch(sym: str, nse: NSE | None = None) -> dict | None:
    nse = nse or NSE()
    rows = filings_list(nse, sym)
    if not rows:
        return None
    pick = {}
    for r in rows:   # prefer consolidated; one per quarter
        qe = datetime.strptime(r["qe_Date"].title(), "%d-%b-%Y")
        cons = r.get("consolidated", "").lower().startswith("consol")
        if qe not in pick or (cons and not pick[qe]["cons"]):
            pick[qe] = {"row": r, "cons": cons}
    quarters = sorted(pick, reverse=True)
    cur = quarters[0]
    prev = next((q for q in quarters if (cur - q).days in range(80, 100)), None)
    year = next((q for q in quarters if (cur - q).days in range(355, 375)), None)
    values = {}
    for q in (cur, prev, year):
        if not q:
            continue
        r = pick[q]["row"]
        path = DATA / "raw" / "xbrl" / f"{sym}-{q:%Y%m%d}.xml"
        xml = nse.download(r["xbrl"], path).read_bytes()
        values[q] = headline(sym, quarter_values(xml, q))
    c = values[cur]
    out = {"symbol": sym, "quarter_end": cur.strftime("%Y-%m-%d"), "consolidated": pick[cur]["cons"],
           "url": pick[cur]["row"].get("ixbrl") or pick[cur]["row"]["xbrl"], "filed": pick[cur]["row"].get("broadcast_Date"),
           "lender": sym in LENDERS, "lines": {}}
    for k in ("revenue", "ebitda", "pbt", "pat"):
        line = {"cur": c[k]}
        for label, q in (("qoq", prev), ("yoy", year)):
            base = values.get(q, {}).get(k) if q else None
            if c[k] is not None and base is not None and (c[k] < 0 or base < 0):
                # Percent changes around a loss mislead (a doubled loss reads as -106%); say what happened.
                flip = ("to a loss" if c[k] < 0 else "to a profit") if (c[k] < 0) != (base < 0) \
                    else ("loss widened" if c[k] < base else "loss narrowed")
                line[label], line[f"{label}_flip"] = None, flip
            else:
                line[label] = change(c[k], base)
        out["lines"][k] = line
    rate = lambda v: None if not v or not v.get("pbt") or v.get("tax") is None or v["pbt"] <= 0 else round(100 * v["tax"] / v["pbt"], 1)
    out["tax_rate"] = {"cur": rate(c), "yoy": rate(values.get(year)) if year else None}
    out["summary"] = summary_line(out)
    # Check: PAT should be PBT less tax (associates and minorities can add a little).
    # Check: PAT should be PBT less tax, plus any profit booked after tax
    # (discontinued operations, sometimes associates). Otherwise say so plainly.
    if None not in (c["pbt"], c["tax"], c["pat"]):
        disc, assoc = c["after_tax_items"]
        tol = max(1.0, 0.03 * abs(c["pat"]))
        gaps = [abs(c["pbt"] - c["tax"] + extra - c["pat"]) for extra in (0, disc, disc + assoc)]
        gap = min(gaps)
        out["check"] = "ok" if gap <= tol else (
            f"PAT is ₹{gap:,.0f} cr away from PBT less tax: items booked after tax (associates, minorities or discontinued operations)")
    return out


def _pct(x):
    return f"{'+' if x >= 0 else '−'}{abs(x):.1f}%"


def summary_line(r: dict) -> str:
    """What happened, in one line, written by code from the numbers:
    'Revenue +13.8% YoY, PAT −14.4% YoY · tax took 33% of PBT against 12% a year ago'."""
    L = r["lines"]
    parts = []
    if L["revenue"].get("yoy") is not None:
        parts.append(f"Revenue {_pct(L['revenue']['yoy'])} YoY")
    pat = L["pat"]
    if pat.get("yoy_flip"):
        verb = f"swung {pat['yoy_flip']}" if pat["yoy_flip"].startswith("to ") else pat["yoy_flip"]
        parts.append(f"{verb} (PAT {'−' if pat['cur'] < 0 else ''}₹{abs(pat['cur']):,.0f} cr)")
    elif pat.get("yoy") is not None:
        parts.append(f"PAT {_pct(pat['yoy'])}")
    line = ", ".join(parts)
    pbt, t = L["pbt"].get("yoy"), r.get("tax_rate") or {}
    if pat.get("yoy") is not None and pbt is not None and abs(pbt - pat["yoy"]) >= 10 and t.get("cur") and t.get("yoy"):
        line += f" · tax took {t['cur']:.0f}% of PBT against {t['yoy']:.0f}% a year ago"
    e = L["ebitda"]
    if e.get("cur") and L["revenue"].get("cur") and not r["lender"]:
        line += f" · EBITDA margin {100 * e['cur'] / L['revenue']['cur']:.1f}%"
    return line


def load() -> dict:
    path = RESULTS / "latest.json"
    return json.loads(path.read_text()) if path.exists() else {}


def update(symbols: list[str]) -> dict:
    nse, out = NSE(), {}
    RESULTS.mkdir(parents=True, exist_ok=True)
    for s in symbols:
        try:
            r = fetch(s, nse)
        except Exception as e:  # one company's odd filing shouldn't stop the rest
            r = {"symbol": s, "error": f"{type(e).__name__}: {e}"[:200]}
        if r:
            out[s] = r
    (RESULTS / "latest.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return out
