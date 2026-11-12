"""Turn the cache into the static files the app reads (web/data/)."""
import json
import shutil
from datetime import datetime

from . import classify as C
from . import filings, prices
from .config import ALERTS, DATA, PORTFOLIO, ROOT
from .nse import NSE

WEB_DATA = ROOT / "web" / "data"
SKIP_PDF = {"results", "earnings_call", "investor_meetings", "unclassified"}


def _needs_pdf(f: dict) -> bool:
    """Read the letter when NSE's text is generic, or when the filing may matter."""
    if not f["url"].lower().endswith(".pdf") or f["nse_type"].lower() in C.ROUTINE:
        return False
    first = C.classify(f)
    return C.is_generic(C.clean(f["text"])) or (first["priority"] >= C.MEDIUM and first["category"] not in SKIP_PDF)


def build_filings() -> list[dict]:
    nse, out = NSE(), []
    for sym in PORTFOLIO:
        for f in filings.load(sym):
            pdf = filings.attachment_text(f, nse) if _needs_pdf(f) else ""
            a = C.analyse(f, pdf)
            out.append({"id": f["id"], "symbol": sym, "time": f["time"], "type": f["nse_type"], "url": f["url"], **a})
    return sorted(out, key=lambda x: x["time"], reverse=True)


def build_prices(days: int = 260) -> dict:
    out = {}
    for sym in PORTFOLIO:
        df = prices.load(sym).tail(days)
        out[sym] = [[d.strftime("%Y-%m-%d"), round(float(r.Close), 2), int(r.Volume)] for d, r in df.iterrows()]
    return out


def build_people(items: list[dict]) -> list[dict]:
    doc = json.loads((DATA / "people" / "executives.json").read_text())
    url = {i["id"]: i["url"] for i in items}
    for p in doc["people"]:
        p["event"]["url"] = url.get(p["event"]["filing"], "")
    return doc["people"]


def export() -> dict:
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    items = build_filings()
    meta = json.loads((filings.FILINGS / "_meta.json").read_text())
    px = build_prices()
    last_price_day = max(rows[-1][0] for rows in px.values())
    feed = {
        "meta": {
            "as_of": meta["refreshed"],               # windows count back from here, not from "now"
            "filings_from": meta["from"], "last_price_day": last_price_day,
            "built": datetime.now().isoformat(timespec="minutes"),
        },
        "defaults": {**ALERTS, "alert_categories": ["results", "M&A", "management_change", "litigation",
                                                     "credit_rating", "fund_raise", "pledging", "capex"]},
        "companies": {s: {"name": n, "sector": sec, "size": size} for s, (n, sec, size) in PORTFOLIO.items()},
        "filings": items,
        "prices": px,
    }
    (WEB_DATA / "feed.json").write_text(json.dumps(feed, ensure_ascii=False, separators=(",", ":")))
    (WEB_DATA / "people.json").write_text(json.dumps(build_people(items), ensure_ascii=False, separators=(",", ":")))
    shutil.copy(DATA / "network" / "orgs.json", WEB_DATA / "orgs.json")
    shutil.copy(DATA / "network" / "demo_network.json", WEB_DATA / "network.json")
    tiers = {t: sum(1 for i in items if i["tier"] == t) for t in ("high", "medium", "low")}
    return {"filings": len(items), **tiers, "as_of": meta["refreshed"], "last_price_day": last_price_day}
