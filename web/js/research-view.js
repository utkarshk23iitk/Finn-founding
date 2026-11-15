// Pull: promised vs delivered for any NSE ticker, with who to call about the misses.
import { whoKnows, experts } from "./network.js";
import { esc, whoRow } from "./ui.js";

const ORDER = ["missed", "partly", "revised", "dropped", "delivered", "pending"];
export const VERDICT = {
  missed: "Missed", partly: "Partly", revised: "Goalposts moved", dropped: "Went quiet",
  delivered: "Delivered", pending: "Pending",
};
const SETTLED = new Set(["delivered", "partly", "missed", "dropped"]);
const monthLabel = (m) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.slice(5, 7)) - 1];

export function summary(r) {
  const counts = Object.fromEntries(ORDER.map((k) => [k, 0]));
  for (const p of r.promises) counts[p.verdict] = (counts[p.verdict] || 0) + 1;
  const settled = r.promises.filter((p) => SETTLED.has(p.verdict)).length;
  return { counts, settled, delivered: counts.delivered };
}

// The biggest miss, as a question to ask someone who knows.
function question(r) {
  const miss = r.promises.find((p) => p.verdict === "missed") || r.promises.find((p) => p.verdict === "partly")
    || r.promises.find((p) => p.verdict === "revised");
  if (!miss) return "";
  const t = miss.mentions.at(-1).target;
  if (miss.verdict === "revised") return `Why did the ${miss.metric} target for ${miss.horizon} move from ${miss.mentions[0].target} to ${t}?`;
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

function promiseRow(p, r, open) {
  const last = p.mentions.at(-1);
  return `<div class="promise v-${p.verdict}">
    <button class="p-sum" data-act="toggle" data-id="p:${esc(r.symbol)}:${esc(p.id)}" aria-expanded="${open}">
      <span class="pill v-${p.verdict}">${esc(VERDICT[p.verdict])}</span>
      <span class="p-what"><b>${esc(p.metric)}</b> ${esc(last.target)} <span class="p-h">for ${esc(p.horizon)}</span></span>
      ${strip(p, r.calls)}
    </button>
    ${p.actual ? `<p class="p-actual">${esc(p.actual)}</p>` : ""}
    ${open ? `<div class="p-body">
      ${p.mentions.map((m, i) => `<blockquote><p>“${esc(m.quote)}”</p>
        <cite>${i === 0 ? "Said" : last === m && p.moved ? "Changed" : "Repeated"} in the <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.call)} call ↗</a></cite></blockquote>`).join("")}
      ${p.evidence ? `<blockquote class="outcome"><p>“${esc(p.evidence.quote)}”</p>
        <cite>What they reported, <a href="${esc(p.evidence.url)}" target="_blank" rel="noopener">${esc(p.evidence.call)} call ↗</a></cite></blockquote>` : ""}
      ${p.note ? `<p class="detail">${esc(p.note)}</p>` : ""}
      ${p.model_verdict ? `<p class="override">The model said “${esc(VERDICT[p.model_verdict] || p.model_verdict)}”. ${p.settled_by === "date" ? "The deadline hasn't passed, so it stays pending." : "The reported number says otherwise, and the number wins."}</p>` : ""}
    </div>` : ""}
  </div>`;
}

export function researchHTML(st, ctx) {
  const idx = st.researchIndex || {};
  const chips = Object.entries(idx).map(([s, v]) => `<button class="chip" data-act="research" data-sym="${esc(s)}" aria-pressed="${st.ticker === s}">${esc(v.name.replace(/ (Ltd|Limited)\.?$/, ""))}</button>`).join("");
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
  return `<p class="lede">Promised vs delivered</p>
    <form class="tickerform" data-form="research">
      <input name="ticker" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Any NSE ticker, e.g. TCS" value="${esc(st.tickerInput || "")}" aria-label="NSE ticker">
      <button class="primary" type="submit">Read the calls</button>
    </form>
    ${chips ? `<div class="windows chips-wrap">${chips}</div>` : ""}
    ${body}`;
}

function resultHTML(r, st, ctx) {
  const s = summary(r);
  const order = [...r.promises].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
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
  const segs = `<svg viewBox="0 0 100 8" preserveAspectRatio="none" class="scorebar-svg">${ORDER.filter((k) => s.counts[k]).map((k) => {
    const w = (s.counts[k] / total) * 100, rect = `<rect class="v-${k}" x="${x.toFixed(2)}" y="0" width="${Math.max(w - 0.6, 0.4).toFixed(2)}" height="8" rx="1.5"/>`;
    x += w; return rect;
  }).join("")}</svg>`;
  return `<article class="card research">
    <div class="card-top"><span class="co">${esc(r.name)}</span><span class="tag">${esc(r.symbol)}</span><time>results to ${esc(r.latest_period)}</time></div>
    <h3>${s.settled ? `${s.delivered} of ${s.settled} settled promises delivered` : "No promise has reached its deadline yet"}</h3>
    <div class="scorebar" role="img" aria-label="${ORDER.filter((k) => s.counts[k]).map((k) => `${s.counts[k]} ${VERDICT[k]}`).join(", ")}">${segs}</div>
    <p class="legend">${ORDER.filter((k) => s.counts[k]).map((k) => `<span><i class="dot v-${k}"></i>${s.counts[k]} ${esc(VERDICT[k].toLowerCase())}</span>`).join("")}</p>
    <p class="sub">From the ${r.calls.map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(monthLabel(c.month))}</a>`).join(", ")} ${esc(r.calls.at(-1).month.slice(0, 4))} calls. Tap a promise for the exact words.</p>
    ${who.length ? `<div class="ask"><p class="ask-h">Who to call about it</p>${q ? `<p class="question">${esc(q)}</p>` : ""}${who.map(whoRow).join("")}</div>`
      : `<p class="nobody">No one in your network has a known link to ${esc(r.name)}.</p>`}
  </article>
  <div class="ledger">${order.map((p) => promiseRow(p, r, st.open.has(`p:${r.symbol}:${p.id}`))).join("")}</div>
  <p class="foot">Read by ${esc(r.models.extract)}, judged by ${esc(r.models.judge)} · ${r.usage.calls} model calls, ${(r.usage.tokens_in + r.usage.tokens_out).toLocaleString("en-IN")} tokens, free tier ·
    ${r.checks.quotes_dropped} quote${r.checks.quotes_dropped === 1 ? "" : "s"} dropped for not being in the transcript · ${r.checks.overrides} verdict${r.checks.overrides === 1 ? "" : "s"} overruled by numbers or dates.</p>`;
}
