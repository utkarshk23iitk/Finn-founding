"""A small Gemini client: JSON out, cached on disk, polite with the free tier.

Two models, priced by difficulty: a cheap one reads transcripts in bulk, a
stronger one makes the single judgment per company. Every call is cached by
its full input, so a second look costs nothing.
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

import requests

from .config import DATA, ROOT

API = "https://generativelanguage.googleapis.com/v1beta"
CACHE = Path(os.environ.get("FINN_LLM_CACHE") or DATA / "llm_cache")
USAGE = DATA / "llm_usage.jsonl"


def api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.strip().startswith("GEMINI_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set (put it in .env or the environment)")
    return key


def _version(name: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", name.split("gemini-")[-1])[:2]) or (0,)


_models: dict | None = None


def models() -> dict:
    """The newest stable Flash-Lite and Flash this key can use, from the API's own list.
    GEMINI_EXTRACT_MODEL / GEMINI_JUDGE_MODEL override."""
    global _models
    if _models:
        return _models
    r = requests.get(f"{API}/models", params={"pageSize": 200}, headers={"x-goog-api-key": api_key()}, timeout=30)
    r.raise_for_status()
    names = [m["name"].split("/", 1)[1] for m in r.json().get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", [])]
    usable = [n for n in names if n.startswith("gemini-") and not re.search(r"preview|exp|tts|image|live|audio|embed|thinking|robotics|computer", n)]

    def newest(pred):
        c = sorted((n for n in usable if pred(n)), key=_version, reverse=True)
        return c[0] if c else None

    lite = newest(lambda n: "flash-lite" in n)
    flash = newest(lambda n: "flash" in n and "lite" not in n)
    # On demand (a visitor waiting on a phone), speed matters more than the stronger judge:
    # the fast model judges too, and code's checks on quotes, dates and numbers still apply.
    fast = os.environ.get("FINN_ON_DEMAND") == "1"
    _models = {"extract": os.environ.get("GEMINI_EXTRACT_MODEL") or lite or flash,
               "judge": os.environ.get("GEMINI_JUDGE_MODEL") or ((lite or flash) if fast else (flash or lite)),
               "available": sorted(usable)}
    return _models


def generate(prompt: str, *, system: str, schema: dict, role: str = "extract", model: str | None = None,
             tag: str = "") -> tuple[dict, dict]:
    """JSON matching `schema`, and a record of which model answered and the tokens used."""
    model = model or models()[role]
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": schema},
    }
    key = hashlib.sha256(json.dumps([model, body], sort_keys=True).encode()).hexdigest()
    cached = CACHE / f"{key}.json"
    if cached.exists():
        hit = json.loads(cached.read_text())
        return hit["data"], {**hit["usage"], "cached": True}

    for attempt in range(6):
        try:
            r = requests.post(f"{API}/models/{model}:generateContent", json=body,
                              headers={"x-goog-api-key": api_key()},
                              timeout=75 if os.environ.get("FINN_ON_DEMAND") == "1" else 240 if role == "judge" else 120)
        except (requests.Timeout, requests.ConnectionError):
            if attempt >= (2 if role == "judge" else 5):
                raise   # the caller may fall back to another model
            time.sleep(5 * (attempt + 1))   # slow or dropped answers are retried; finished calls are cached
            continue
        if r.status_code in (429, 500, 503):
            if role == "judge" and attempt >= 1:
                raise RuntimeError(f"{model}: busy or out of free-tier quota ({r.status_code})")   # caller falls back
            wait = 8 * (attempt + 1)
            m = re.search(r'"retryDelay":\s*"(\d+)s"', r.text)
            if m:
                wait = int(m.group(1)) + 2
            time.sleep(min(wait, 65))
            continue
        r.raise_for_status()
        out = r.json()
        try:
            text = out["candidates"][0]["content"]["parts"][0]["text"]
            data = json.loads(text)
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            if attempt < 2:
                continue
            raise RuntimeError(f"{model}: unreadable answer ({e})") from e
        meta = out.get("usageMetadata", {})
        usage = {"model": model, "tag": tag, "in": meta.get("promptTokenCount", 0),
                 "out": meta.get("candidatesTokenCount", 0) + meta.get("thoughtsTokenCount", 0)}
        CACHE.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps({"data": data, "usage": usage}))
        try:
            with USAGE.open("a") as f:
                f.write(json.dumps({**usage, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
        except OSError:
            pass
        return data, {**usage, "cached": False}
    raise RuntimeError(f"{model}: still rate-limited after retries")
