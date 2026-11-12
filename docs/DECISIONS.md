# Decisions

Short record of the choices that shape FINN, and why. Newest last.

## Friday 13 Nov: data sources and portfolio

1. **Every source was probed before any code was written.** From a laptop:
   Yahoo Finance prices work; NSE's announcement feed works without a
   cookie warm-up and returns the whole market for a date range; screener.in
   lists transcripts as BSE PDF links.
2. **Results come from the filing's XBRL, read by code.** NSE's older
   results endpoints stop at Dec 2024, because SEBI moved results into
   "Integrated Filing" in 2025. The integrated-filing feed links each
   quarter's XBRL file, which carries revenue, PBT, tax, PAT, finance costs
   and depreciation in exact rupees. So the results card needs no model, and
   there is no unit to misread.
3. **Filings are fetched market-wide, then filtered.** One request per week
   of filings covers every company, instead of one per company. Changing the
   portfolio needs no new download.
4. **The portfolio was chosen from real filings.** A month of filings at
   Nifty 500 companies showed which ones had fresh senior changes (Alkem's
   new CEO and CFO, Dabur's Global CEO leaving, new CFO at Apollo Tyres, new
   MD at Voltas). Three themes are deep enough for an expertise map:
   specialty chemicals, rural lending, electronics and chips. Four
   portfolio companies filed results on 12 Nov, so "last 24 hours" opens
   with real items.
5. **Research companies give numeric guidance.** Infosys, Dixon, SRF and
   CreditAccess Grameen state targets on growth or margins, which "promised
   vs delivered" needs. Each also sits in one of the portfolio's themes.
