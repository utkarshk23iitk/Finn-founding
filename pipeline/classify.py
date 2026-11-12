"""Rules that sort NSE filings into categories, rank them, and write a headline.

Category is what a filing is; priority is how much it should interrupt the
investor. They are kept apart: a results date notice and the results are
both "results", but only one of them matters today.

No model is used. NSE's own one-line text names most filings; when it is
generic ("informed the Exchange about Acquisition"), the PDF's "Sub:" line
almost always says what the filing is.
"""
import re

HIGH, MEDIUM = 70, 40          # priority cut-offs: needs you / worth a glance / routine

# Filings that are compliance paperwork whatever they say.
ROUTINE = {
    "certificate under sebi (depositories and participants) regulations, 2018": "Depository certificate",
    "trading window": "Trading window",
    "statement of deviation(s) or variation(s) under reg. 32": "Use of funds statement",
    "monitoring agency report": "Monitoring agency report",
    "utilisation of funds": "Use of funds statement",
    "esop/esos/esps": "Employee share options",
    "copy of newspaper publication": "Newspaper notice",
    "loss of share certificates": "Lost share certificate",
    "duplicate share certificate": "Lost share certificate",
    "related party transactions": "Related-party disclosure",
    "shareholders meeting": "Shareholder meeting",
    "postal ballot": "Postal ballot",
}

SENIOR = re.compile(r"\b(ceo|chief executive|managing director|md|cfo|chief financial|chairman|chairperson|"
                    r"whole[- ]?time director|executive director|vice[- ]chairman)\b", re.I)
LEAVING = re.compile(r"\b(resign|cessation|ceased|retire|superannuat|demise|step(ping)? down|relinquish)", re.I)
GENERIC = re.compile(r"^(change in management|acquisition|action\(s\) taken or orders passed|updates?|general updates|"
                     r"credit rating|capacity addition|investor presentation|issue of securities|"
                     r"bagging/receiving of orders/contracts|commencement of commercial production/operations|"
                     r"resignation of director/kmp/smp|initiation of forensic audit|press release|"
                     r"disclosure under regulation 30[^.]*)\.?$", re.I)

PREFIX = re.compile(r"^.*?\bhas (informed|submitted to|submitted) the exchange,?\s*(regarding|about|that|the)?\s*", re.I)
LODR = re.compile(r"(disclosure|intimation|outcome of board meeting)?\s*(under|pursuant to|in terms of)?\s*"
                  r"regulation\s*\d+[^–—:\-]*?regulations,?\s*\d{4}\s*(\(\s*as amended\s*\))?\s*(as amended)?\s*"
                  r"(\(\s*[“\"]?[^)]*?[”\"]?\s*\))?\s*(read with[^–—:\-]*)?[–—:\-]*\s*", re.I)


SUBJECT_END = (r"(?=\s(?:ref\b|ref\.|re\s*:|dear\b|reference\b|respected\b|sir\b|madam\b|pursuant\b|in accordance\b|"
               r"we\s|this\s(?:is|refers)|in terms of|with reference|further to|in continuation|kindly\b|please\b|"
               r"the board\b|in compliance)|$)")
UNINFORMATIVE = re.compile(r"^(?:(disclosure|intimation|outcome of (the )?board meeting|submission|compliance)\b[^–—\-]*|the board of directors\b.{0,80}\bmeeting\b.*)$", re.I)
INFORM_WORDS = (r"(?:we (?:wish to|would like to|hereby|are pleased to)? ?inform(?:ed|ing)?|this is to inform|hereby informed|"
                r"please note|we write to inform|we hereby submit(?: the details of)?|informing)"
                r"(?: you)?(?: the (?:stock )?exchanges?)?\b\s*(?:that)?\s*,?\s*")
INFORM = re.compile(r"\b" + INFORM_WORDS + r"(.{25,260}?)(?:\.\s|$)", re.I)
LEADIN = re.compile(r"^.{0,400}?\b" + INFORM_WORDS, re.I)
SALUTATION = re.compile(r"^[\W\s]*(?:\(s\))?[/\s]*(?:dear\s+)?(?:sirs?|madam|ma.am)\b[\W\s]*(?:(?:sirs?|madam|ma.am)\b[\W\s]*)?", re.I)
# Periods that don't end a sentence: initials (Noel N. Tata), titles, w.e.f., i.e., Rs., No.
# A lone letter after "Annexure", "Schedule" and the like is a label, and its period can end a sentence.
PROTECT = re.compile(r"\b(?:[A-Z]|i\.e|e\.g|w\.e\.f|viz|no|nos|rs|mr|ms|mrs|dr|sr|jr|ltd|pvt|co|inc|approx|st|govt)\.(?=[\s\w(,])", re.I)
LABEL_WORD = re.compile(r"\b(annexure|schedule|part|para|clause|exhibit|form|item|note|section|appendix|series)\s+$", re.I)
DOT = "․"


def _protect(t: str) -> str:
    def sub(m):
        word = m.group(0)
        if len(word) == 2 and LABEL_WORD.search(t[max(0, m.start() - 15):m.start()]):
            return word
        return word.replace(".", DOT)
    return PROTECT.sub(sub, t)

# Words that find the sentence about this kind of filing inside a long letter.
FOCUS = {
    "capex": r"capacity|plant|commission|commerciali|production|expansion",
    "M&A": r"acqui|stake|merger|amalgamat|joint venture|share swap",
    "management_change": r"appoint|resign|cessation|retire|superannuat|assumed office",
    "litigation": r"order|notice|penalt|closure|demand|warning|direction|forensic",
    "credit_rating": r"rating",
    "press_release": r"order|launch|agreement|partnership",
    "clarification": r"relates to|does not concern|no (new )?(event|development)|denies|baseless|speculative|not aware",
}
C_DETAIL = {"litigation", "M&A", "capex", "credit_rating"}
TYPE_IS_HEADLINE = {"initiation of forensic audit", "capacity addition", "commencement of commercial production/operations",
                    "credit rating", "change in auditors"}
DEPENDENT = re.compile(r"^(the said|the above|this|these|the same|further to|in continuation|as informed)\b", re.I)


def _join_split_words(s: str) -> str:
    """PDF text splits words after a capital: 'N otices' -> 'Notices'. Not 'A'/'I', which are words."""
    return re.sub(r"(?<![\w&.])([B-HJ-Z]) ([a-z]{3,})\b", r"\1\2", s)


def _sentences(text: str) -> list[str]:
    t = _protect(" ".join(text.split()))
    parts = re.split(r"(?<=[.;])\s+(?=[A-Z(\d])", t)
    return [p.replace(DOT, ".").strip() for p in parts if p.strip()]


def _tidy(s: str) -> str:
    s = _join_split_words(" ".join(s.split()))
    s = SALUTATION.sub("", s)
    s = LEADIN.sub("", s)
    s = re.sub(r"^in this regard,?.{0,120}?\b(?:submits|states|clarifies|informs)\b(?: as follows)?\s*:?\s*", "", s, flags=re.I)
    s = LODR.sub("", s).strip(" -–—:.;,/")
    s = re.sub(r"^(?:sub(?:ject)?\s*[.:\-–]+\s*)", "", s, flags=re.I)
    s = re.sub(r"^(intimation|disclosure|information|update)s?\s+(of|on|regarding|about|for|under)\s+", "", s, flags=re.I)
    return s[:1].upper() + s[1:] if s else ""


def focus_sentence(pdf_text: str, category: str) -> str:
    """First sentence of the letter body that is about this kind of filing."""
    pat = FOCUS.get(category)
    if not pat:
        return ""
    body = re.split(r"\bdear\s+(?:sirs?|madam)[^,:]{0,25}[,:]", pdf_text, maxsplit=1, flags=re.I)[-1]
    for s in _sentences(body)[:30]:
        s = _tidy(s)
        if len(s) >= 25 and re.search(pat, s, re.I) and not re.match(r"(pursuant|in accordance|in terms|kindly|request|\d+\.?$)", s, re.I):
            return s
    return ""


def subject_line(pdf_text: str) -> str:
    """What a filing letter is about: its 'Sub:' line without the regulation
    boilerplate, or, when that says only 'Disclosure under Regulation 30',
    the first 'we wish to inform you that ...' sentence."""
    t = _protect(" ".join(pdf_text.split()))
    m = re.search(r"\b(?:sub(?:ject)?\s*[.:\-–]{1,2}|re\s*:)\s*(.{8,300}?)" + SUBJECT_END, t, re.I)
    s = _tidy(m.group(1).replace(DOT, ".")) if m else ""
    if len(s) >= 15 and not UNINFORMATIVE.match(s):
        return s
    m = INFORM.search(t)
    return _tidy(m.group(1).replace(DOT, ".")) if m else s


def clean(text: str) -> str:
    s = re.sub(r"\s+", " ", text or "").strip()
    s = re.sub(r"^the exchange has sought clarification from .*? with respect to (?:a |the )?(?:recent )?news (?:item|report) captioned\s*",
               "NSE asked about a news report: ", s, flags=re.I)
    s = PREFIX.sub("", s)
    # "Pursuant to Regulation 30 ..., we wish to inform the exchange that, X" -> "X"
    if re.match(r"(?:pursuant to|in terms of|further to|in continuation of|to please refer to|with reference to|we hereby)\b", s, re.I):
        s = LEADIN.sub("", s)
    s = _join_split_words(s).strip(" .'\"")
    return s[:1].upper() + s[1:] if s else ""


def first_sentence(s: str, limit: int = 170) -> str:
    parts = _sentences(s)
    s = parts[0] if parts else s
    if len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0].rstrip(",;:(") + "…"
    return s.rstrip(".")


def is_generic(s: str) -> bool:
    return not s or bool(GENERIC.match(s)) or len(s) < 25 or bool(UNINFORMATIVE.match(s))


QUARTER = {3: ("January–March", 4), 6: ("April–June", 1), 9: ("July–September", 2), 12: ("October–December", 3)}


def results_headline(filed_iso: str) -> str:
    """'Results for July–September 2026 (Q2 FY27)': the last quarter that ended before the filing."""
    y, m = int(filed_iso[:4]), int(filed_iso[5:7])
    end_m = max(q for q in (3, 6, 9, 12) if q < m) if m > 3 else 12
    end_y = y if m > 3 else y - 1
    months, q = QUARTER[end_m]
    fy = end_y + 1 if end_m >= 6 else end_y
    return f"Results for {months} {end_y} (Q{q} FY{fy % 100:02d})"


def headline(f: dict, subject: str = "", focus: str = "") -> str:
    """NSE's own text if it says something; else the letter's subject; else
    the filing type. The detail line carries the sentence from the letter."""
    for s in (clean(f["text"]), subject):
        if not is_generic(s):
            return first_sentence(s)
    return f["nse_type"]


def analyse(f: dict, pdf_text: str = "") -> dict:
    """Everything the app needs to place one filing: category, kind, priority,
    tier, a headline and, when the letter says more, one detail sentence."""
    subject = subject_line(pdf_text) if pdf_text else ""
    c = classify(f, subject)
    clarifying = f["nse_type"].lower() in ("news verification", "rumour verification - regulation 30(11)")
    focus = focus_sentence(pdf_text, "clarification" if clarifying else c["category"]) if pdf_text else ""
    if focus:
        c = classify(f, f"{subject} {focus}")   # the focus sentence can change priority (a closure order)
    head = results_headline(f["time"]) if c["category"] == "results" and c["priority"] >= HIGH else headline(f, subject)
    # The letter's sentence is worth showing when NSE's own text says little, or
    # when the letter carries the substance (legal trouble, deals, plants).
    # One letter often covers several filings (Voltas: four appointments), so
    # a specific NSE line keeps its own words and gets no borrowed detail.
    useful = C_DETAIL.__contains__(c["category"]) or is_generic(clean(f["text"]))
    detail = first_sentence(focus, 220) if focus and useful else ""
    if detail and is_generic(head) and f["nse_type"].lower() not in TYPE_IS_HEADLINE:
        head, detail = first_sentence(detail), ""          # the letter's sentence says more than the type
    if f["nse_type"].lower() in TYPE_IS_HEADLINE:
        head, detail = f["nse_type"], first_sentence(focus or subject, 220)
    if detail and (detail.lower().startswith(head.lower()[:50]) or head.lower().startswith(detail.lower()[:50])):
        detail = ""
    return {**c, "headline": head, "detail": detail, "dependent": bool(DEPENDENT.match(head))}


def classify(f: dict, subject: str = "") -> dict:
    """category (ENAM's list), kind (for the network), priority 0-100, tier."""
    t = f["nse_type"].strip().lower()
    x = f"{f['text']} {subject}".lower()
    cat, kind, p = _rules(t, x)
    tier = "high" if p >= HIGH else "medium" if p >= MEDIUM else "low"
    return {"category": cat, "kind": kind, "priority": p, "tier": tier}


def _rules(t: str, x: str):
    if t in ROUTINE and not ("result" in x and t == "copy of newspaper publication"):
        return "unclassified", None, 5
    if t == "copy of newspaper publication":
        return "results", None, 10

    # Governance and legal trouble
    if "forensic audit" in x:
        return "litigation", "litigation", 88
    if t in ("news verification", "rumour verification - regulation 30(11)") or "clarification" in x and "news" in x:
        plant = re.search(r"plant|facility|production|quality|fda|drug|inspection", x)
        return "litigation", "regulatory" if plant else "litigation", 72 if plant else 55
    if re.search(r"(directing|direction for|order(ing|ed)?) (the )?(closure|shut ?down|suspension)|closure of (manufacturing|operations|the plant|the unit)|halt (\w+ ){0,3}production", x):
        return "litigation", "regulatory", 82
    if t == "action(s) taken or orders passed" or re.search(r"warning letter|show cause|penalt", x):
        if "department of telecommunications" in x:
            return "litigation", "litigation", 42   # licence-fee notices arrive often for telecom companies
        if "sebi" in x and "warning" in x:
            return "litigation", "litigation", 68
        if re.search(r"gst|goods and services tax|income tax|tax demand|assessment order", x):
            return "litigation", "litigation", 42
        return "litigation", "litigation", 55
    if t == "change in auditors":
        return ("litigation", "litigation", 80) if "resign" in x else ("unclassified", None, 12)

    # Results and calls
    if t in ("integrated filing- financial", "financial result updates") or \
            (t == "outcome of board meeting" and re.search(r"financial results?", x)):
        return "results", "results", 80
    if t == "board meeting intimation":
        return ("results", None, 22) if "result" in x else ("unclassified", None, 15)
    if t == "investor presentation":
        return "results", "results", 38
    if t.startswith("analysts/institutional investor meet"):
        if "transcript" in x:
            return "earnings_call", "results", 32
        if re.search(r"audio|recording|video|webcast link", x):
            return "earnings_call", None, 12
        if re.search(r"earnings call|conference call|con\. ?call|concall", x) and "schedule" not in x:
            return "earnings_call", None, 15
        return "investor_meetings", None, 8

    # People
    mgmt_types = ("appointment", "resignation", "cessation", "retirement", "change in management",
                  "change in director(s)", "resignation of director/kmp/smp", "change in key managerial personnel",
                  "change in company secretary/compliance officer", "re-appointment")
    if t in mgmt_types or re.search(r"\b(re-?appointment|appointment|resignation)\b of (mr|ms|mrs|dr)", x):
        if re.search(r"compliance officer|company secretary", x):
            return "management_change", "management_change", 22
        if re.search(r"re-?appointment|approval from the reserve bank", x):
            return "management_change", "management_change", 35
        if "independent director" in x or (re.search(r"non[- ]*executive", x) and not re.search(r"chairman|chairperson", x)):
            return "management_change", "management_change", 38
        if re.search(r"board of directors of (?!the company)|of (its|a|the) (material |wholly[- ]owned |step[- ]down )?subsidiar", x):
            return "management_change", "management_change", 45   # a subsidiary's board, not the company's
        if SENIOR.search(x):
            return "management_change", "management_change", 90 if LEAVING.search(x) else 85
        if re.search(r"chief|president|head|senior management|kmp|smp|evp|vice president", x):
            return "management_change", "management_change", 55 if not LEAVING.search(x) else 58
        return "management_change", "management_change", 45

    # Deals and capital
    if t in ("acquisition", "agreements", "amalgamation/merger", "scheme of arrangement", "joint venture") or \
            re.search(r"\b(acquisition of|acquire|share swap|merger|demerger|amalgamation)\b", x):
        if re.search(r"incorporat", x) and "joint venture" not in x:
            return "M&A", None, 20
        if "joint venture" in x:
            return "M&A", "M&A", 45
        if "rights issue" in x:
            return "M&A", "M&A", 55
        return "M&A", "M&A", 75
    if t == "credit rating" or "credit rating" in x:
        if "downgrade" in x:
            return "credit_rating", "credit_rating", 85
        if "upgrade" in x:
            return "credit_rating", "credit_rating", 60
        return "credit_rating", "credit_rating", 25
    if re.search(r"\bqip\b|qualified institutions placement|preferential|rights issue|buy-?back", x):
        return "fund_raise", "fund_raise", 70
    if t in ("issue of securities", "allotment of securities"):
        return ("unclassified", None, 5) if "esop" in x else ("fund_raise", "fund_raise", 20)
    if t in ("capacity addition", "commencement of commercial production/operations") or "capex" in x:
        return "capex", "capex", 60
    if re.search(r"pledg|encumbrance", x):
        return "pledging", None, 40 if "release" in x else 72
    if re.search(r"\bsast\b|insider trading|regulation 7\(2\)|reg\. ?29", x):
        return "insider_trading", None, 45

    # Payouts
    if "bonus" in x or "sub-division" in x or "split" in x:
        return "bonus_split", None, 55
    if t == "dividend":
        return "dividend", None, 35
    if t == "record date":
        return "dividend", None, 18

    # Orders and news
    if t == "bagging/receiving of orders/contracts" or re.search(r"\bwins?\b.*\borders?\b|order (win|inflow)", x):
        size = re.search(r"\b(mega|major|large|significant)\b", x)
        return "press_release", "order", {"mega": 65, "major": 60, "large": 55, "significant": 48}.get(
            size.group(1) if size else "", 45)
    if t == "monthly business updates":
        return "press_release", None, 35
    if t.startswith("press release"):
        return "press_release", None, 30
    return "press_release" if t in ("general updates", "updates") else "unclassified", None, 18
