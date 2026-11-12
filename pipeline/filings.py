"""Corporate announcements from NSE, fetched market-wide and kept per company."""
import json
from datetime import date, datetime, timedelta

from .config import DATA
from .nse import NSE

FILINGS = DATA / "filings"
NSE_DATE = "%d-%m-%Y"


def parse_time(an_dt: str) -> datetime:
    """NSE's an_dt looks like '12-Nov-2026 21:18:54'."""
    return datetime.strptime(an_dt.strip(), "%d-%b-%Y %H:%M:%S")


def normalise(raw: dict) -> dict:
    return {
        "id": str(raw["seq_id"]),
        "symbol": raw["symbol"],
        "company": raw.get("sm_name") or raw["symbol"],
        "time": parse_time(raw["an_dt"]).isoformat(),
        "nse_type": (raw.get("desc") or "").strip(),
        "text": " ".join((raw.get("attchmntText") or "").split()),
        "url": raw.get("attchmntFile") or "",
        "size": raw.get("fileSize") or raw.get("attFileSize") or "",
    }


def fetch_window(nse: NSE, start: date, end: date, chunk_days: int = 7) -> list[dict]:
    """Every equity announcement on NSE between two dates, in weekly requests."""
    out, a = [], start
    while a <= end:
        b = min(a + timedelta(days=chunk_days - 1), end)
        items = nse.api("corporate-announcements", index="equities",
                        from_date=a.strftime(NSE_DATE), to_date=b.strftime(NSE_DATE))
        out.extend(items or [])
        a = b + timedelta(days=1)
    return out


def load(symbol: str) -> list[dict]:
    path = FILINGS / f"{symbol}.json"
    return json.loads(path.read_text()) if path.exists() else []


def update(symbols: list[str], days: int = 30, today: date | None = None) -> dict[str, int]:
    """Fetch the last `days` days for the whole market; merge each symbol's items into its cache."""
    today = today or date.today()
    raw = fetch_window(NSE(), today - timedelta(days=days), today)
    wanted = set(symbols)
    new: dict[str, list[dict]] = {s: [] for s in symbols}
    for r in raw:
        if r.get("symbol") in wanted:
            new[r["symbol"]].append(normalise(r))
    FILINGS.mkdir(parents=True, exist_ok=True)
    counts = {}
    for sym in symbols:
        merged = {f["id"]: f for f in load(sym)}
        merged.update({f["id"]: f for f in new[sym]})
        items = sorted(merged.values(), key=lambda f: f["time"], reverse=True)
        (FILINGS / f"{sym}.json").write_text(json.dumps(items, indent=1, ensure_ascii=False))
        counts[sym] = len(items)
    (FILINGS / "_meta.json").write_text(json.dumps({
        "refreshed": datetime.now().isoformat(timespec="minutes"),
        "from": (today - timedelta(days=days)).isoformat(), "to": today.isoformat(),
        "market_items_seen": len(raw)}, indent=1))
    return counts
