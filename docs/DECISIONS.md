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
6. **The exchange's own file settles the latest day.** At 2 am Yahoo's
   12 Nov bar had volume but no close. NSE's bhavcopy had the full bar, so
   the last week comes from NSE, Yahoo supplies the year of history, and
   NSE wins where both have a day. On shared days the two agree exactly.
7. **Unusual volume is measured against the median, not the mean.** Wipro
   traded 4.8m shares on 12 Nov against a 20-day mean pulled up by 74m on
   its results day. A mean lets one results day hide the next spike.
8. **Facts about real people come only from their companies' filings.**
   SEBI requires a brief profile with every senior appointment. Some are
   rich (Apollo Tyres' new CFO: 16 years as a KPMG India tax partner, Shri
   Ram College of Commerce); some name no past employer at all (Alkem's new
   CEO and CFO). When a profile is thin, FINN says so and points to the
   contact who knows the company instead of filling the gap from a model.
