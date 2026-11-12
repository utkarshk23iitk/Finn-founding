"""FINN pipeline CLI.

    python run.py prices            # end-of-day bars for the portfolio
    python run.py filings --days 30 # NSE announcements for the portfolio
    python run.py export            # rank filings, write web/data/ for the app
"""
import argparse

from pipeline import export, filings, prices
from pipeline.config import PORTFOLIO


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", choices=["prices", "filings", "export"])
    p.add_argument("--days", type=int, default=30, help="filings: how many days back")
    args = p.parse_args()
    symbols = list(PORTFOLIO)

    if args.step == "prices":
        rows = prices.fetch(symbols)
        missing = [s for s, n in rows.items() if n == 0]
        print(f"prices: {sum(rows.values())} rows for {len(rows) - len(missing)} of {len(rows)} companies")
        if missing:
            print("  no data:", ", ".join(missing))
    elif args.step == "filings":
        counts = filings.update(symbols, days=args.days)
        print(f"filings: {sum(counts.values())} items for {len(counts)} companies")
        for s, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"  {s:11} {n}")
    elif args.step == "export":
        r = export.export()
        print(f"export: {r['filings']} filings ({r['high']} high, {r['medium']} medium, {r['low']} low), "
              f"as of {r['as_of']}, prices to {r['last_price_day']}")


if __name__ == "__main__":
    main()
