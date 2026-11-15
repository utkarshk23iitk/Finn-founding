# FINN

A mobile-first investment agent for Indian equities, built for the ENAM
Holdings Founding AI Engineer Build Challenge.

FINN has three layers:

- **Push:** what changed across the portfolio, and why it matters.
- **Pull:** research on any NSE ticker, from annual reports and call
  transcripts only.
- **Network:** who in the investor's own network can help explain it,
  shown inside Push and Pull.

**Try it on a phone:** https://finn-founding.vercel.app

**Writeup:** [docs/WRITEUP.md](docs/WRITEUP.md) · **Decisions:** [docs/DECISIONS.md](docs/DECISIONS.md) · **Architecture:** [docs/architecture.svg](docs/architecture.svg)

Work in progress. Decisions are recorded in `docs/DECISIONS.md`.

## Run the pipeline

Python 3.11 or later.

```bash
pip install -r requirements-pipeline.txt
python run.py prices            # a year of daily prices; the last week from NSE
python run.py filings --days 30 # NSE filings for the portfolio
python run.py results           # Revenue, EBITDA, PBT, PAT from each filing's XBRL
python run.py export            # rank filings and write web/data/ for the app
python run.py research INFY     # promised vs delivered (needs GEMINI_API_KEY in .env)
```

Data is cached in `data/`; the app reads only from the cache. `web/` is a
static site with no build step, and `api/research.py` researches any ticker
on demand. `vercel deploy --prod` publishes both. The architecture is in
`docs/architecture.svg`; the writeup in `docs/WRITEUP.md`.

## Tests

```bash
python -m pytest -q   # quotes in filings, ranking rules, research checks
npm test              # network engine, Today logic, views (Node 22)
```

## The demo network is synthetic

`data/network/demo_network.json` holds 45 made-up contacts. Their employers
and schools are real so that links to real executives can be computed, but
the people are fictional. Facts about real executives come only from their
companies' NSE filings (`data/people/executives.json`), each with the exact
words it rests on.
