"""Promised vs delivered for any NSE ticker, from its last four earnings calls.

Primary sources only: the transcripts the company filed. The model reads and
drafts; code checks. Every quote must appear word for word in its transcript.
Code decides whether a promise's deadline has passed, and settles any
promise with a number against the number management later reported.
"""
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from . import llm
from . import transcripts as T
from .config import DATA, ROOT

METRICS = ["revenue growth", "revenue", "volume growth", "EBITDA margin", "operating margin", "gross margin",
           "PAT", "PAT growth", "EBITDA", "AUM growth", "loan growth", "disbursement growth", "credit cost",
           "GNPA", "NIM", "ROA", "ROE", "cost to income", "capex", "capacity", "order book", "deal wins", "headcount",
           "market share", "milestone", "other"]
LOWER_IS_BETTER = {"credit cost", "GNPA", "cost to income"}

EXTRACT_SYSTEM = """You read one earnings-call transcript of an Indian listed company. Use only this text, never outside knowledge.
Extract two lists.
1. reported: results management states for the period just ended (quarter, half or year): growth rates, margins, profit, volumes, AUM or loan growth, credit cost, capex.
2. guidance: explicit forward statements by management on those headline numbers or dated milestones (a plant start, a target year). Skip analysts' words, and vague hopes with no number or date.
Rules:
- quote: copy management's exact words from the text, verbatim, at most 40 words, no ellipses.
- segment: "company" for the whole company, otherwise the business or segment exactly as management names it (e.g. "mobile phones", "lighting", "refrigerators"). Never label a segment figure as "company".
- metric: choose the closest from the allowed list; "other" only if none fits.
- unit: "%" for percentages and growth rates, "crore" for rupees crore, "bps", "x", "USD mn", "units", or "" for dates.
- Indian fiscal year: FY27 = April 2026 to March 2027. Write periods and horizons like "Q2 FY27", "H2 FY27", "FY27", "FY28".
- A range gives low and high; "at least 15%" gives low only; a single number gives low = high.
- At most 10 reported and 8 guidance items; prefer the headline ones."""

JUDGE_SYSTEM = """You check an Indian company's earnings-call promises against what it later reported, using only the material given.
For each promise id, return a verdict:
- delivered: a later reported number meets the target for that horizon.
- partly: close to the target but short, or only part of it met.
- missed: the horizon has ended and the reported number is clearly short, or the date passed without it.
- revised: a later call changed the target (say how in the note).
- pending: the horizon has not ended by the latest reported period, and the target still stands.
- dropped: the horizon passed and later calls never mention it again. Use rarely.
Compare like with like: the same segment (or the whole company) and the same period. A company-wide number never settles a segment promise, or the reverse; if the material has no matching number, say pending (horizon not ended) or dropped (ended and never mentioned), or partly with a note.
Each promise lists sentences from later calls that may mention it; use them, not only the reported list.
Repeating a target in a later call is not delivering it. A full-year target is judged on full-year numbers, not one strong quarter.
evidence_quote: copy the exact words from a reported line or later-call guidance below, verbatim, or null.
actual_value and actual_unit: the reported number you compared against, or null. note: at most 20 words."""

EXTRACT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "period": {"type": "STRING", "description": "the quarter this call reports, e.g. Q2 FY27"},
        "reported": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "segment": {"type": "STRING"}, "metric": {"type": "STRING", "enum": METRICS}, "value": {"type": "NUMBER", "nullable": True},
            "unit": {"type": "STRING"}, "period": {"type": "STRING"}, "quote": {"type": "STRING"}},
            "required": ["segment", "metric", "period", "quote"]}},
        "guidance": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "segment": {"type": "STRING"}, "metric": {"type": "STRING", "enum": METRICS}, "target": {"type": "STRING"},
            "low": {"type": "NUMBER", "nullable": True}, "high": {"type": "NUMBER", "nullable": True},
            "unit": {"type": "STRING"}, "horizon": {"type": "STRING"}, "quote": {"type": "STRING"}},
            "required": ["segment", "metric", "target", "horizon", "quote"]}},
    },
    "required": ["period", "reported", "guidance"],
}

JUDGE_SCHEMA = {
    "type": "OBJECT",
    "properties": {"verdicts": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "id": {"type": "STRING"},
        "verdict": {"type": "STRING", "enum": ["delivered", "partly", "missed", "revised", "pending", "dropped"]},
        "actual_segment": {"type": "STRING", "nullable": True},
        "actual": {"type": "STRING", "nullable": True, "description": "what happened, at most 15 words"},
        "actual_value": {"type": "NUMBER", "nullable": True}, "actual_unit": {"type": "STRING", "nullable": True},
        "evidence_quote": {"type": "STRING", "nullable": True}, "evidence_call": {"type": "STRING", "nullable": True},
        "note": {"type": "STRING"}},
        "required": ["id", "verdict", "note"]}}},
    "required": ["verdicts"],
}


# ---------- fiscal periods ----------

def period_end(label: str | None) -> tuple[int, int] | None:
    """'Q2 FY27' -> (2026, 9); 'H2 FY27' -> (2027, 3); 'FY27' / 'by FY27' -> (2027, 3); '9M FY27' -> (2026, 12)."""
    if not label:
        return None
    s = label.upper().replace(" ", "").replace("'", "")
    m = re.search(r"FY(20)?(\d{2})", s)
    if not m:
        return None
    fy = 2000 + int(m.group(2))
    q = re.search(r"Q([1-4])", s)
    h = re.search(r"H([12])", s)
    nine = "9M" in s
    if q:
        return {1: (fy - 1, 6), 2: (fy - 1, 9), 3: (fy - 1, 12), 4: (fy, 3)}[int(q.group(1))]
    if h:
        return (fy - 1, 9) if h.group(1) == "1" else (fy, 3)
    if nine:
        return (fy - 1, 12)
    return (fy, 3)


def horizon_key(h: str) -> str:
    s = h.upper().replace(" ", "").replace("'", "").replace("BY", "")
    m = re.search(r"(Q[1-4]|H[12]|9M)?FY(20)?(\d{2})", s)
    return f"{m.group(1) or ''}FY{m.group(3)}" if m else h.strip().lower()


UNIT = [(r"^(%|percent|per ?cent|pct)$", "%"), (r"^bps|basis", "bps"), (r"^(₹|rs\.?|inr)?\s*(cr|crore|crores)$", "crore"),
        (r"lakh ?crore", "lakh crore"), (r"(usd|\$|us\$).*(mn|million)|(mn|million).*(usd|\$)", "USD mn"),
        (r"(usd|\$|us\$).*(bn|billion)|(bn|billion).*(usd|\$)", "USD bn")]


def norm_unit(u: str | None) -> str:
    u = (u or "").strip().lower()
    for pat, name in UNIT:
        if re.search(pat, u):
            return name
    return u


# Management's own words settle the metric when the model labels the same thing
# two ways across calls ("operating margin" in one, "EBITDA margin" in the next).
MARGIN_WORDS = [(r"\bnet interest margin\b|\bnims?\b", "NIM"), (r"\boperating margin\b|\bebit margin\b", "operating margin"),
                (r"\bebitda margin\b", "EBITDA margin")]


def metric_from_quote(metric: str, quote: str) -> str:
    if metric not in ("EBITDA margin", "operating margin", "NIM", "gross margin", "other"):
        return metric
    q = quote.lower()
    hits = [name for pat, name in MARGIN_WORDS if re.search(pat, q)]
    return hits[0] if len(hits) == 1 else metric


# ---------- steps ----------

def extract(name: str, call: dict) -> tuple[dict, dict, int]:
    """One call's reported results and guidance, keeping only quotes found verbatim in the transcript."""
    limit = 22000 if ON_DEMAND else 42000   # a visitor waiting gets a tighter excerpt
    prompt = f"Company: {name}\nCall: {call['label']}\n\nTranscript sentences with numbers or forward-looking words:\n{T.trim(call['text'], limit)}"
    data, usage = llm.generate(prompt, system=EXTRACT_SYSTEM, schema=EXTRACT_SCHEMA, role="extract", tag=f"extract {call['label']}")
    full = T.squash(call["text"])
    dropped = 0
    for key in ("reported", "guidance"):
        kept = []
        for item in data.get(key, []):
            q = (item.get("quote") or "").strip()
            if len(T.squash(q)) >= 12 and T.squash(q) in full:
                item["metric"] = metric_from_quote(item["metric"], q)
                kept.append(item)
            else:
                dropped += 1
        data[key] = kept
    return data, usage, dropped


def seg_key(seg: str | None) -> str:
    s = re.sub(r"\b(segment|business|division|vertical)s?\b", "", (seg or "company").lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip() or "company"


GENERIC = STOP_GROUP = set("""guidance guided guiding expect expected expecting year years target targeting planned plan around
approximately range between somewhere stands stand going should would will could the a an and or of to in for on at by with
we our is are be that this from as it its about almost next current fiscal financial crore crores inr rs company""".split())


def _content(m: dict, segment: str) -> set[str]:
    words = re.findall(r"[a-z]{3,}", (m["quote"] + " " + (segment or "")).lower())
    return {w for w in words if w not in GENERIC}


def _same_thing(a: dict, b: dict, seg_a: str, seg_b: str) -> bool:
    """Two statements are the same promise only if they share a content word
    ('Odisha site first stage' and 'planned capex for FY27' do not)."""
    return bool(_content(a, seg_a) & _content(b, seg_b))


def group_promises(calls: list[dict], extracted: list[dict]) -> list[dict]:
    """The same segment, metric and horizon across calls is one promise with a history,
    if the statements are about the same thing."""
    promises, index = [], {}
    for call, ex in sorted(zip(calls, extracted), key=lambda p: p[0]["month"]):
        for g in ex["guidance"]:
            key = (seg_key(g.get("segment")), g["metric"], horizon_key(g["horizon"]))
            mention = {"call": call["label"], "month": call["month"], "url": call["url"], "target": g["target"],
                       "low": g.get("low"), "high": g.get("high"), "unit": norm_unit(g.get("unit")), "quote": g["quote"]}
            match = next((promises[i] for i in index.get(key, [])
                          if _same_thing(promises[i]["mentions"][0], mention, promises[i]["segment"], g.get("segment"))), None)
            if match:
                if match["mentions"][-1]["call"] != call["label"]:
                    match["mentions"].append(mention)
            else:
                index.setdefault(key, []).append(len(promises))
                promises.append({"id": "", "segment": g.get("segment") or "company",
                                 "metric": g["metric"], "horizon": g["horizon"], "horizon_key": key[2], "mentions": [mention]})
    promises = merge_segment_variants(promises)
    for i, p in enumerate(promises, 1):
        p["id"] = f"p{i}"
        p["moved"] = moved(p["mentions"])
        p["direction"] = direction(p) if p["moved"] else None
    return promises


def moved(mentions: list[dict]) -> bool:
    """A target moved only if two statements give the same kind of range with different
    numbers. 15-20% then 'at least 15%' is a different shape, not a cut."""
    for a, b in zip(mentions, mentions[1:]):
        shape = lambda m: (m.get("low") is None, m.get("high") is None)
        if shape(a) == shape(b) and shape(a) != (True, True) and (a.get("low"), a.get("high")) != (b.get("low"), b.get("high")):
            return True
    return False


def _mid(m: dict) -> float | None:
    xs = [x for x in (m.get("low"), m.get("high")) if x is not None]
    return sum(xs) / len(xs) if xs else None


def direction(p: dict) -> str | None:
    """'raised' or 'cut' as the investor reads it: a lower credit cost target is a raise in ambition."""
    a, b = _mid(p["mentions"][0]), _mid(p["mentions"][-1])
    if a is None or b is None or a == b:
        return None
    up = b > a
    if p["metric"] in LOWER_IS_BETTER:
        up = not up
    return "raised" if up else "cut"


def merge_segment_variants(promises: list[dict]) -> list[dict]:
    """'telecom network business' and 'telecom' with the same metric and horizon are one
    promise: management names a segment loosely from call to call."""
    out = []
    for p in promises:
        words = set(seg_key(p["segment"]).split())
        twin = next((q for q in out if q["metric"] == p["metric"] and q["horizon_key"] == p["horizon_key"]
                     and (words <= set(seg_key(q["segment"]).split()) or set(seg_key(q["segment"]).split()) <= words)
                     and "company" not in words | set(seg_key(q["segment"]).split())), None)
        if twin:
            seen = {m["call"] for m in twin["mentions"]}
            twin["mentions"] = sorted(twin["mentions"] + [m for m in p["mentions"] if m["call"] not in seen], key=lambda m: m["month"])
            if len(seg_key(p["segment"])) < len(seg_key(twin["segment"])):
                twin["segment"] = p["segment"]
        else:
            out.append(p)
    return out


STOP = set("the a an and or of to in for on at by with we our is are be will should would that this from as it its "
           "about around almost somewhere between next year quarter fiscal current crores crore inr rs".split())


def later_mentions(p: dict, calls: list[dict], per_call: int = 4) -> list[tuple[str, str]]:
    """Sentences from calls after the promise that share its key words and carry a number:
    the material a fair 'delivered or not' needs, beyond the handful of extracted results."""
    words = {w for w in re.findall(r"[a-z]{3,}", (p["mentions"][0]["quote"] + " " + p["segment"] + " " + p["metric"]).lower())
             if w not in STOP}
    seg_words = set(seg_key(p["segment"]).split()) - {"company"}
    stems = {w[:5] for w in seg_words}   # "phones" ~ "phone", "smartphones" keeps its own stem
    first = p["mentions"][0]["month"]
    out = []
    for c in sorted(calls, key=lambda c: c["month"]):
        if c["month"] <= first:
            continue
        scored = []
        for s in T.sentences(c["text"]):
            if not re.search(r"\d", s) or len(s) > 400:
                continue
            toks = set(re.findall(r"[a-z]{3,}", s.lower()))
            if stems and not any(t[:5] in stems for t in toks):
                continue   # a segment promise needs a sentence about that segment
            hits = len(words & toks)
            if hits >= 2:
                scored.append((hits, s))
        out += [(c["label"], s) for _, s in sorted(scored, key=lambda x: -x[0])[:per_call]]
    return out


def _judge_input(name: str, latest: dict, promises: list[dict], calls: list[dict], extracted: list[dict]) -> str:
    lines = [f"Company: {name}", f"Latest results reported: {latest['period']}, in the {latest['label']} call.",
             "Fiscal year: FY27 = April 2026 to March 2027.", "", "PROMISES (each time management stated them):"]
    for p in promises:
        lines.append(f"{p['id']} | segment: {p['segment']} | {p['metric']} | horizon {p['horizon']}")
        for m in p["mentions"]:
            lines.append(f"   {m['call']} call: target {m['target']} — \"{m['quote']}\"")
        for label, sent in later_mentions(p, calls):
            lines.append(f"   later, {label} call: \"{sent}\"")
    lines += ["", "REPORTED RESULTS (by call):"]
    for call, ex in sorted(zip(calls, extracted), key=lambda p: p[0]["month"]):
        for r in ex["reported"]:
            v = "" if r.get("value") is None else f"{r['value']} {r.get('unit', '')}"
            lines.append(f"[{call['label']}] segment: {r.get('segment', 'company')} | {r['metric']} {r['period']}: {v} — \"{r['quote']}\"")
    return "\n".join(lines)


def settle(p: dict, v: dict, latest_end: tuple[int, int]) -> dict:
    """Code's say on the model's verdict: dates first, then numbers."""
    out = {**v, "settled_by": "model"}
    end = period_end(p["horizon_key"]) or period_end(p["horizon"])
    target = p["mentions"][-1]
    if end and end > latest_end and v["verdict"] in ("delivered", "missed", "partly", "dropped"):
        out.update(verdict="pending", settled_by="date", model_verdict=v["verdict"])
        return out
    lo, hi = target.get("low"), target.get("high")
    val, unit = v.get("actual_value"), norm_unit(v.get("actual_unit"))
    if end and end <= latest_end and val is not None and (lo is not None or hi is not None) and unit == target["unit"] \
            and v["verdict"] not in ("revised", "dropped"):
        lower_better = p["metric"] in LOWER_IS_BETTER
        bar = (hi if hi is not None else lo) if lower_better else (lo if lo is not None else hi)
        # A rupee target set against a number three times bigger or smaller is almost
        # always a different business (a segment against the company). Don't pretend.
        if unit not in ("%", "bps") and bar and not (1 / 3 <= abs(val / bar) <= 3):
            out.update(verdict="unclear", settled_by="check", model_verdict=v["verdict"],
                       note=f"The number compared ({val:,.0f} {unit}) looks like a different business or scale from the target.")
            return out
        band = 1.0 if unit == "%" else 10.0 if unit == "bps" else abs(bar) * 0.10   # "close": 1 pt, 10 bps or 10%
        good = val <= bar if lower_better else val >= bar
        close = abs(val - bar) <= band
        verdict = "delivered" if good else "partly" if close else "missed"
        if verdict != v["verdict"]:
            out.update(verdict=verdict, settled_by="numbers", model_verdict=v["verdict"])
        else:
            out["settled_by"] = "numbers"
    return out


ON_DEMAND = os.environ.get("FINN_ON_DEMAND") == "1"
JUDGE_BY = 40   # seconds: on demand, skip the judge after this; browsers give up around 75


def research(sym: str) -> dict:
    started = time.monotonic()
    sym = sym.upper().strip()
    name, calls = T.last_four(sym)
    if len(calls) < 2:
        raise LookupError(f"{sym}: fewer than two earnings-call transcripts could be read")
    def safe(c):
        try:
            return extract(name, c)
        except Exception as e:   # one unreadable call shouldn't sink the other three
            return e
    with ThreadPoolExecutor(max_workers=4) as pool:
        got = list(pool.map(safe, calls))
    failed = [g for g in got if isinstance(g, Exception)]
    calls = [c for c, g in zip(calls, got) if not isinstance(g, Exception)]
    results = [g for g in got if not isinstance(g, Exception)]
    if len(results) < 2:
        raise RuntimeError(str(failed[0]) if failed else "fewer than two calls could be read")
    extracted = [r[0] for r in results]
    usage = [r[1] for r in results]
    dropped = sum(r[2] for r in results)
    for c, ex in zip(calls, extracted):
        c["period"] = ex.get("period", "")

    latest = max(calls, key=lambda c: c["month"])
    latest_end = period_end(latest["period"]) or (int(latest["month"][:4]), int(latest["month"][5:]) - 1 or 12)
    promises = group_promises(calls, extracted)
    older = [p for p in promises if p["mentions"][0]["call"] != latest["label"]]

    verdicts, judge_model = {}, llm.models()["judge"]
    skipped_judge = bool(older) and ON_DEMAND and time.monotonic() - started > JUDGE_BY
    if older and not skipped_judge:
        prompt = _judge_input(name, latest, older, calls, extracted)
        try:
            data, u = llm.generate(prompt, system=JUDGE_SYSTEM, schema=JUDGE_SCHEMA, role="judge", tag="judge")
        except Exception:
            # The stronger model is slow or busy on the free tier: let the cheaper one judge,
            # and say so on the page. Code's checks on dates and numbers apply either way.
            judge_model = llm.models()["extract"]
            data, u = llm.generate(prompt, system=JUDGE_SYSTEM, schema=JUDGE_SCHEMA, role="extract",
                                   model=judge_model, tag="judge (fallback)")
        usage.append(u)
        verdicts = {v["id"]: v for v in data.get("verdicts", [])}

    by_label = {c["label"]: c for c in calls}
    overrides = 0
    for p in promises:
        if p not in older:
            p.update(verdict="pending", note="First stated in the latest call.", settled_by="date")
            continue
        v = verdicts.get(p["id"], {"verdict": "pending", "note": "Not judged in time on this first read; code's checks on dates and changed targets still apply."
                                   if skipped_judge else "Not judged."})
        q, call = v.get("evidence_quote"), by_label.get(v.get("evidence_call") or "")
        if q:
            pool = [call] if call else calls
            hit = next((c for c in pool if T.squash(q) in T.squash(c["text"])), None)
            if hit:
                v["evidence"] = {"quote": q, "call": hit["label"], "url": hit["url"]}
            else:
                dropped += 1
        s = settle(p, v, latest_end)
        end = period_end(p["horizon_key"]) or period_end(p["horizon"])
        if skipped_judge and end and end <= latest_end and s["verdict"] == "pending":
            s.update(verdict="unclear", settled_by="date")   # the deadline has passed, but no one judged it
        # A target management changed is a fact in the quotes, not a judgment: code says so
        # even when a weaker judge calls it pending.
        if p.get("moved") and s["verdict"] == "pending":
            s.update(verdict="revised", settled_by="quotes", model_verdict=v["verdict"])
        overrides += "model_verdict" in s
        p.update({k: s.get(k) for k in ("verdict", "actual", "actual_value", "actual_unit", "note", "evidence",
                                        "settled_by", "model_verdict") if s.get(k) is not None})

    return {
        "symbol": sym, "name": name, "built": datetime.now().isoformat(timespec="minutes"),
        "calls": [{k: c[k] for k in ("label", "month", "url", "period")} for c in sorted(calls, key=lambda c: c["month"])],
        "latest_period": latest["period"],
        "promises": promises,
        "reported": [{**r, "call": c["label"], "url": c["url"]} for c, ex in zip(calls, extracted) for r in ex["reported"]],
        "checks": {"quotes_dropped": dropped, "overrides": overrides},
        "models": {"extract": llm.models()["extract"], "judge": None if skipped_judge else judge_model},
        "seconds": round(time.monotonic() - started, 1),
        "usage": {"calls": len(usage), "cached": sum(1 for u in usage if u.get("cached")),
                  "tokens_in": sum(u["in"] for u in usage), "tokens_out": sum(u["out"] for u in usage)},
    }


def save(result: dict) -> None:
    for folder in (DATA / "research", ROOT / "web" / "data" / "research"):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{result['symbol']}.json").write_text(json.dumps(result, ensure_ascii=False, indent=None))
    idx_path = ROOT / "web" / "data" / "research" / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {}
    idx[result["symbol"]] = {"name": result["name"], "built": result["built"], "latest": result["latest_period"]}
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1))
