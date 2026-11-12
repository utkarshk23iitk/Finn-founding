"""Small NSE client: polite pacing, retries, and a cookie warm-up if NSE asks."""
import time
from pathlib import Path

import requests

from .config import REQUEST_PAUSE

BASE = "https://www.nseindia.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


class NSE:
    def __init__(self, pause: float = REQUEST_PAUSE):
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": BASE + "/",
        })
        self.pause = pause
        self._last = 0.0

    def _wait(self):
        gap = time.monotonic() - self._last
        if gap < self.pause:
            time.sleep(self.pause - gap)
        self._last = time.monotonic()

    def _warm_up(self):
        # NSE sometimes wants its cookies first. The home page itself may
        # return 403 and still set them, so the status is ignored.
        try:
            self.s.get(BASE + "/", timeout=15)
        except requests.RequestException:
            pass

    def get(self, url: str, params: dict | None = None, timeout: int = 60) -> requests.Response:
        """GET with up to 3 attempts; raises on the last failure."""
        for attempt in range(3):
            self._wait()
            try:
                r = self.s.get(url, params=params, timeout=timeout)
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code in (401, 403):
                self._warm_up()
            elif r.status_code in (429, 500, 502, 503, 504):
                time.sleep(3 * (attempt + 1))
            else:
                r.raise_for_status()
                return r
        r.raise_for_status()
        return r

    def api(self, path: str, **params):
        return self.get(f"{BASE}/api/{path}", params=params).json()

    def download(self, url: str, dest: Path) -> Path:
        """Save a file once; later calls reuse it."""
        if dest.exists() and dest.stat().st_size > 0:
            return dest
        dest.parent.mkdir(parents=True, exist_ok=True)
        r = self.get(url, timeout=120)
        dest.write_bytes(r.content)
        return dest
