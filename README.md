# FINN

A mobile-first investment agent for Indian equities, built for the ENAM
Holdings Founding AI Engineer Build Challenge.

FINN has three layers:

- **Push:** what changed across the portfolio, and why it matters.
- **Pull:** research on any NSE ticker, from annual reports and call
  transcripts only.
- **Network:** who in the investor's own network can help explain it,
  shown inside Push and Pull.

Work in progress. Decisions are recorded in `docs/DECISIONS.md`.

## Run the pipeline

Python 3.11 or later.

```bash
pip install -r requirements.txt
python run.py prices
python run.py filings --days 30
```

Data is cached in `data/`; the app reads only from the cache.

## Tests

```bash
python -m pytest -q   # every fact about a real person is in their filing
npm test              # the network engine (Node 22)
```

## The demo network is synthetic

`data/network/demo_network.json` holds 45 made-up contacts. Their employers
and schools are real so that links to real executives can be computed, but
the people are fictional. Facts about real executives come only from their
companies' NSE filings (`data/people/executives.json`), each with the exact
words it rests on.
