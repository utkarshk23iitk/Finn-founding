"""On-demand research for any NSE ticker: GET /api/research?symbol=TCS

Runs the same pipeline as `python run.py research TCS`, writing only to /tmp.
The CDN keeps each answer for a day, so a second look costs nothing.
"""
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("FINN_DATA_DIR", "/tmp/finn")
os.environ.setdefault("FINN_LLM_CACHE", "/tmp/finn/llm_cache")
os.environ.setdefault("FINN_ON_DEMAND", "1")   # a visitor is waiting: fast model, short timeouts
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import research  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        sym = (q.get("symbol") or [""])[0].upper().strip()
        if not re.fullmatch(r"[A-Z0-9&-]{1,20}", sym):
            return self._send(400, {"error": "Give an NSE symbol, for example ?symbol=TCS"})
        try:
            self._send(200, research.research(sym), cache=True)
        except LookupError as e:
            self._send(404, {"error": str(e)})
        except Exception as e:  # report, don't crash: the page shows the message
            self._send(502, {"error": f"Research failed ({type(e).__name__}): {str(e)[:200]}"})

    def _send(self, code, body, cache=False):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        # A fixed length, not chunked transfer: browsers speak HTTP/2, which has no chunked
        # encoding, and a chunked reply broke there ("framing layer" errors) while curl over 1.1 worked.
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800" if cache else "no-store")
        self.end_headers()
        self.wfile.write(data)
