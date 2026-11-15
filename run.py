"""FINN pipeline CLI.

    python run.py prices            # end-of-day bars for the portfolio
    python run.py filings --days 30 # NSE announcements for the portfolio
    python run.py export            # rank filings, write web/data/ for the app
    python run.py research INFY DIXON   # promised vs delivered from the last four calls
"""
import argparse

from pipeline import export, filings, prices
from pipeline.config import PORTFOLIO, RESEARCH


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", choices=["prices", "filings", "export", "research"])
    p.add_argument("symbols", nargs="*", help="research: NSE symbols (default: the research list)")
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
    elif args.step == "research":
        from pipeline import research
        for sym in args.symbols or list(RESEARCH):
            r = research.research(sym)
            research.save(r)
            counts = {}
            for p_ in r["promises"]:
                counts[p_["verdict"]] = counts.get(p_["verdict"], 0) + 1
            u = r["usage"]
            print(f"{sym}: {len(r['promises'])} promises {counts} · {u['calls']} model calls ({u['cached']} cached), "
                  f"{u['tokens_in'] + u['tokens_out']:,} tokens · {r['checks']['quotes_dropped']} quotes dropped, "
                  f"{r['checks']['overrides']} overrides")
    elif args.step == "export":
        r = export.export()
        print(f"export: {r['filings']} filings ({r['high']} high, {r['medium']} medium, {r['low']} low), "
              f"as of {r['as_of']}, prices to {r['last_price_day']}")


if __name__ == "__main__":
    main()
