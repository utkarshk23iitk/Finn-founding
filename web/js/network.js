// FINN network engine. Pure functions, no DOM, no network calls.
// It runs on the investor's device, so their contacts never leave it.
//
// Two kinds of people meet here:
//   contacts  - the investor's own network (private, on device)
//   people    - real executives named in filings (public, every fact quoted)
// A link between them is computed from shared employers, overlapping years,
// same function, same intake or same school. Nothing is assumed beyond that.

const SENIOR = /\b(head|director|vp|vice president|chief|cfo|ceo|cto|coo|partner|gm|general manager|founder|managing)\b/i;

export const FUNCTION_LABEL = {
  finance: "finance", tax: "tax", compliance: "compliance", technology: "technology",
  general_management: "leadership", sales: "sales", marketing: "marketing",
  operations: "operations", supply_chain: "supply chain", quality: "quality",
  r_and_d: "R&D", strategy: "strategy", legal: "legal", regulatory: "regulation",
  investing: "investing", research: "research", hr: "people", engineering: "engineering",
  risk: "credit risk",
};

// People with no tie to the company whose job is exactly this kind of event:
// a former drug regulator for a plant inspection, a securities lawyer for a
// SEBI letter, an executive-search partner for a new CEO.
export const SPECIALISTS = {
  management_change: ["hr"],
  regulatory: ["quality", "regulatory"],
  litigation: ["legal", "compliance", "regulatory"],
  capex: ["engineering"],
};

// Which functions matter most for each kind of event.
export const EVENT_FUNCTIONS = {
  management_change: ["general_management", "hr", "finance"],
  results: ["finance", "strategy", "research"],
  "M&A": ["finance", "strategy", "tax", "general_management"],
  capex: ["operations", "engineering", "supply_chain"],
  litigation: ["legal", "compliance", "regulatory"],
  regulatory: ["quality", "regulatory", "legal", "compliance"],
  order: ["sales", "operations"],
  fund_raise: ["finance"],
  credit_rating: ["finance", "risk"],
};

// ---------- names ----------

function squashOrg(s) {
  return String(s || "").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|pvt|private|inc|llc|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function personKey(name) {
  return String(name || "").toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|shri|sri|smt|prof)\b\.?/g, " ")
    .replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Same person if the surname matches and every initial agrees with a given name.
// "V. N. Srivatsan" ~ "Venkat N Srivatsan"; "Gopal Jain" !~ "Ankush Jain".
export function samePerson(a, b) {
  const x = personKey(a).split(" "), y = personKey(b).split(" ");
  if (!x.length || !y.length || x.at(-1) !== y.at(-1)) return false;
  const gx = x.slice(0, -1), gy = y.slice(0, -1);
  const n = Math.min(gx.length, gy.length);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    const p = gx[i], q = gy[i];
    if (p.length > 1 && q.length > 1 ? p !== q : p[0] !== q[0]) return false;
  }
  return true;
}

export function makeResolver(orgsDoc) {
  const orgIdx = new Map(), schoolIdx = new Map(), bySymbol = new Map();
  for (const [key, o] of Object.entries(orgsDoc.orgs)) {
    for (const n of [o.name, ...(o.aliases || [])]) orgIdx.set(squashOrg(n), key);
    if (o.symbol) bySymbol.set(o.symbol, key);
  }
  for (const [key, s] of Object.entries(orgsDoc.schools)) {
    for (const n of [s.name, ...(s.aliases || [])]) schoolIdx.set(squashOrg(n), key);
  }
  const org = (name) => orgIdx.get(squashOrg(name)) || null;
  const info = (key) => orgsDoc.orgs[key] || null;
  // The company, everything above it and everything below it
  // (Amber -> IL JIN -> Ascent Circuits counts as one family).
  const family = (key) => {
    if (!info(key)) return new Set();
    const out = new Set([key]);
    for (let p = info(key).parent; p && !out.has(p); p = info(p)?.parent) out.add(p);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [k, v] of Object.entries(orgsDoc.orgs)) {
        if (v.parent && out.has(v.parent) && !out.has(k) && k !== key) {
          // only descendants of `key`, not siblings reached through a parent
          let q = v.parent;
          while (q && q !== key) q = info(q)?.parent;
          if (q === key) { out.add(k); grew = true; }
        }
      }
    }
    return out;
  };
  return {
    org, info, family,
    school: (name) => schoolIdx.get(squashOrg(name)) || null,
    bySymbol: (sym) => bySymbol.get(sym) || null,
    themeName: (t) => orgsDoc.themes[t] || t,
    themesOf: (stint) => {
      const k = org(stint.org);
      return [...new Set([...(stint.themes || []), ...((k && info(k).themes) || [])])];
    },
    // Themes a contact names in their own expertise ("pharma leadership" -> pharma).
    themesFromTags: (tags) => Object.entries(orgsDoc.themes)
      .filter(([k, name]) => (tags || []).some((t) => {
        const s = t.toLowerCase();
        return s.includes(name.toLowerCase()) || s.includes(k.split("-")[0]);
      })).map(([k]) => k),
  };
}

// ---------- time ----------

const yearOf = (iso) => Number(String(iso).slice(0, 4));

function span(stint, asOfYear) {
  const from = stint.from ?? null;
  let to = stint.to ?? null;
  if (from !== null && to === null) to = asOfYear;          // current role
  return { from, to, known: from !== null && to !== null, approx: !!stint.approx };
}

// How two stints sit in time: confirmed overlap, disjoint, or unknown.
export function overlap(a, b, asOfYear) {
  const x = span(a, asOfYear), y = span(b, asOfYear);
  if (!x.known || !y.known) {
    // One side has only an end year: they can't have overlapped if the other started after it.
    const endA = x.to, endB = y.to;
    if (endA !== null && y.from !== null && y.from > endA) return { kind: "disjoint" };
    if (endB !== null && x.from !== null && x.from > endB) return { kind: "disjoint" };
    return { kind: "unknown" };
  }
  const start = Math.max(x.from, y.from), end = Math.min(x.to, y.to);
  if (end < start) return { kind: "disjoint", gap: start - end };
  // Sharing only a boundary year (one left in 2001, the other joined in 2001) is not working together.
  if (end === start) return { kind: "touching", year: start };
  return { kind: "confirmed", from: start, to: end, years: end - start, approx: x.approx || y.approx };
}

// ---------- links to a real person ----------

const noisyOr = (scores) => 1 - scores.reduce((p, s) => p * (1 - s), 1);

export function label(score) {
  return score >= 0.6 ? "strong" : score >= 0.35 ? "medium" : score > 0 ? "weak" : "none";
}

function yearsText(o) {
  const n = o.years;
  return `${o.from}–${o.to}, ${o.approx ? "about " : ""}${n} year${n === 1 ? "" : "s"} together`;
}

// Evidence that a contact could know a person, strongest first.
// Only the same employer counts (a sister company is too loose), and each
// employer or school contributes its single best piece of evidence.
export function linkToPerson(contact, person, R, asOfYear) {
  const best = new Map();
  const keep = (key, e) => { if (!best.has(key) || best.get(key).score < e.score) best.set(key, e); };
  for (const cs of contact.career || []) {
    const ck = R.org(cs.org);
    if (!ck) continue;
    for (const ps of person.career || []) {
      if (R.org(ps.org) !== ck) continue;
      const o = overlap(cs, ps, asOfYear);
      const sameFn = !!cs.function && cs.function === ps.function;
      const sameIntake = cs.cohort && ps.cohort && cs.cohort === ps.cohort;
      const where = R.info(ck).name;
      let score, text;
      if (sameIntake) {
        score = 0.75;
        text = `Joined the ${where} in the same intake (${ps.cohort})`;
      } else if (o.kind === "confirmed") {
        score = 0.5 + Math.min(o.years, 8) * 0.04 + (sameFn ? 0.1 : 0);
        text = `Both at ${where}, ${yearsText(o)}${sameFn ? `, both in ${FUNCTION_LABEL[cs.function]}` : ""}`;
      } else if (o.kind === "unknown") {
        score = 0.36 + (sameFn ? 0.1 : 0);
        text = `Both worked at ${where}${sameFn ? ` in ${FUNCTION_LABEL[cs.function]}` : ""}; the filing doesn't say when${ps.years_note ? ` (${ps.years_note} there)` : ""}`;
      } else if (o.kind === "touching") {
        score = 0.15;
        text = `Both at ${where}, but only around ${o.year}`;
      } else {
        score = 0.1;
        text = `Also worked at ${where}, at a different time`;
      }
      keep(`org:${ck}`, { type: "work", org: ck, score: Math.min(score, 0.9), text, overlap: o, sameFunction: sameFn });
    }
  }
  for (const ce of contact.education || []) {
    const ck = R.school(ce.school);
    if (!ck) continue;
    for (const pe of person.education || []) {
      if (R.school(pe.school) !== ck) continue;
      const o = overlap(ce, pe, asOfYear);
      const name = ce.school;
      const score = o.kind === "confirmed" ? 0.4 : o.kind === "unknown" ? 0.12 : 0.06;
      const text = o.kind === "confirmed" ? `Studied at ${name} at the same time`
        : o.kind === "unknown" ? `Also studied at ${name}; the filing doesn't say when`
          : `Also studied at ${name}, years apart`;
      keep(`school:${ck}`, { type: "school", school: ck, score, text, overlap: o });
    }
  }
  const evidence = [...best.values()].sort((a, b) => b.score - a.score);
  const score = Math.min(noisyOr(evidence.map((e) => e.score)), 0.95);
  return { score, strength: label(score), evidence };
}

// ---------- the investor's tie to a contact ----------

export function tie(contact, asOf) {
  const r = contact.rel || {};
  const days = (Date.parse(asOf) - Date.parse(r.last_contact)) / 86400000;
  const recency = days <= 90 ? 1 : days <= 180 ? 0.85 : days <= 365 ? 0.65 : 0.45;
  const score = ((r.strength || 1) / 5) * recency;
  return { score, days: Math.round(days), months: Math.round(days / 30.4) };
}

// Who can get the investor to this person, best route first.
export function routesTo(person, network, R) {
  const asOfYear = yearOf(network.as_of);
  const out = [];
  for (const c of network.contacts) {
    const link = linkToPerson(c, person, R, asOfYear);
    if (link.score <= 0) continue;
    const t = tie(c, network.as_of);
    out.push({ contact: c, link, tie: t, score: t.score * link.score });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Is this person already in the investor's network? Name alone is not enough;
// an employer in common is required, so a common name can't make a false match.
export function findInNetwork(person, network, R) {
  const orgs = new Set((person.career || []).map((s) => R.org(s.org)).filter(Boolean));
  if (person.symbol && R.bySymbol(person.symbol)) orgs.add(R.bySymbol(person.symbol));
  return network.contacts.filter((c) => samePerson(c.name, person.name)
    && (c.career || []).some((s) => orgs.has(R.org(s.org))));
}

// ---------- who knows a company ----------

// Everyone with first-hand or adjacent knowledge of a company, ranked.
// kind: an event kind from EVENT_FUNCTIONS, to favour the right functions.
export function whoKnows(orgKey, network, R, kind = null) {
  const asOfYear = yearOf(network.as_of);
  const target = R.info(orgKey);
  if (!target) return [];
  const fam = R.family(orgKey);
  const peers = new Set(target.peers || []);
  const links = new Map((target.links || []).map((l) => [l.to, l.kind]));
  const wanted = new Set(EVENT_FUNCTIONS[kind] || []);
  const specialist = new Set(SPECIALISTS[kind] || []);
  const targetThemes = new Set(target.themes || []);
  const out = [];
  for (const c of network.contacts) {
    let best = null;
    const consider = (cand) => {
      if (SENIOR.test(cand.stint.role)) cand.score += 0.08;
      if (kind) {
        if (wanted.has(cand.stint.function)) { cand.score += 0.15; cand.text += ` · ${FUNCTION_LABEL[cand.stint.function]}`; }
        else cand.score *= 0.75;
      }
      if (!best || cand.score > best.score) best = cand;
    };
    for (const s of c.career || []) {
      const k = R.org(s.org);
      if (!k) continue;
      if (fam.has(k)) {
        const current = s.to === null || s.to === undefined;
        const left = current ? 0 : asOfYear - s.to;
        const sub = R.info(k);
        const before = sub.parent_since && !current && s.to < yearOf(sub.parent_since);
        let text;
        if (k === orgKey) text = current ? `${s.role} at ${target.name} now` : `${s.role} at ${target.name}, ${s.from}–${s.to}`;
        else if (before) text = `${s.role} at ${sub.name}, ${s.from}–${s.to}; ${sub.parent_note || `now part of ${target.name}`}`;
        else text = `${s.role} at ${sub.name}, part of ${target.name}${current ? ", now" : `, ${s.from}–${s.to}`}`;
        let score = current ? 0.8 : Math.max(0.3, 0.72 - 0.04 * left);
        if (before && kind === "M&A") score += 0.1;   // knows the business that was just bought
        consider({ score, text, how: current ? "inside" : "alumnus", stint: s });
      } else if (peers.has(k)) {
        consider({ score: 0.32, how: "peer", stint: s, text: `${s.role} at ${R.info(k).name}, a competitor` });
      } else if (links.has(k)) {
        consider({ score: 0.38, how: links.get(k), stint: s, text: `${s.role} at ${R.info(k).name}, a ${links.get(k)}` });
      }
    }
    // Specialists: no tie to the company, but this kind of event is their job.
    // A plant inspection needs someone from the same industry; a SEBI letter
    // needs a securities lawyer from any industry.
    const tagThemes = R.themesFromTags(c.expertise);
    for (const s of c.career || []) {
      if (!specialist.has(s.function)) continue;
      const themes = R.themesOf(s);
      const own = themes.length ? themes : tagThemes;
      // A legal or compliance specialist fits any company's legal trouble;
      // everyone else must come from the company's own industry.
      const anyIndustry = kind === "litigation" && ["legal", "compliance"].includes(s.function) && own.includes("regulation");
      if (!anyIndustry && !own.some((t) => targetThemes.has(t))) continue;
      const k = R.org(s.org);
      const where = k ? ` at ${R.info(k).name}` : s.org === "Independent" ? ", independent" : ` at ${s.org}`;
      consider({ score: 0.4, how: "specialist", stint: s,
                 text: `${s.role}${where}${s.to ? `, ${s.from}–${s.to}` : ""}` });
    }
    if (!best) continue;
    const t = tie(c, network.as_of);
    // What they know matters more than how close you are; closeness breaks ties.
    out.push({ contact: c, ...best, score: Math.min(best.score, 0.95) * (0.6 + 0.4 * t.score), tie: t });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- expertise map ----------

export function experts(themeKey, network, R) {
  const asOfYear = yearOf(network.as_of);
  const out = [];
  for (const c of network.contacts) {
    let years = 0, current = false;
    const where = [];
    for (const s of c.career || []) {
      if (!R.themesOf(s).includes(themeKey)) continue;
      const to = s.to ?? asOfYear;
      years += Math.max(1, to - (s.from ?? to));
      if (s.to === null || s.to === undefined) current = true;
      where.push(R.org(s.org) ? R.info(R.org(s.org)).name : s.org);
    }
    if (!years) continue;
    const depth = Math.min(years, 15) / 15;
    const t = tie(c, network.as_of);
    out.push({ contact: c, years, current, where: [...new Set(where)],
               score: (0.6 * depth + (current ? 0.2 : 0) + 0.2) * (0.4 + 0.6 * t.score), tie: t });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- keeping the network warm ----------

// A contact you haven't spoken to in a while, whose company (now or before)
// just did something: a natural reason to call.
export function reconnect(events, network, R, minMonths = 6) {
  const asOfYear = yearOf(network.as_of);
  const out = [];
  for (const c of network.contacts) {
    const t = tie(c, network.as_of);
    if (t.months < minMonths) continue;
    for (const e of events) {
      const key = R.bySymbol(e.symbol);
      if (!key) continue;
      const fam = R.family(key);
      const s = (c.career || []).filter((x) => fam.has(R.org(x.org)))
        .sort((a, b) => (b.to ?? 9999) - (a.to ?? 9999))[0];
      if (!s) continue;
      const current = s.to === null || s.to === undefined;
      const k = R.org(s.org);
      const where = k === key ? R.info(key).name
        : `${R.info(k).name}, ${R.info(k).parent_since ? "now " : ""}part of ${R.info(key).name}`;
      out.push({ contact: c, event: e, tie: t,
                 why: `${current ? "Works at" : "Was at"} ${where}${current ? "" : ` (${s.from}–${s.to})`}; last spoke ${t.months} months ago`,
                 score: ((c.rel?.strength || 1) / 5) * (current ? 1 : Math.max(0.5, 1 - 0.05 * (asOfYear - s.to))) });
      break;
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
