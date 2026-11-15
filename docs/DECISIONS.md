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
   Each fact carries the exact words it rests on, and a test checks every
   quote against the cached filing (43 checks, including one that must
   catch a changed year or employer).

## Friday 13 Nov: the network

9. **What the investor gives FINN.** A contact list with each person's
   career and education, how they met, a 1–5 closeness and the date they
   last spoke. In real use that is the investor's own LinkedIn data export
   (they own it), their calendar for last-contact dates, and their notes;
   fuller career histories would need the contact's consent or a licensed
   people-data provider. The demo uses 45 synthetic contacts with real
   employers and schools, so links to real executives can be computed.
10. **The network never leaves the phone.** Matching runs in the browser
    against public data (filings, filed profiles, a company map). No
    contact is sent to a server or a model. A test fails if the engine
    gains any network call.
11. **Real and synthetic never mix.** Real people's facts come only from
    filings. The contacts are fictional, labelled as such, and a test
    checks that none shares a name with a real executive.
12. **A link is evidence, not a guess.** Same employer with overlapping
    years (more if in the same function), the same intake, or the same
    school. Each employer counts once. When a filing gives no years, FINN
    says "the filing doesn't say when" and the link is medium at most.
    Sharing only a boundary year (one left in 2001, the other joined in
    2001) does not count as working together.
13. **A route is two numbers, shown separately.** How well the contact
    knows the person, and how close the investor is to the contact. For
    Voltas' new MD, Meera knows him better (7 years at Voltas, then 4 at
    Voltbek while he was its CEO), but you last spoke a year ago. Vikram
    joined the Tata Administrative Service in the same 1999 intake and you
    spoke last month. FINN shows both, not one blended score.
14. **For "who knows this company", knowledge beats closeness.** Inside
    knowledge comes first and closeness breaks ties. Specialists are matched
    to the kind of event: a former drug regulator for a plant inspection, a
    securities lawyer for a SEBI letter, an executive-search partner for a
    new CEO. The first version also suggested a consumer-company CFO for
    Amber's acquisition and a drug regulator for Dabur's SEBI letter; both
    were wrong, and tests now forbid them.
15. **Ownership chains count.** Ascent Circuits belongs to IL JIN, which
    belongs to Amber. The first version looked only one level down and
    missed the best person for Amber's acquisition: Farhan, who ran Ascent's
    plant until 2023.

## Friday 13 Nov: the Today screen (Push)

16. **Rules rank filings; no model.** Category (what a filing is) and
    priority (how much it should interrupt) are separate. Headlines come
    from NSE's own line; when that is generic, from the letter's "Sub:"
    line; when that says only "Disclosure under Regulation 30", from its
    first "we wish to inform you that" sentence. Reading the letter
    changed real rankings: CG Power's "Action(s) taken or orders passed"
    was a pollution board order to close a plant (5 Nov), stayed by the
    High Court the next day; Bharti Airtel's five filings under the same
    title were routine telecom-department notices.
17. **A short queue with an end, not a feed.** It opens with "6 things need
    you", each card has Done, and the list ends with "That's everything
    that needs you". Below it: one-liners worth a glance, then routine
    paperwork folded into counts.
18. **One card per company and category.** Voltas filed four leadership
    changes on 6 Nov; they are one card, each filing one line ("Jayant
    Balan named MD"), not four paragraphs of legal prose.
19. **A move joins the filing that explains it.** Alkem traded 10.6x its
    median volume on 12 Nov, when it filed results and named a new CFO.
    Results win ties, so the move sits on the results card. A move with
    no filing behind it gets its own card that says so, ranked by size.
20. **Every material card ends with a person.** One name is shown, the rest
    are a tap away, each with two signals: how well they know the company
    or person, and how long since you last spoke.
21. **Context from the same company.** Each card lists the company's other
    material filings from the month. Alkem's new CFO sits next to its
    forensic audit (21 Oct, alleged misappropriation by a former employee)
    and its new CEO (3 Nov). Read one at a time, those look routine.
22. **Windows count back from the snapshot time**, shown in the header, so
    the queue is the same whenever it is opened.
23. **The browser enforces the privacy rule.** The site is static on
    Vercel. Its Content Security Policy allows connections only to its own
    origin, so the page cannot send contacts anywhere even if the code
    tried. Thresholds and Done marks stay in the phone's local storage.
24. **Known limits.** The data is a snapshot (13 Nov, 2:16 am), refreshed
    by running the pipeline on a laptop; there is no scheduled refresh or
    push notification yet. Results cards still show the quarter, not the
    numbers; that is next.

## Sunday 15 Nov: results, research (Pull) and the Network view

25. **Results come from the filing's XBRL, computed by code.** Revenue,
    EBITDA, PBT and PAT, QoQ and YoY, for all 18 companies, with no model.
    EBITDA = PBT + finance costs + depreciation − other income − exceptional
    items; lenders get none. A check requires PAT to equal PBT less tax plus
    any profit booked after tax; all 18 pass. The headline line is written
    from the numbers, which surfaces stories on its own: Alkem's PAT fell 14%
    while PBT rose 12% because tax took 33% of PBT against 13% a year ago.
26. **Percentages around a loss mislead.** Amber's loss doubling read as
    "PAT −106%". Code now says "loss widened", "loss narrowed", "swung to a
    loss" or "swung to a profit".
27. **Research reads only the company's own calls.** The last four quarterly
    transcripts, found through screener.in and read from the company's
    filings. Special calls (a segment update) are left out; two real earnings
    calls that the first filter wrongly dropped are back in. One company site
    (srf.com) sends an incomplete certificate chain; the fix verifies against
    the system trust store rather than turning verification off.
28. **Two models, priced by difficulty.** Flash-Lite extracts guidance and
    reported numbers from each call, after code trims each transcript to
    sentences with numbers or forward-looking words (30–55% of the text).
    One Flash call judges each company. About 45,000 tokens per company on
    the free tier; cached, so a second look is free.
29. **The first research run was wrong in a way only reading it showed.**
    Dixon guides per business. "₹5,500–6,000 crore this fiscal" (one
    segment) was judged "delivered" against company revenue of ₹48,893
    crore, and three businesses' FY27 targets were merged into one fake
    revision. Fixes: extraction records the segment; promises group by
    segment, metric and horizon; loosely named segments ("telecom network
    business", "telecom") merge; the judge is told to compare like with like;
    and code refuses to settle a rupee target against a number more than 3x
    away, marking it "can't tell".
30. **"Went quiet" needs evidence.** The judge first saw only the handful of
    numbers extracted from later calls, so it called promises dropped that
    later calls did discuss. Code now gives it, per promise, the sentences
    from later transcripts that share the promise's words and segment.
31. **A changed target says which way.** Infosys cut FY27 revenue-growth
    guidance twice (1.5–3.5%, then 1.5–3%, then 1–2%); CreditAccess Grameen
    raised ROA and ROE guidance and lowered its credit-cost and cost-to-income
    targets. Code works out the direction (inverted for lower-is-better
    metrics) and the page says Raised or Cut.
32. **Any ticker, on demand.** `/api/research?symbol=X` runs the same
    pipeline on Vercel and the CDN keeps each answer for a day; the four
    prepared companies load as static files.
33. **The Network can be asked directly.** Type a company, a theme or a
    person: who worked there, at a competitor, supplier or customer; the
    go-to people on a theme; who can reach a named executive.
34. **A visitor waiting gets a time budget.** The first on-demand test (TCS)
    hit Vercel's 5-minute limit while waiting on the slow stronger model, and
    browsers, which speak HTTP/2, dropped replies that took more than about
    75 seconds. On demand now: the fast model judges too, calls time out at
    35s, a busy model hands over to an older fast one, an unreadable call is
    skipped if two others are readable, and the judge is skipped after 40s
    (code's checks still apply; unjudged promises past their deadline say
    "can't tell"). Replies carry a fixed length. Fresh tickers answered in
    9–51 seconds.
35. **No targets is a finding.** TCS's and Britannia's last four calls gave no
    forward number or date. The page says so and shows what they reported,
    instead of an empty ledger.
36. **The Push tab is "Updates", not "Today".** "Today" next to window
    chips for 3 days, a week and a month read as a contradiction, and more so
    with a snapshot two days old. Time words now live only in the chips.
37. **A measured UI review, then fixes.** Every screen was checked at 375px
    in light and dark, with contrast, tap-target and text-size measurements.
    Light mode failed WCAG AA contrast in about 130 places (grey at 3.2–3.7:1,
    amber at 3.5–4.0:1), 55 texts were under 12px, 39 tap targets were under
    24px, and there was no main heading. After the fixes: 0 contrast failures
    in light and dark, nothing under 12px, a main heading on every view, and
    every control at least 32px tall except month links inside a sentence
    (exempt). Clarity fixes from the same review: "As of" moved off the
    window chips so "Month" shows; Dixon's headline no longer says "0 of 1
    settled promises delivered" but "1 target cut · 2 changed · 1 went quiet
    · 5 still open"; promise rows read full width; a cut shows its size; the
    pill, legend and bar share one vocabulary (Cut, Raised, Target changed);
    a company's cards sit together; a flat day reads 0.0%, not a red −0.0%;
    the sparkline is captioned.
