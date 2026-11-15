"""Earnings-call transcripts for any NSE ticker, found through screener.in.

screener.in lists each call with a link to the transcript the company filed
(usually a BSE PDF). Only primary documents are read: the transcript itself.
"""
import hashlib
import re

import requests
from bs4 import BeautifulSoup

from .config import DATA

# Some company sites (srf.com) don't send their intermediate certificate.
# Verify against the operating system's trust store, which has it, rather
# than turning verification off.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
SCREENER = "https://www.screener.in/company/{sym}/{view}/"
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def _get(url: str, timeout: int = 60) -> requests.Response:
    r = requests.get(url, headers={"User-Agent": UA, "Referer": "https://www.screener.in/"}, timeout=timeout)
    r.raise_for_status()
    return r


def company_page(sym: str) -> tuple[str, BeautifulSoup]:
    """screener.in's company page (consolidated where it exists)."""
    for view in ("consolidated", ""):
        url = SCREENER.format(sym=sym, view=view).replace("//", "/").replace("https:/", "https://")
        try:
            soup = BeautifulSoup(_get(url).text, "html.parser")
        except requests.HTTPError:
            continue
        if soup.select(".documents.concalls li"):
            return url, soup
    raise LookupError(f"{sym}: no earnings calls listed on screener.in")


def calls(sym: str) -> tuple[str, list[dict]]:
    """Company name and its calls with a transcript, newest first: [{label, month, url}]."""
    url, soup = company_page(sym)
    name = (soup.select_one("h1") or soup.select_one("title")).get_text(" ", strip=True).split(" share price")[0]
    out = []
    for li in soup.select(".documents.concalls li"):
        label_el = li.select_one("div")
        label = label_el.get_text(" ", strip=True) if label_el else ""
        link = next((a.get("href") for a in li.select("a") if a.get_text(strip=True) == "Transcript"), None)
        m = re.match(r"([A-Z][a-z]{2})\s+(\d{4})", label)
        if link and m:
            out.append({"label": label, "month": f"{m.group(2)}-{MONTHS[m.group(1)]:02d}", "url": link})
    return name, out


def text_of(call: dict, sym: str) -> str:
    """The transcript's text, downloaded and extracted once."""
    key = hashlib.sha1(call["url"].encode()).hexdigest()[:12]
    out = DATA / "research" / sym / "transcripts" / f"{call['month']}-{key}.txt"
    if out.exists():
        return out.read_text()
    from io import BytesIO
    from pypdf import PdfReader
    pdf = _get(call["url"], timeout=120).content
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(pdf)).pages)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    return text


# A quarterly earnings call names a quarter or its results. Transcripts often
# open with a cover letter, so look past it. Special calls (an investor day,
# a segment update) name themselves near the top and are left out.
EARNINGS = re.compile(r"\b(q[1-4]\s?(fy)?\s?'?\d{2}|quarter ended|first quarter|second quarter|third quarter|"
                      r"fourth quarter|quarterly results|results for the (quarter|period)|h1\s?fy|half year|"
                      r"earnings (conference )?call|results (conference )?call|post[- ]results|financial results)\b", re.I)
SPECIAL = re.compile(r"investor day|analyst day|capital markets day|update[- ]on[- ](the[- ])?[a-z]+[- ](segment|business)", re.I)


def is_earnings_call(text: str, url: str = "") -> bool:
    """Earnings calls say 'quarter' and 'results' again and again. A special
    call names itself in its title or file name and says them rarely."""
    hits = len(EARNINGS.findall(text[:15000]))
    if hits < 6 and SPECIAL.search(url + " " + text[:1500]):
        return False
    return hits >= 2


def last_four(sym: str) -> tuple[str, list[dict]]:
    """The four most recent earnings calls, one per month, newest first, with text."""
    name, found = calls(sym)
    picked, months = [], set()
    for c in found:
        if c["month"] in months:
            continue
        try:
            text = text_of(c, sym)
        except Exception:
            continue
        if len(text) < 3000 or not is_earnings_call(text, c["url"]):
            continue
        picked.append({**c, "text": text})
        months.add(c["month"])
        if len(picked) == 4:
            break
    return name, picked


# ---------- trimming for the model ----------

FORWARD = re.compile(r"\b(guid|expect|target|outlook|aim|plan|will\b|would\b|should\b|going forward|next (year|quarter)|"
                     r"fy ?\d{2}|fy\d{4}|h[12]|by the end|run[- ]rate|sustain|trajectory|on track|confident|deliver|"
                     r"achiev|commission|capex|capacity|ramp|pipeline|order book|margin|growth|grow)\w*", re.I)
NUMBER = re.compile(r"\d")


def sentences(text: str) -> list[str]:
    t = re.sub(r"\s+", " ", text)
    return [s.strip() for s in re.split(r"(?<=[.?!])\s+(?=[A-Z])", t) if len(s.strip()) > 25]


def trim(text: str, limit_chars: int = 42000) -> str:
    """Sentences with a number or a forward-looking word: what guidance and
    results are made of. Usually a third to a half of the call."""
    keep = [s for s in sentences(text) if NUMBER.search(s) or FORWARD.search(s)]
    out, n = [], 0
    for s in keep:
        if n + len(s) > limit_chars:
            break
        out.append(s)
        n += len(s) + 1
    return " ".join(out)


def squash(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())
