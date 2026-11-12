"""End-of-day price and volume.

History comes from Yahoo Finance (NSE tickers end in .NS). Yahoo's newest bar
is often incomplete late at night (volume present, close missing), so the last
week is taken from NSE's own end-of-day file, the bhavcopy, which wins
wherever both have a day.
"""
import csv
import io
import zipfile
from datetime import date, timedelta

import pandas as pd
import requests
import yfinance as yf

from .config import DATA, PRICE_HISTORY
from .nse import NSE

PRICES = DATA / "prices"
BHAV = DATA / "raw" / "bhav"
BHAV_URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d}_F_0000.csv.zip"


def yahoo_symbol(symbol: str) -> str:
    return f"{symbol}.NS"


def bhavcopy(day: date, nse: NSE) -> dict[str, dict]:
    """NSE's end-of-day file for one day: symbol -> bar. Empty on holidays."""
    try:
        path = nse.download(BHAV_URL.format(d=day.strftime("%Y%m%d")),
                            BHAV / f"{day:%Y%m%d}.csv.zip")
    except requests.HTTPError:
        return {}
    with zipfile.ZipFile(path) as z:
        rows = csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), "utf-8"))
        return {r["TckrSymb"]: {"Open": float(r["OpnPric"]), "High": float(r["HghPric"]),
                                "Low": float(r["LwPric"]), "Close": float(r["ClsPric"]),
                                "Volume": int(r["TtlTradgVol"])}
                for r in rows if r["SctySrs"] == "EQ"}


def recent_from_nse(days: int = 7, today: date | None = None) -> dict[date, dict[str, dict]]:
    today, nse, out = today or date.today(), NSE(), {}
    for k in range(days):
        d = today - timedelta(days=k)
        if d.weekday() < 5:
            bars = bhavcopy(d, nse)
            if bars:
                out[d] = bars
    return out


def fetch(symbols: list[str], period: str = PRICE_HISTORY) -> dict[str, int]:
    """Yahoo history for all symbols in one call, the last week from NSE; one CSV each."""
    PRICES.mkdir(parents=True, exist_ok=True)
    tickers = [yahoo_symbol(s) for s in symbols]
    df = yf.download(tickers, period=period, interval="1d", group_by="ticker",
                     auto_adjust=False, progress=False, threads=True)
    recent = recent_from_nse()
    rows = {}
    for sym, tk in zip(symbols, tickers):
        try:
            one = df[tk][["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        except KeyError:
            one = pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
        one = one[one["Volume"] > 0]
        one.index = pd.to_datetime(one.index).date
        for d, bars in recent.items():
            if sym in bars:
                one.loc[d] = bars[sym]
        one = one.sort_index()
        one.index.name = "Date"
        if len(one):
            one.round(2).to_csv(PRICES / f"{sym}.csv")
        rows[sym] = len(one)
    return rows


def load(symbol: str) -> pd.DataFrame:
    return pd.read_csv(PRICES / f"{symbol}.csv", parse_dates=["Date"], index_col="Date")
