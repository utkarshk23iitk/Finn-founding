**To:** assessment@enam.com
**Subject:** IIT Kanpur – Founding AI Engineer - 2027

Hello ENAM team,

Here is my submission for the FINN challenge.

- **Prototype (open on a phone):** https://finn-founding.vercel.app
- **Repository:** [GitHub link]
- **AI build history:** [Claude Code session export, attached]

## What I built

FINN is one idea in three views: **every item ends with a person.** It tells
you what changed, why it matters, and who in your own network can explain it.

**Today (Push).** A short queue with an end, not a feed: "6 things need you",
a Done button on each card, then one-liners worth a glance, then the routine
paperwork folded into counts. 280 real NSE filings across an 18-company
portfolio are ranked by rules, not a model.

- When NSE's description is generic, FINN reads the filing letter itself.
  That changed real rankings: CG Power's "Action(s) taken or orders passed"
  was a pollution board order to close a plant, stayed by the High Court the
  next day; Bharti Airtel's five filings under the same title were routine
  telecom-department notices.
- Results cards show Revenue, EBITDA, PBT and PAT, QoQ and YoY, read by code
  from each filing's XBRL, with a line written from the numbers: "Alkem:
  Revenue +13.8% YoY, PAT −14.4% · tax took 33% of PBT against 13% a year
  ago."
- Leadership changes show the incoming person's profile from the company's
  own filing, and your best route to them: for Apollo Tyres' new CFO, a
  contact who spent 2008–2016 in KPMG's tax practice with him.
- Each card lists the company's other material filings that month, so
  Alkem's new CFO sits next to its forensic audit and its new CEO.
- Price and volume alerts use your thresholds (volume against the 20-day
  median, so one results day can't hide the next spike), and join the filing
  that explains them. A move nothing explains says so.

**Research (Pull).** Promised vs delivered for any NSE ticker, from its last
four earnings calls only. [After the research run: what the four prepared
companies show, in one or two lines.] The page leads with how many settled
promises were delivered, shows misses first, and tracks each promise across
the four calls, so a quietly changed target is visible. Every quote opens to
the transcript.

**Network.** Woven into both views above, and also asked directly: type a
company, a theme or a person. "Amber" returns the contact who ran the plant
of the company Amber just took over. A route always shows two separate
signals: how well the contact knows the person or company, and how long
since you last spoke. "Worth a call" suggests stale contacts whose company
just had news.

## Key decisions

1. **Code does what code can do.** Ranking, headlines, results maths,
   network matching, deadlines and numeric verdicts are code. A model is
   used only to read transcripts, where reading is the job.
2. **Checks decide trust, not the model.** Every quote from a transcript or
   filing must appear word for word; facts about real people carry the
   filing line they rest on (43 checks). [After the run: N quotes dropped,
   N verdicts overruled by numbers or dates.]
3. **Facts about real people come only from their filings.** Some filed
   profiles are rich, some name no past employer (Alkem's new CEO and CFO).
   When a profile is thin, FINN says so and points to who knows the company,
   instead of filling the gap.
4. **Built for a morning scan.** One card per company and category, one
   contact per card with the rest a tap away, leadership filings as one
   line each ("Jayant Balan named MD"), routine filings as counts.

## Architecture

![Architecture](architecture.svg)

**Data pipelines.** Python, run from a laptop, writes a cache (`data/`) and
static JSON for the app. NSE gives filings for the whole market in one
request per week (filtered to the portfolio; it matched per-company requests
exactly), each quarter's results as XBRL, and the end-of-day bhavcopy, which
fills the latest day that Yahoo leaves without a close. Transcripts come
from the links screener.in lists, which point to the company's own filings.
Names are linked across sources with an alias map for companies and schools
and a name rule (surname plus compatible initials) that also needs a shared
employer, so a common name can't make a false match.

**Data security and privacy.** The investor's network never leaves the
phone. The matching engine runs in the browser, and the site's Content
Security Policy allows connections only to its own origin, so the page
cannot send a contact anywhere even by mistake; a test also fails if the
engine gains any network call. Models never see contact data: the research
model reads only public transcripts. The demo network is 45 synthetic people
(stated in the app); real executives' facts come from public filings, each
with its source. In a real deployment, the investor would import their own
data on the device (their LinkedIn data export, contacts, calendar for
last-spoken dates), stored encrypted with a key held by the device; FINN
would keep only what matching needs (employers, schools, years, how they
met, last contact), delete it when a contact is removed, and sync, if at
all, end-to-end encrypted. Fuller career histories of contacts would come
only with their consent or from a licensed provider. For a team, each person
keeps their own network; nothing is pooled on a server.

**Models and agents.** Gemini on the free tier, routed by difficulty:
Flash-Lite extracts guidance and reported numbers from each transcript
(sentences without numbers or forward-looking words are trimmed first),
then one Flash call judges each company's promises. Answers are cached by
their full input, so a second look is free. [After the run: N calls, N
tokens for four companies.] There are no autonomous agents: the pipeline is
a fixed sequence where code plans and checks, and the model only reads.

**Cloud.** Vercel serves the static app and one Python function,
`/api/research`, which researches any ticker on demand (about a minute the
first time) and is cached at the edge for a day. No database: the data is
public and the private part lives on the phone.

## Deliberately left out

- **Real LinkedIn data.** Profiles of real people come from filings;
  contacts are synthetic, as the brief allows.
- **Scheduled refresh and phone notifications.** The data is a snapshot
  (13 Nov, 2:16 am), refreshed by running the pipeline.
- **The other research sections** (business snapshot, balance sheet, bull
  and bear). I chose to do promised vs delivered well.
- **Accounts and an import screen** for the investor's own contacts.

## Where it goes next

- A nightly job, and notifications for the cards that need you.
- On-device import of the investor's own network, encrypted at rest.
- Research sections from the annual report, with the same quote checks.

All decisions, and the real cases behind them, are in `docs/DECISIONS.md`.

Thank you,
[Your name]
