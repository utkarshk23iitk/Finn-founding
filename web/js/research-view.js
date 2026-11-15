// Pull: promised vs delivered for any NSE ticker, with who to call about the misses.
import { whoKnows, experts } from "./network.js";
import { esc, whoRow } from "./ui.js";

const ORDER = ["missed", "partly", "revised", "dropped", "unclear", "delivered", "pending"];
export const VERDICT = {
  missed: "Missed", partly: "Partly", revised: "Target changed", dropped: "Went quiet",
  unclear: "Can't tell", delivered: "Delivered", pending: "Pending",
};
const SETTLED = new Set(["delivered", "partly", "missed", "dropped"]);
// One vocabulary for the pill, the legend and the bar: a changed target says which way it moved.
const BUCKETS = ["missed", "cut", "partly", "changed", "dropped", "unclear", "raised", "delivered", "pending"];
const LABEL = { missed: "Missed", cut: "Cut", partly: "Partly", changed: "Target changed", dropped: "Went quiet",
                unclear: "Can't tell", raised: "Raised", delivered: "Delivered", pending: "Pending" };
export const bucket = (p) => (p.verdict === "revised" ? (p.direction === "raised" ? "raised" : p.direction === "cut" ? "cut" : "changed") : p.verdict);
// "INR7,500 crores" -> "₹7,500 crore": transcripts' wording, read at a glance.
const money = (t) => String(t || "").replace(/\bINR\s?/gi, "₹").replace(/\bRs\.?\s?/g, "₹").replace(/\bcrores\b/gi, "crore");
const shortName = (n) => String(n || "").replace(/\s*\((India|I)\)\s*/g, " ").replace(/\s+(Ltd|Limited)\.?$/i, "").trim();
const monthLabel = (m) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.slice(5, 7)) - 1];

export function summary(r) {
  const counts = Object.fromEntries(ORDER.map((k) => [k, 0]));
  for (const p of r.promises) counts[p.verdict] = (counts[p.verdict] || 0) + 1;
  const settled = r.promises.filter((p) => SETTLED.has(p.verdict)).length;
  const buckets = Object.fromEntries(BUCKETS.map((k) => [k, 0]));
  for (const p of r.promises) buckets[bucket(p)] += 1;
  return { counts, buckets, settled, delivered: counts.delivered };
}

// "2 of 2 settled promises delivered" only means something with two or more settled;
// otherwise lead with what changed: "1 target cut · 2 changed · 5 still open".
export function headline(s) {
  if (s.settled >= 2) return `${s.delivered} of ${s.settled} settled promises delivered`;
  const b = s.buckets, n = (k) => b[k];
  const parts = [
    n("cut") && `${n("cut")} target${n("cut") > 1 ? "s" : ""} cut`, n("raised") && `${n("raised")} raised`,
    n("changed") && `${n("changed")} changed`, n("missed") && `${n("missed")} missed`, n("delivered") && `${n("delivered")} delivered`,
    n("partly") && `${n("partly")} partly met`, n("dropped") && `${n("dropped")} went quiet`,
    n("pending") && `${n("pending")} still open`, n("unclear") && `${n("unclear")} can't tell`,
  ].filter(Boolean);
  return parts.slice(0, 4).join(" · ") || "No promises found";
}

// The biggest miss, as a question to ask someone who knows.
function question(r) {
  const miss = r.promises.find((p) => p.verdict === "missed") || r.promises.find((p) => p.verdict === "partly")
    || r.promises.find((p) => p.verdict === "revised" && p.direction === "cut") || r.promises.find((p) => p.verdict === "revised");
  if (!miss) return "";
  const t = money(miss.mentions.at(-1).target);
  if (miss.verdict === "revised") return `Why was the ${miss.segment && miss.segment !== "company" ? `${miss.segment} ` : ""}${miss.metric} target for ${miss.horizon} ${miss.direction === "raised" ? "raised" : "cut"} from ${money(miss.mentions[0].target)} to ${t}?`;
  return `What held ${miss.metric} back against the ${t} target for ${miss.horizon}${miss.actual ? ` (${miss.actual.replace(/\.$/, "")})` : ""}?`;
}

// Track a promise across the calls: said, repeated, changed, or not mentioned.
function strip(p, calls) {
  let prev = null;
  return `<span class="strip" aria-hidden="true">${calls.map((c) => {
    const m = p.mentions.find((x) => x.call === c.label);
    if (!m) return `<i class="s-none" title="${esc(c.label)}: not mentioned"></i>`;
    const moved = prev && (prev.low !== m.low || prev.high !== m.high);
    prev = m;
    return `<i class="${moved ? "s-moved" : "s-said"}" title="${esc(c.label)}: ${esc(m.target)}"></i>`;
  }).join("")}</span>`;
}

// A changed target says which way it moved, as the investor reads it.
const tag = (p) => LABEL[bucket(p)];
const tone = (p) => `v-${bucket(p)}`;
const metricName = (p) => (p.metric === "other" ? "" : p.metric);

function promiseRow(p, r, open) {
  const last = p.mentions.at(-1), first = p.mentions[0];
  const target = money(p.verdict === "revised" && p.mentions.length > 1 && first.target !== last.target ? `${first.target} → ${last.target}` : last.target);
  const reported = ["delivered", "missed", "partly", "unclear"].includes(p.verdict);
  return `<div class="promise ${tone(p)}">
    <button class="p-sum" data-act="toggle" data-id="p:${esc(r.symbol)}:${esc(p.id)}" aria-expanded="${open}">
      <span class="pill ${tone(p)}">${esc(tag(p))}</span>
      <span class="p-what">${p.segment && p.segment !== "company" ? `<span class="p-h">${esc(p.segment)} · </span>` : ""}<b>${esc(metricName(p))}</b> ${esc(target)} <span class="p-h">for ${esc(p.horizon)}</span></span>
      ${strip(p, r.calls)}
    </button>
    ${p.actual ? `<p class="p-actual">${esc(p.actual)}</p>` : ""}
    ${open ? `<div class="p-body">
      ${p.mentions.map((m, i) => {
        const prev = p.mentions[i - 1];
        const verb = !prev ? "Said" : prev.low !== m.low || prev.high !== m.high ? "Changed" : "Repeated";
        return `<blockquote><p>“${esc(m.quote)}”</p>
        <cite>${verb} in the <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.call)} call ↗</a></cite></blockquote>`;
      }).join("")}
      ${p.evidence && !p.mentions.some((m) => m.quote === p.evidence.quote) ? `<blockquote class="outcome"><p>“${esc(p.evidence.quote)}”</p>
        <cite>${reported ? "What they reported" : "Said later"}, <a href="${esc(p.evidence.url)}" target="_blank" rel="noopener">${esc(p.evidence.call)} call ↗</a></cite></blockquote>` : ""}
      ${p.note && !p.actual ? `<p class="detail">${esc(p.note)}</p>` : ""}
      ${p.model_verdict ? `<p class="override">The model said “${esc(VERDICT[p.model_verdict] || p.model_verdict)}”. ${
        p.settled_by === "date" ? "The deadline hasn't passed, so it stays pending."
        : p.settled_by === "check" ? "The number it compared looks like a different business or scale, so FINN won't call it."
        : p.settled_by === "quotes" ? "Management's own words show the target changed between calls, so FINN says so."
        : "The reported number says otherwise, and the number wins."}</p>` : ""}
    </div>` : ""}
  </div>`;
}

export function researchHTML(st, ctx) {
  const idx = st.researchIndex || {};
  const chips = Object.entries(idx).map(([s, v]) => `<button class="chip" data-act="research" data-sym="${esc(s)}" aria-pressed="${st.ticker === s}">${esc(shortName(v.name))}</button>`).join("");
  let body = "";
  if (st.researchState === "loading") {
    body = `<div class="card clear"><b>Reading ${esc(st.ticker)}'s last four earnings calls…</b>The first look at a new company takes about a minute. After that it's cached.</div>`;
  } else if (st.researchState === "error") {
    body = `<div class="card clear"><b>Couldn't research ${esc(st.ticker)}</b>${esc(st.researchError)}</div>`;
  } else if (st.research) {
    body = resultHTML(st.research, st, ctx);
  } else {
    body = `<p class="sub">Grounded only in the company's own earnings-call transcripts. Every quote is checked word for word; numbers and deadlines are settled by code, not the model.</p>`;
  }
  return `<h1 class="lede">Promised vs delivered</h1>
    <form class="tickerform" data-form="research">
      <input name="ticker" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Any NSE ticker, e.g. TCS" value="${esc(st.tickerInput || "")}" aria-label="NSE ticker">
      <button class="primary" type="submit">Read the calls</button>
    </form>
    ${chips ? `<div class="windows chips-wrap">${chips}</div>` : ""}
    ${body}`;
}

// No explicit targets is a finding, not an empty page: say so, and show what they did report.
function noTargetsHTML(r) {
  const seen = new Set();
  const rep = (r.reported || []).filter((x) => x.value != null && !seen.has(x.metric + x.period) && seen.add(x.metric + x.period)).slice(0, 6);
  return `<article class="card research">
    <div class="card-top"><span class="co">${esc(shortName(r.name))}</span><span class="tag">${esc(r.symbol)}</span><time>results to ${esc(r.latest_period)}</time></div>
    <h3>No explicit targets in the last four calls</h3>
    <p class="detail">FINN found no forward number or date from management in the ${r.calls.map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(monthLabel(c.month))}</a>`).join(", ")} ${esc(r.calls.at(-1).month.slice(0, 4))} calls, so there is nothing to hold them to. That is worth knowing in itself.</p>
    ${rep.length ? `<p class="ask-h">What they reported</p><ul class="facts">${rep.map((x) => `<li>${esc(x.segment && x.segment !== "company" ? `${x.segment}: ` : "")}${esc(x.metric)} ${esc(x.period)}: <b>${esc(String(x.value))}${esc(x.unit === "%" ? "%" : ` ${x.unit || ""}`)}</b> <span class="yrs">${esc(x.call)} call</span></li>`).join("")}</ul>` : ""}
  </article>
  <p class="foot">Read by ${esc(r.models.extract)} · ${r.usage.calls} model calls, ${(r.usage.tokens_in + r.usage.tokens_out).toLocaleString("en-IN")} tokens · ${r.checks.quotes_dropped} quote${r.checks.quotes_dropped === 1 ? "" : "s"} dropped for not being in the transcript.</p>`;
}

function resultHTML(r, st, ctx) {
  if (!r.promises.length) return noTargetsHTML(r);
  const s = summary(r);
  const order = [...r.promises].sort((a, b) => BUCKETS.indexOf(bucket(a)) - BUCKETS.indexOf(bucket(b)));
  const shown = BUCKETS.filter((k) => s.buckets[k]);
  const org = ctx.R.bySymbol(r.symbol);
  let who = org ? whoKnows(org, ctx.net, ctx.R, "results").slice(0, 2) : [];
  if (org) {
    const themes = ctx.R.info(org).themes || [];
    const extra = themes.length ? experts(themes[0], ctx.net, ctx.R).find((x) => !who.some((w) => w.contact.id === x.contact.id)) : null;
    if (extra && who.length < 2) who.push({ contact: extra.contact, how: "specialist", tie: extra.tie,
      text: `${extra.years} years in ${ctx.R.themeName(themes[0]).toLowerCase()} (${extra.where.slice(0, 2).join(", ")})` });
  }
  const q = question(r);
  // SVG attributes, not inline CSS: the page's security policy forbids inline styles.
  const total = r.promises.length || 1;
  let x = 0;
  const segs = `<svg viewBox="0 0 100 8" preserveAspectRatio="none" class="scorebar-svg">${shown.map((k) => {
    const w = (s.buckets[k] / total) * 100, rect = `<rect class="v-${k}" x="${x.toFixed(2)}" y="0" width="${Math.max(w - 0.6, 0.4).toFixed(2)}" height="8" rx="1.5"/>`;
    x += w; return rect;
  }).join("")}</svg>`;
  return `<article class="card research">
    <div class="card-top"><span class="co">${esc(shortName(r.name))}</span><span class="tag">${esc(r.symbol)}</span><time>results to ${esc(r.latest_period)}</time></div>
    <h3>${esc(headline(s))}</h3>
    <div class="scorebar" role="img" aria-label="${shown.map((k) => `${s.buckets[k]} ${LABEL[k]}`).join(", ")}">${segs}</div>
    <p class="legend">${shown.map((k) => `<span><i class="dot v-${k}"></i>${s.buckets[k]} ${esc(LABEL[k].toLowerCase())}</span>`).join("")}</p>
    <p class="sub">From the ${r.calls.map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(monthLabel(c.month))}</a>`).join(", ")} ${esc(r.calls.at(-1).month.slice(0, 4))} calls. Tap a promise for the exact words.</p>
    ${who.length ? `<div class="ask"><p class="ask-h">Who to call about it</p>${q ? `<p class="question">${esc(q)}</p>` : ""}${who.map(whoRow).join("")}</div>`
      : `<p class="nobody">No one in your network has a known link to ${esc(shortName(r.name))}.</p>`}
  </article>
  <div class="ledger">${order.map((p) => promiseRow(p, r, st.open.has(`p:${r.symbol}:${p.id}`))).join("")}</div>
  <p class="foot">Read by ${esc(r.models.extract)}, ${r.models.judge ? `judged by ${esc(r.models.judge)}` : "not judged (the first read ran out of time; code's checks still apply)"} · ${r.usage.calls} model calls, ${(r.usage.tokens_in + r.usage.tokens_out).toLocaleString("en-IN")} tokens, free tier ·
    ${r.checks.quotes_dropped} quote${r.checks.quotes_dropped === 1 ? "" : "s"} dropped for not being in the transcript · ${r.checks.overrides} verdict${r.checks.overrides === 1 ? "" : "s"} overruled by numbers or dates.</p>`;
}
