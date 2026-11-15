// The Today screen's logic: pure functions over the exported feed.
// No DOM here, so Node can test it.
import { routesTo, whoKnows, reconnect } from "./network.js";

export const WINDOWS = [
  { key: "24h", hours: 24, label: "24 hours" },
  { key: "3d", hours: 72, label: "3 days" },
  { key: "7d", hours: 168, label: "week" },
  { key: "30d", hours: 720, label: "month" },
];
export const HIGH = 70, MEDIUM = 40;

export const CATEGORY_LABEL = {
  results: "Results", "M&A": "Deal", management_change: "Leadership", litigation: "Legal and regulatory",
  credit_rating: "Credit rating", fund_raise: "Fund raise", pledging: "Promoter pledge", capex: "Capacity",
  press_release: "News", earnings_call: "Earnings call", investor_meetings: "Investor meeting",
  dividend: "Dividend", bonus_split: "Bonus or split", insider_trading: "Insider trade",
  postal_ballot: "Postal ballot", agm_egm: "Shareholder meeting", unclassified: "Paperwork",
};

const ROUTINE_LABEL = {
  "Copy of Newspaper Publication": "newspaper notices",
  "Analysts/Institutional Investor Meet/Con. Call Updates": "investor meetings and calls",
  "ESOP/ESOS/ESPS": "employee share options",
  "Certificate under SEBI (Depositories and Participants) Regulations, 2018": "depository certificates",
  "Statement of deviation(s) or variation(s) under Reg. 32": "use-of-funds statements",
  "Monitoring Agency Report": "use-of-funds statements",
  "Investor Presentation": "investor presentations",
  "Shareholders meeting": "shareholder meetings",
  "Record Date": "record dates",
  "Trading Window": "trading-window notices",
};

// "2026-11-12T13:58:25" -> local Date. Filings and the snapshot share a clock (IST),
// so comparing them as local times is consistent wherever the phone is.
export function parseLocal(iso) {
  const [d, t = "00:00:00"] = String(iso).split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, mi, s] = t.split(":").map(Number);
  return new Date(y, m - 1, day, h || 0, mi || 0, s || 0);
}
const priceDayTime = (day) => parseLocal(`${day}T15:30:00`);   // NSE closes at 3:30 pm

export function inWindow(items, asOf, hours) {
  const end = parseLocal(asOf), start = new Date(end - hours * 3600e3);
  return items.filter((x) => { const t = parseLocal(x.time); return t > start && t <= end; });
}

export function median(xs) {
  const a = [...xs].sort((p, q) => p - q), n = a.length;
  return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : NaN;
}

// Each day's move and volume multiple. The multiple is against the median of the
// previous `lookback` days: a mean lets one results day hide the next spike.
export function priceSignals(rows, lookback = 20) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const [date, close, vol] = rows[i];
    const prev = rows[i - 1][1];
    const base = median(rows.slice(Math.max(0, i - lookback), i).map((r) => r[2]));
    out.push({ date, close, move: (close / prev - 1) * 100, volMult: base ? vol / base : NaN, volume: vol });
  }
  return out;
}

export function priceAlerts(prices, asOf, hours, rules) {
  const end = parseLocal(asOf), start = new Date(end - hours * 3600e3);
  const out = [];
  for (const [symbol, rows] of Object.entries(prices)) {
    for (const s of priceSignals(rows, rules.volume_lookback)) {
      const t = priceDayTime(s.date);
      if (t <= start || t > end) continue;
      const moved = Math.abs(s.move) >= rules.price_move_pct;
      const traded = s.volMult >= rules.volume_multiple;
      if (moved || traded) out.push({ symbol, ...s, moved, traded, time: `${s.date}T15:30:00` });
    }
  }
  return out;
}

// The price card's chart shows the last 40 sessions, often longer than the window. A bigger unusual day outside
// the window is named and marked: a 19% fall last week shouldn't sit grey behind a 1% day. Only that one is marked;
// after a shock most days clear the volume rule, and an all-amber chart says nothing.
export const CHART_SESSIONS = 40;
const unusualness = (d) => Math.abs(d.move) * 1.5 + d.volMult;
export function earlierInChart(symbol, days, big, feed, rules) {
  const rows = feed.prices[symbol] || [];
  const shown = new Set(rows.slice(-CHART_SESSIONS).map((r) => r[0]));
  const inWin = new Set(days.map((d) => d.date));
  const earlier = priceSignals(rows, rules.volume_lookback)
    .filter((d) => shown.has(d.date) && !inWin.has(d.date))
    .filter((d) => Math.abs(d.move) >= rules.price_move_pct || d.volMult >= rules.volume_multiple);
  const top = earlier.reduce((p, q) => (!p || unusualness(q) > unusualness(p) ? q : p), null);
  const bigger = top && unusualness(top) > unusualness(big)
    ? { ...top, time: `${top.date}T15:30:00`, why: likelyWhy({ symbol, date: top.date }, feed.filings) } : null;
  return { marked: bigger ? [bigger.date] : [], earlier: bigger };
}

// The filing most likely behind a move: the most important one from two days
// before to the morning after (results often land after the close). Results
// move stocks more than anything filed the same day, so they win ties.
export function likelyWhy(alert, filings) {
  const t = priceDayTime(alert.date);
  const from = new Date(t - 2 * 86400e3), to = new Date(t.getTime() + 18 * 3600e3);
  const weight = (f) => f.priority + (f.category === "results" ? 15 : 0);
  return filings
    .filter((f) => f.symbol === alert.symbol && f.priority >= MEDIUM)
    .filter((f) => { const x = parseLocal(f.time); return x >= from && x <= to; })
    .sort((a, b) => weight(b) - weight(a) || parseLocal(b.time) - parseLocal(a.time))[0] || null;
}

// "Appointment of Mr Gopal Kothari as Chief Financial Officer of the Company w.e.f. ..." -> "Gopal Kothari named CFO"
const ROLE_SHORT = [[/chief executive officer(?: \(ceo\))?/i, "CEO"], [/chief financial officer/i, "CFO"],
  [/chief technology officer/i, "CTO"], [/chief operating officer/i, "COO"], [/managing director/i, "MD"],
  [/whole[- ]?time director/i, "whole-time director"], [/key managerial personnel/i, "KMP"],
  [/senior management personnel/i, "senior manager"]];
export function shortPeopleLine(h) {
  // Some filings drop the "as": "Retirement of Mr. Mukundan Menon C. P. Managing Director of the Company w.e.f. ..."
  const noAs = h.match(/^(retirement|resignation|cessation) of (?:(?:mr|ms|mrs|dr)\.?\s+)?(.+?),?\s+((?:managing director|whole[- ]?time director|chief [a-z]+ officer|chairman|ceo|cfo)\b.*?)(?: of the (?:company|bank)\b.*| w\.?e\.?f\b.*)?$/i);
  if (noAs && !/\bas\b/i.test(noAs[2])) h = `${noAs[1]} of ${noAs[2]} as ${noAs[3]}`;
  const m = h.match(/^(appointment|re-?appointment|retirement|resignation|cessation) of (?:(?:mr|ms|mrs|dr)\.?\s+)?(.+?) as (?:an? |the )?(.+?)(?:,? (?:of|from) the (?:company|bank)\b.*|,? (?:w\.?e\.?f|with effect)\b.*|,? and (?:his|her|their|the)\b.*)?$/i);
  if (!m) return h;
  let role = m[3].replace(/\s+/g, " ");
  for (const [re, s] of ROLE_SHORT) role = role.replace(re, s);
  role = role.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const verb = { appointment: "named", reappointment: "reappointed", "re-appointment": "reappointed",
                 retirement: "retires as", resignation: "resigns as", cessation: "leaves as" }[m[1].toLowerCase()];
  return `${m[2].trim()} ${verb} ${role}`;
}

// "IL JIN Electronics (India) Limited, a material subsidiary of the Company ("IL JIN") has completed the
// acquisition of ..." -> "Completed the acquisition of ...": the news starts at the verb.
export function fromTheVerb(s) {
  const m = s.match(/^(.{25,200}?)\s(?:has|have|had)\s+(?:been\s+)?(completed|signed|entered|executed|received|approved|acquired|incorporated|commenced|won|bagged|secured|stayed|issued|allotted|appointed)\b/i);
  // Only drop a corporate preamble; "The High Court has stayed ..." keeps its actor, which is the news.
  if (!m || !/limited|subsidiary|llc|\binc\b|company|pvt/i.test(m[1])) return s;
  const rest = s.slice(m.index + m[0].length - m[2].length);
  return rest[0].toUpperCase() + rest.slice(1);
}

// One card per company and category in the window, newest filing first.
export function groupFilings(items) {
  const groups = new Map();
  for (const f of items) {
    const key = `${f.symbol}|${f.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return [...groups.values()].map((list) => {
    list.sort((a, b) => parseLocal(b.time) - parseLocal(a.time));
    const top = list.reduce((a, b) => (b.priority > a.priority ? b : a));
    // A self-contained headline: the newest one that doesn't lean on an earlier letter.
    const lead = list.find((f) => !f.dependent && f.priority >= top.priority - 10) || top;
    const latest = list[0];
    const items = dedupeItems(list);
    let headline = fromTheVerb(lead.headline), detail = lead.detail || (latest !== lead && latest.dependent ? latest.headline : "");
    if (top.category === "management_change") {
      // Leadership filings say the same thing in legal prose; say it in a line each.
      const lines = items.filter((f) => f.priority >= MEDIUM).sort((a, b) => b.priority - a.priority)
        .map((f) => shortPeopleLine(f.headline));
      if (lines.length) {
        headline = lines.slice(0, 2).join(" · ") + (lines.length > 2 ? ` · +${lines.length - 2} more` : "");
        detail = lines.length > 2 ? lines.slice(2).join(" · ") : detail;
      }
    }
    return {
      id: `${top.symbol}|${top.category}|${latest.id}`,
      kind: "filing", symbol: top.symbol, category: top.category, eventKind: top.kind,
      priority: top.priority, time: latest.time, headline, detail,
      items, ids: new Set(list.map((f) => f.id)),
    };
  });
}

// The same letter is often filed twice (results: standalone and consolidated).
function dedupeItems(list) {
  const seen = new Set();
  return list.filter((f) => { const k = f.headline.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Other material filings from the same company in the last 30 days, outside this card.
export function companyContext(card, allFilings, asOf) {
  const ids = new Set(card.items.map((f) => f.id));
  return inWindow(allFilings, asOf, 720)
    .filter((f) => f.symbol === card.symbol && !ids.has(f.id) && f.priority >= 60 && f.category !== card.category)
    .sort((a, b) => parseLocal(b.time) - parseLocal(a.time))
    .filter((f, i, arr) => arr.findIndex((g) => g.category === f.category) === i)
    .slice(0, 3);
}

export function routineSummary(groups) {
  const counts = new Map();
  for (const g of groups) for (const f of g.items) {
    const label = ROUTINE_LABEL[f.type] || (CATEGORY_LABEL[f.category] || f.type).toLowerCase();
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Who to ask, attached to a card. Real people come from their filings;
// routes to them and "who knows the company" come from the investor's network.
export function networkFor(card, ctx) {
  const { R, net, people } = ctx;
  const org = R.bySymbol(card.symbol);
  const ids = new Set((card.items || []).map((f) => f.id));
  const named = card.category === "management_change" ? people.filter((p) => ids.has(p.event.filing)) : [];
  const persons = named.map((p) => ({ person: p, routes: routesTo(p, net, R).slice(0, 3) }));
  const reached = persons.some((p) => p.routes.length);
  const kind = card.eventKind || (card.category === "results" ? "results" : null);
  const who = org && (!reached || card.category !== "management_change")
    ? whoKnows(org, net, R, kind).slice(0, card.category === "management_change" ? 2 : 3) : [];
  return { persons, who };
}

export function buildToday(feed, settings, ctx, done = new Set()) {
  const asOf = feed.meta.as_of;
  const win = WINDOWS.find((w) => w.key === settings.window) || WINDOWS[0];
  const groups = groupFilings(inWindow(feed.filings, asOf, win.hours));
  const alertCats = new Set(settings.alert_categories);

  // Price and volume alerts. A day a filing explains joins that filing's card;
  // the rest become one card per company, ranked by how unusual the biggest day was.
  const alerts = priceAlerts(feed.prices, asOf, win.hours, settings);
  const loose = new Map();
  for (const a of alerts) {
    a.why = likelyWhy(a, feed.filings);
    const host = a.why && (groups.find((g) => g.ids.has(a.why.id))
      || groups.find((g) => g.symbol === a.why.symbol && g.category === a.why.category));
    if (host) { (host.moves ||= []).push(a); continue; }
    if (!loose.has(a.symbol)) loose.set(a.symbol, []);
    loose.get(a.symbol).push(a);
  }
  const priceCards = [...loose.entries()].map(([symbol, days]) => {
    days.sort((p, q) => q.date.localeCompare(p.date));
    const big = days.reduce((p, q) => (Math.abs(q.move) * 1.5 + q.volMult > Math.abs(p.move) * 1.5 + p.volMult ? q : p));
    const size = Math.min(20, 2 * Math.max(0, big.volMult - settings.volume_multiple) + 2 * Math.abs(big.move));
    return { id: `${symbol}|price|${days[0].date}`, kind: "price", symbol, category: "price",
             priority: Math.round(66 + size), time: days[0].time, move: big, days, why: big.why,
             ...earlierInChart(symbol, days, big, feed, settings) };
  });

  const needs = [], glance = [], routine = [];
  for (const g of groups) {
    const alerting = g.priority >= HIGH && alertCats.has(g.category);
    if (alerting || g.moves) needs.push(g);
    else if (g.priority >= MEDIUM) glance.push(g);
    else routine.push(g);
  }
  needs.push(...priceCards);
  const order = (a, b) => b.priority - a.priority || parseLocal(b.time) - parseLocal(a.time);
  needs.sort(order); glance.sort(order);
  // One company's cards sit together (Alkem's new CFO next to its results), placed where its top card ranks.
  const together = (list) => {
    const first = new Map();
    list.forEach((c, i) => { if (!first.has(c.symbol)) first.set(c.symbol, i); });
    return list.map((c, i) => [first.get(c.symbol), i, c]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
  };
  needs.splice(0, needs.length, ...together(needs));
  glance.splice(0, glance.length, ...together(glance));

  for (const c of [...needs, ...glance]) {
    c.company = feed.companies[c.symbol];
    if (c.kind === "filing") c.context = companyContext(c, feed.filings, asOf);
    c.network = ctx ? networkFor(c, ctx) : null;
  }
  const open = needs.filter((c) => !done.has(c.id));
  const cleared = needs.filter((c) => done.has(c.id));
  const events = [...needs, ...glance].map((c) => ({ symbol: c.symbol, title: c.headline || "", cardId: c.id }));
  const warm = ctx ? reconnect(events, ctx.net, ctx.R).slice(0, 3) : [];
  return { asOf, window: win, needs: open, cleared, glance, routine: routineSummary(routine),
           routineCount: routine.reduce((n, g) => n + g.items.length, 0), warm };
}
