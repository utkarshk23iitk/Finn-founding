// FINN. Three views over one local state: Updates (push), Research (pull), Network (ask directly).
import { makeResolver } from "./network.js";
import { buildToday, WINDOWS, CATEGORY_LABEL, shortPeopleLine, fromTheVerb } from "./today.js";
import { esc, when, pct, sign, mult, store, whoRow, routeRow } from "./ui.js";
import { researchHTML } from "./research-view.js";
import { networkHTML } from "./network-view.js";

const $app = document.getElementById("app");
const $sheet = document.getElementById("sheet");
const ALERTABLE = ["results", "management_change", "M&A", "litigation", "credit_rating", "fund_raise", "pledging", "capex"];
// "Updates", not "Today": the screen covers whatever window the investor picks (24 hours to a month).
// The link stays #today so existing links keep working.
const TABS = [["today", "Updates"], ["research", "Research"], ["network", "Network"]];

// ---------- state ----------
let feed, ctx, orgsDoc;
const state = {
  view: "today",
  settings: null,
  done: new Set(store.get("finn.done", [])),
  open: new Set(),
  researchIndex: {},
  research: null, researchState: "idle", researchError: "", ticker: "", tickerInput: "",
  netQuery: "",
};

async function load() {
  const get = (p) => fetch(`data/${p}`).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
  const [f, people, orgs, net] = await Promise.all([get("feed.json"), get("people.json"), get("orgs.json"), get("network.json")]);
  feed = f;
  orgsDoc = orgs;
  ctx = { R: makeResolver(orgs), net, people };
  state.settings = { ...feed.defaults, window: "24h", ...store.get("finn.settings", {}) };
  state.researchIndex = await get("research/index.json").catch(() => ({}));
}

// ---------- routing: #today, #research/DIXON, #network/semiconductors ----------
function route() {
  const [view, arg] = decodeURIComponent(location.hash.slice(1)).split("/");
  state.view = TABS.some(([k]) => k === view) ? view : "today";
  if (state.view === "research" && arg && arg.toUpperCase() !== state.ticker) openResearch(arg);
  if (state.view === "network") state.netQuery = arg || "";
  render();
}

async function openResearch(sym) {
  sym = sym.toUpperCase().replace(/[^A-Z0-9&-]/g, "");
  if (!sym) return;
  Object.assign(state, { ticker: sym, tickerInput: sym, research: null, researchState: "loading" });
  render();
  try {
    // Prepared companies are static files; any other ticker is read on demand and cached for a day.
    const local = state.researchIndex[sym] ? await fetch(`data/research/${encodeURIComponent(sym)}.json`) : null;
    const r = local?.ok ? local : await fetch(`api/research?symbol=${encodeURIComponent(sym)}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error(body.error || `The research service answered ${r.status}.`);
    if (state.ticker === sym) Object.assign(state, { research: body, researchState: "ready" });
  } catch (e) {
    // A dropped connection usually means the first read is still finishing on the server.
    const msg = e instanceof TypeError
      ? "The first read of a new company can take a couple of minutes, and the connection dropped before it finished. Try again shortly; once done, it's cached for a day."
      : e.message;
    if (state.ticker === sym) Object.assign(state, { researchState: "error", researchError: msg });
  }
  render();
}

// ---------- rendering ----------
function render() {
  const today = state.view === "today" ? buildToday(feed, state.settings, ctx, state.done) : null;
  $app.innerHTML = `
    <header class="top" id="top">
      <div class="brandrow">
        <span class="brand">FINN</span>
        <nav class="tabs" aria-label="Views">${TABS.map(([k, l]) => `<a href="#${k}${k === "research" && state.ticker ? `/${esc(state.ticker)}` : ""}" class="tab" aria-current="${state.view === k ? "page" : "false"}">${l}</a>`).join("")}</nav>
        ${state.view === "today" ? `<button class="iconbtn" data-act="settings" aria-label="Alert rules">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h7M12 4h2M2 12h3M8 12h6"/><circle cx="10.5" cy="4" r="1.6"/><circle cx="6.5" cy="12" r="1.6"/></svg>
          Rules</button>` : ""}
      </div>
      ${today ? `<div class="subrow"><nav class="windows" aria-label="Time window">
        ${WINDOWS.map((w) => `<button class="chip" data-act="window" data-w="${w.key}" aria-pressed="${w.key === today.window.key}" aria-label="Last ${esc(w.label)}">${esc(w.label[0].toUpperCase() + w.label.slice(1))}</button>`).join("")}
      </nav></div>` : ""}
    </header>
    ${today ? todayHTML(today) : state.view === "research" ? researchHTML(state, ctx) : networkHTML(state, ctx, orgsDoc)}
    <footer class="foot">
      <p><b>Your network stays on this phone.</b> Matching runs here, and the page is not allowed to send data to any other server.
        The demo network is ${ctx.net.contacts.length} synthetic people; facts about real executives come only from their companies' filings.</p>
      <p>Filings: NSE. Prices: NSE end-of-day file and Yahoo Finance. Research: the company's own earnings-call transcripts.</p>
    </footer>`;
}

function todayHTML(t) {
  const n = t.needs.length;
  const lede = n === 0
    ? `Nothing needs you in the last ${t.window.label}.`
    : `<span class="n">${n}</span> thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`;
  return `
    <h1 class="lede">${lede}</h1>
    <p class="sub">${[`As of ${esc(when(t.asOf))}`, t.glance.length && `${t.glance.length} worth a glance`, t.routineCount && `${t.routineCount} routine filings folded`,
                      t.cleared.length && `${t.cleared.length} done`].filter(Boolean).join(" · ")}</p>

    ${t.needs.map(card).join("") || `<div class="card clear"><b>All clear</b>Widen the window or loosen the rules to see more.</div>`}
    ${n ? `<div class="clear"><b>That's everything that needs you.</b>Below: one-liners and the folded paperwork.</div>` : ""}

    ${t.glance.length ? `<h2 class="section">Worth a glance <span>${t.glance.length}</span></h2>
      <div class="rows">${t.glance.map(row).join("")}</div>` : ""}

    ${t.warm.length ? `<h2 class="section">Worth a call</h2>
      <div class="rows">${t.warm.map(warmRow).join("")}</div>` : ""}

    ${t.routineCount ? `<h2 class="section">Routine</h2>
      <details class="fold"><summary>${t.routineCount} filings of paperwork</summary>
        <ul class="counts">${t.routine.map(([l, c]) => `<li><b>${c}</b>${esc(l)}</li>`).join("")}</ul></details>` : ""}

    ${t.cleared.length ? `<h2 class="section">Done</h2>
      <details class="fold"><summary>${t.cleared.length} cleared</summary>
        <div>${t.cleared.map((c) => `<p class="detail">${esc(c.company?.name)}: ${esc(c.kind === "price" ? priceHeadline(c) : c.headline)}
          <button class="linkbtn" data-act="undone" data-id="${esc(c.id)}">Restore</button></p>`).join("")}</div></details>` : ""}`;
}

function card(c) {
  const co = c.company || { name: c.symbol };
  const tag = c.kind === "price" ? "Price and volume" : CATEGORY_LABEL[c.category] || c.category;
  const hot = c.priority >= 85 ? " hot" : "";
  const body = c.kind === "price" ? priceBody(c) : filingBody(c);
  const files = c.kind === "price" ? [] : c.items;
  const primary = files[0];
  return `<article class="card" data-id="${esc(c.id)}">
    <div class="card-top"><span class="co">${esc(co.name)}</span><span class="tag${hot}">${esc(tag)}</span><time>${esc(when(c.time, c.kind !== "price"))}</time></div>
    ${body}
    ${askBlock(c)}
    ${c.context?.length ? `<p class="also"><b>Also this month:</b> ${c.context.map((f) => `${esc(label(f))}, ${esc(when(f.time, false))}`).join(" · ")}</p>` : ""}
    <div class="card-foot">
      ${primary ? `<a href="${esc(primary.url)}" target="_blank" rel="noopener">Filing ↗</a>` : ""}
      ${files.length > 1 ? `<button class="linkbtn" data-act="toggle" data-id="${esc(c.id)}">${state.open.has(c.id) ? "Hide" : `${files.length} filings`}</button>` : ""}
      <span class="spacer"></span>
      <button class="done" data-act="done" data-id="${esc(c.id)}">Done</button>
    </div>
    ${state.open.has(c.id) ? `<ul class="filings">${files.map((f) => `<li><time>${esc(when(f.time))}</time><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(short(f))}</a></li>`).join("")}</ul>` : ""}
  </article>`;
}

const short = (f) => (f.category === "management_change" ? shortPeopleLine(f.headline) : fromTheVerb(f.headline));
// A few words for "Also this month": "Q2 FY27 results", "Gopal Kothari named CFO", "Initiation of Forensic Audit".
function label(f) {
  const q = f.category === "results" && f.headline.match(/\((Q\d FY\d\d)\)/);
  if (q) return `${q[1]} results`;
  const s = short(f);
  return s.length > 70 ? `${s.slice(0, 68).replace(/\s+\S*$/, "")}…` : s;
}

function filingBody(c) {
  const moves = (c.moves || []).map((a) => `<span class="move">${esc(when(a.time, false))}: <span class="${sign(a.move)}">${pct(a.move)}</span> · ${mult(a.volMult)} usual volume</span>`).join("");
  const people = (c.network?.persons || []).map(personBlock).join("");
  const res = c.category === "results" ? feed.results?.[c.symbol] : null;
  if (res && res.lines && !res.error) {
    const [lead, ...rest] = res.summary.split(" · ");
    const q = c.headline.match(/\((Q\d FY\d\d)\)/)?.[1] || "";
    return `<h3>${esc(q ? `${q}: ` : "")}${esc(lead)}</h3>
      ${rest.length ? `<p class="detail">${esc(rest.join(" · "))}</p>` : ""}
      ${resultsTable(res, q)}
      ${moves ? `<div class="moves">${moves}</div>` : ""}`;
  }
  return `<h3>${esc(c.headline)}</h3>
    ${c.detail ? `<p class="detail">${esc(c.detail)}</p>` : ""}
    ${moves ? `<div class="moves">${moves}</div>` : ""}
    ${people}`;
}

// Revenue, EBITDA, PBT, PAT against last quarter and a year ago, read from the filing's XBRL by code.
function resultsTable(r, q) {
  const cell = (l, k) => l[`${k}_flip`]
    ? `<td class="flip ${/profit|narrowed/.test(l[`${k}_flip`]) ? "up" : "down"}">${esc(l[`${k}_flip`])}</td>`
    : l[k] == null ? "<td>–</td>" : `<td class="${l[k] >= 0 ? "up" : "down"}">${pct(l[k])}</td>`;
  const rows = [["revenue", r.lender ? "Revenue (total)" : "Revenue"], ["ebitda", "EBITDA"], ["pbt", "PBT"], ["pat", "PAT"]]
    .filter(([k]) => !(k === "ebitda" && r.lender));
  return `<table class="rtable"><thead><tr><th></th><th>${esc(q || "Quarter")}, ₹ cr</th><th>QoQ</th><th>YoY</th></tr></thead><tbody>
    ${rows.map(([k, name]) => { const l = r.lines[k]; return `<tr><th>${name}</th><td class="num">${l.cur == null ? "–" : l.cur.toLocaleString("en-IN", { maximumFractionDigits: 0 }).replace("-", "−")}</td>${cell(l, "qoq")}${cell(l, "yoy")}</tr>`; }).join("")}
    </tbody></table>
    <p class="src">${r.lender ? "EBITDA isn't meaningful for a lender, so it's left out. " : "EBITDA = PBT + finance costs + depreciation − other income − exceptional items. "}
      ${r.check && r.check !== "ok" ? `${esc(r.check)}. ` : ""}<a href="${esc(r.url)}" target="_blank" rel="noopener">${r.consolidated ? "Consolidated" : "Standalone"} filing ↗</a></p>`;
}

function priceHeadline(c) {
  const a = c.move;
  return `${pct(a.move)} on ${when(a.time, false)}, ${mult(a.volMult)} its usual volume`;
}

function priceBody(c) {
  const rows = feed.prices[c.symbol].slice(-40);
  const hits = new Set(c.days.map((d) => d.date));
  const w = 320, h = 44, n = rows.length, bw = w / n;
  const vmax = Math.max(...rows.map((r) => r[2])), pmin = Math.min(...rows.map((r) => r[1])), pmax = Math.max(...rows.map((r) => r[1]));
  const barsSvg = rows.map((r, i) => {
    const bh = Math.max(1.5, (r[2] / vmax) * (h - 6));
    return `<rect class="bar${hits.has(r[0]) ? " hit" : ""}" x="${(i * bw + 0.6).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${bh.toFixed(1)}"/>`;
  }).join("");
  const line = rows.map((r, i) => `${(i * bw + bw / 2).toFixed(1)},${(4 + (1 - (r[1] - pmin) / (pmax - pmin || 1)) * (h - 18)).toFixed(1)}`).join(" ");
  const others = c.days.filter((d) => d !== c.move);
  const why = c.why
    ? `<p class="why">Likely why: <b>${esc(short(c.why))}</b> (${esc(when(c.why.time))})</p>`
    : `<p class="why"><b>No filing explains it.</b> Nothing material was filed in the two days before.</p>`;
  return `<h3>${esc(priceHeadline(c))}</h3>
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Volume over the last ${n} sessions, unusual days highlighted">
      ${barsSvg}<polyline class="px" points="${line}"/></svg>
    <p class="spark-cap">Daily volume (bars) and price (line), last ${n} sessions · unusual days in amber</p>
    ${why}
    ${others.length ? `<p class="detail">Also unusual: ${others.map((d) => `${when(d.time, false)} ${pct(d.move)}, ${mult(d.volMult)}`).join(" · ")}</p>` : ""}`;
}

function personBlock({ person: p, routes }) {
  const years = (s) => (!s.from && s.to ? `until ${s.to}`
    : s.from || s.to ? `${s.approx ? "c. " : ""}${s.from}–${s.to ?? "now"}` : s.years_note || "");
  const facts = [
    ...p.career.map((s) => ({ text: s.role.includes(s.org) ? s.role : `${s.role}, ${s.org}`, yrs: years(s) })),
    ...p.education.filter((e) => e.school).map((e) => ({ text: `${e.degree}, ${e.school}` })),
    ...(p.notable || []).map((x) => ({ text: x.text })),
  ].slice(0, 4);
  const effective = p.event.effective ? ` from ${when(`${p.event.effective}T00:00:00`, false)} ${p.event.effective.slice(0, 4)}` : "";
  const verb = p.event.kind === "appointed" ? `${p.event.role}${effective}` : `${p.event.kind} as ${p.event.role}`;
  return `<div class="person">
    <div class="p-head"><b>${esc(p.title ? `${p.title} ${p.name}` : p.name)}</b> · ${esc(verb)}</div>
    ${facts.length ? `<ul class="facts">${facts.map((x) => `<li>${esc(x.text)}${x.yrs ? ` <span class="yrs">${esc(x.yrs)}</span>` : ""}</li>`).join("")}</ul>` : ""}
    ${p.gap ? `<p class="gap">${esc(p.gap)}</p>` : ""}
    ${p.event.url ? `<a class="src" href="${esc(p.event.url)}" target="_blank" rel="noopener">From the filing ↗</a>` : ""}
    ${routes.length ? `<div class="ask"><p class="ask-h">Who can reach ${esc(p.name.split(" ")[0])}</p>${more(`r:${p.id}`, routes, routeRow)}</div>` : ""}
  </div>`;
}

// The best one first; the rest a tap away. A morning scan shouldn't scroll past three names per card.
function more(key, list, draw) {
  if (list.length <= 1) return list.map(draw).join("");
  const open = state.open.has(key);
  return draw(list[0]) + (open ? list.slice(1).map(draw).join("") : "")
    + `<button class="linkbtn morebtn" data-act="toggle" data-id="${esc(key)}">${open ? "Fewer" : `${list.length - 1} more`}</button>`;
}

function askBlock(c) {
  const who = c.network?.who || [];
  const persons = c.network?.persons || [];
  if (!who.length) return persons.length && !persons.some((p) => p.routes.length) ? `<p class="nobody">No one in your network has a known link yet.</p>` : "";
  const title = persons.length ? `Who knows ${c.company?.name || c.symbol}` : `Ask about this`;
  return `<div class="ask"><p class="ask-h">${esc(title)}</p>${more(`w:${c.id}`, who, whoRow)}</div>`;
}

function row(c) {
  const open = state.open.has(c.id);
  return `<div class="row"><button data-act="toggle" data-id="${esc(c.id)}" aria-expanded="${open}">
      <span class="co">${esc(c.company?.name || c.symbol)}</span><span class="h">${esc(c.headline)}</span><time>${esc(when(c.time, false))}</time></button>
    ${open ? `<div class="more">${c.detail ? `<p class="detail">${esc(c.detail)}</p>` : ""}${askBlock(c)}
      <p class="detail"><span class="tag">${esc(CATEGORY_LABEL[c.category] || c.category)}</span>
      ${c.items.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(when(f.time, false))} filing ↗</a>`).join(" · ")}</p></div>` : ""}</div>`;
}

function warmRow(r) {
  const c = r.contact;
  return `<div class="row"><div class="contact padded"><span class="avatar" aria-hidden="true">${esc(c.name.replace(/^dr\.?\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join(""))}</span>
    <div class="c-body"><div class="c-name">${esc(c.name)} <span class="c-why">· ${esc(c.headline)}</span></div>
      <div class="c-why">${esc(r.why)}.</div>
      <div class="c-meta">Reason to call: ${esc(feed.companies[r.event.symbol]?.name || r.event.symbol)}, ${esc(r.event.title.replace(/^Results for .*\((Q\d FY\d\d)\)$/, "$1 results"))}</div></div></div></div>`;
}

// ---------- settings sheet ----------
function openSettings() {
  const s = state.settings;
  $sheet.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="rules-h">
    <h2 id="rules-h">Alert rules</h2>
    <p class="hint">You decide what "unusual" means. The queue re-sorts as you change these.</p>
    <div class="field"><label for="vol">Volume above <output id="vol-o">${mult(s.volume_multiple)}</output></label>
      <input id="vol" type="range" min="1.5" max="6" step="0.5" value="${s.volume_multiple}" data-set="volume_multiple">
      <p class="hint">Compared with the median of the previous ${s.volume_lookback} sessions.</p></div>
    <div class="field"><label for="move">Price move beyond <output id="move-o">±${s.price_move_pct}%</output></label>
      <input id="move" type="range" min="2" max="10" step="0.5" value="${s.price_move_pct}" data-set="price_move_pct"></div>
    <div class="field"><label>Filings that should interrupt you</label>
      <div class="toggles">${ALERTABLE.map((k) => `<button class="chip" data-act="cat" data-cat="${k}" aria-pressed="${s.alert_categories.includes(k)}">${esc(CATEGORY_LABEL[k])}</button>`).join("")}</div>
      <p class="hint">Important filings of other types still show, under Worth a glance.</p></div>
    <div class="panel-foot"><button class="linkbtn" data-act="reset">Reset to defaults</button><button class="primary" data-act="close">Done</button></div>
  </div>`;
  $sheet.hidden = false;
  $sheet.querySelector("input")?.focus();
}
function saveSettings() { store.set("finn.settings", state.settings); render(); }

// ---------- events ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) { if (e.target === $sheet) $sheet.hidden = true; return; }
  const id = b.dataset.id, act = b.dataset.act;
  if (act === "window") { state.settings.window = b.dataset.w; saveSettings(); }
  else if (act === "toggle") { state.open.has(id) ? state.open.delete(id) : state.open.add(id); render(); }
  else if (act === "done") { state.done.add(id); store.set("finn.done", [...state.done]); render(); }
  else if (act === "undone") { state.done.delete(id); store.set("finn.done", [...state.done]); render(); }
  else if (act === "settings") openSettings();
  else if (act === "close") $sheet.hidden = true;
  else if (act === "research") location.hash = `research/${b.dataset.sym}`;
  else if (act === "netq") location.hash = `network/${encodeURIComponent(b.dataset.q)}`;
  else if (act === "cat") {
    const set = new Set(state.settings.alert_categories);
    set.has(b.dataset.cat) ? set.delete(b.dataset.cat) : set.add(b.dataset.cat);
    state.settings.alert_categories = [...set];
    b.setAttribute("aria-pressed", set.has(b.dataset.cat));
    saveSettings();
  } else if (act === "reset") {
    state.settings = { ...feed.defaults, window: state.settings.window };
    saveSettings(); openSettings();
  }
});
document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  const value = new FormData(form).values().next().value?.trim() || "";
  if (form.dataset.form === "research" && value) {
    state.ticker = "";   // force a fresh load even for the same ticker
    location.hash = `research/${value.toUpperCase()}`;
  } else if (form.dataset.form === "network") {
    location.hash = value ? `network/${encodeURIComponent(value)}` : "network";
  }
});
$sheet.addEventListener("input", (e) => {
  const k = e.target.dataset.set;
  if (!k) return;
  state.settings[k] = Number(e.target.value);
  document.getElementById("vol-o").textContent = mult(state.settings.volume_multiple);
  document.getElementById("move-o").textContent = `±${state.settings.price_move_pct}%`;
  saveSettings();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $sheet.hidden = true; });
window.addEventListener("scroll", () => document.getElementById("top")?.classList.toggle("scrolled", scrollY > 4), { passive: true });
window.addEventListener("hashchange", route);

load().then(route).catch((err) => {
  $app.innerHTML = `<p class="loading">Couldn't load today's data (${esc(err.message)}). Reload to try again.</p>`;
});
