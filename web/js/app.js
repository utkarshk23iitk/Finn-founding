// FINN Today screen. Renders the queue built by today.js; all state is local.
import { makeResolver } from "./network.js";
import { buildToday, WINDOWS, CATEGORY_LABEL, parseLocal, shortPeopleLine } from "./today.js";

const $app = document.getElementById("app");
const $sheet = document.getElementById("sheet");
const ALERTABLE = ["results", "management_change", "M&A", "litigation", "credit_rating", "fund_raise", "pledging", "capex"];

// ---------- small helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function when(iso, withTime = true) {
  const d = parseLocal(iso);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (!withTime || iso.endsWith("T15:30:00")) return day;
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  return `${day}, ${(h % 12) || 12}:${m} ${h < 12 ? "am" : "pm"}`;
}
const pct = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
const mult = (x) => `${x.toFixed(1)}×`;
const initials = (name) => name.replace(/^dr\.?\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: keep in memory */ } },
};
function spoke(tie) {
  const m = tie.months;
  const txt = tie.days < 14 ? "spoke this fortnight" : m < 1 ? "spoke this month" : m === 1 ? "spoke a month ago" : `spoke ${m} months ago`;
  return m >= 6 ? `<span class="stale">${txt}</span>` : txt;
}
const bars = (level) => `<span class="bars s${level}"><i></i><i></i><i></i></span>`;
const LEVEL = { strong: 3, medium: 2, weak: 1, none: 0 };
const closeness = (tie) => (tie.score >= 0.6 ? 3 : tie.score >= 0.3 ? 2 : 1);

// ---------- state ----------
let feed, ctx;
const state = {
  settings: null,
  done: new Set(store.get("finn.done", [])),
  open: new Set(),
};

async function load() {
  const get = (p) => fetch(`data/${p}`).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
  const [f, people, orgs, net] = await Promise.all([get("feed.json"), get("people.json"), get("orgs.json"), get("network.json")]);
  feed = f;
  ctx = { R: makeResolver(orgs), net, people };
  state.settings = { ...feed.defaults, window: "24h", ...store.get("finn.settings", {}) };
}

// ---------- rendering ----------
function render() {
  const t = buildToday(feed, state.settings, ctx, state.done);
  const n = t.needs.length;
  const lede = n === 0
    ? `Nothing needs you in the last ${t.window.label}.`
    : `<span class="n">${n}</span> thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`;
  $app.innerHTML = `
    <header class="top" id="top">
      <div class="brandrow">
        <span class="brand">FINN</span>
        <span class="asof">As of ${esc(when(t.asOf))}</span>
        <button class="iconbtn" data-act="settings" aria-label="Alert rules">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h7M12 4h2M2 12h3M8 12h6"/><circle cx="10.5" cy="4" r="1.6"/><circle cx="6.5" cy="12" r="1.6"/></svg>
          Rules
        </button>
      </div>
      <nav class="windows" aria-label="Time window">
        ${WINDOWS.map((w) => `<button class="chip" data-act="window" data-w="${w.key}" aria-pressed="${w.key === t.window.key}" aria-label="Last ${esc(w.label)}">${esc(w.label[0].toUpperCase() + w.label.slice(1))}</button>`).join("")}
      </nav>
    </header>
    <p class="lede">${lede}</p>
    <p class="sub">${[t.glance.length && `${t.glance.length} worth a glance`, t.routineCount && `${t.routineCount} routine filings folded`,
                      t.cleared.length && `${t.cleared.length} done`].filter(Boolean).join(" · ") || `Last ${esc(t.window.label)}`}</p>

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
          <button class="linkbtn" data-act="undone" data-id="${esc(c.id)}">Restore</button></p>`).join("")}</div></details>` : ""}

    <footer class="foot">
      <p><b>Your network stays on this phone.</b> Matching runs here; no contact is sent to a server or a model.
        The demo network is 45 synthetic people; facts about real executives come only from their companies' filings.</p>
      <p>Filings: NSE. Prices: NSE end-of-day file and Yahoo Finance. Volume is compared with the median of the previous 20 sessions.</p>
    </footer>`;
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

const short = (f) => (f.category === "management_change" ? shortPeopleLine(f.headline) : f.headline);
// A few words for "Also this month": "Q2 FY27 results", "Gopal Kothari named CFO", "Initiation of Forensic Audit".
function label(f) {
  const q = f.category === "results" && f.headline.match(/\((Q\d FY\d\d)\)/);
  if (q) return `${q[1]} results`;
  const s = short(f);
  return s.length > 70 ? `${s.slice(0, 68).replace(/\s+\S*$/, "")}…` : s;
}

function filingBody(c) {
  const moves = (c.moves || []).map((a) => `<span class="move">${esc(when(a.time, false))}: <span class="${a.move >= 0 ? "up" : "down"}">${pct(a.move)}</span> · ${mult(a.volMult)} usual volume</span>`).join("");
  const people = (c.network?.persons || []).map(personBlock).join("");
  return `<h3>${esc(c.headline)}</h3>
    ${c.detail ? `<p class="detail">${esc(c.detail)}</p>` : ""}
    ${moves ? `<div class="moves">${moves}</div>` : ""}
    ${people}`;
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

function routeRow(r) {
  const c = r.contact, ev = r.link.evidence[0];
  return `<div class="contact"><span class="avatar" aria-hidden="true">${esc(initials(c.name))}</span>
    <div class="c-body"><div class="c-name">${esc(c.name)}</div>
      <div class="c-why">${esc(ev.text)}</div>
      <div class="c-meta"><span class="meter">${bars(LEVEL[r.link.strength])} knows them: ${esc(r.link.strength)}</span>
        <span class="meter">${bars(closeness(r.tie))} you: ${spoke(r.tie)}</span></div></div></div>`;
}

function askBlock(c) {
  const who = c.network?.who || [];
  const persons = c.network?.persons || [];
  if (!who.length) return persons.length && !persons.some((p) => p.routes.length) ? `<p class="nobody">No one in your network has a known link yet.</p>` : "";
  const coName = c.company?.name || c.symbol;
  const title = persons.length ? `Who knows ${coName}` : `Ask about this`;
  // Their current job is shown only when the reason is a past one; otherwise it repeats.
  const draw = (w) => `
    <div class="contact"><span class="avatar" aria-hidden="true">${esc(initials(w.contact.name))}</span>
      <div class="c-body"><div class="c-name">${esc(w.contact.name)}${w.how === "inside" || w.how === "specialist" ? "" : ` <span class="c-why">· now ${esc(w.contact.headline)}</span>`}</div>
        <div class="c-why">${esc(w.text)}</div>
        <div class="c-meta"><span class="meter">${bars(w.how === "inside" || w.how === "alumnus" ? 3 : w.how === "specialist" ? 2 : 1)} ${esc(HOW[w.how] || w.how)}</span>
          <span class="meter">${bars(closeness(w.tie))} you: ${spoke(w.tie)}</span></div></div></div>`;
  return `<div class="ask"><p class="ask-h">${esc(title)}</p>${more(`w:${c.id}`, who, draw)}</div>`;
}
const HOW = { inside: "works there", alumnus: "worked there", peer: "at a competitor", supplier: "at a supplier",
              customer: "at a customer", specialist: "specialist" };

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
  return `<div class="row"><div class="contact padded"><span class="avatar" aria-hidden="true">${esc(initials(c.name))}</span>
    <div class="c-body"><div class="c-name">${esc(c.name)} <span class="c-why">· ${esc(c.headline)}</span></div>
      <div class="c-why">${esc(r.why)}.</div>
      <div class="c-meta">Reason to call: ${esc(feed.companies[r.event.symbol]?.name || r.event.symbol)}, ${esc(r.event.title)}</div></div></div></div>`;
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

load().then(render).catch((err) => {
  $app.innerHTML = `<p class="loading">Couldn't load today's data (${esc(err.message)}). Reload to try again.</p>`;
});
