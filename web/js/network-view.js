// The Network, asked directly: who do I know at a company, on a theme, or near a person?
import { whoKnows, experts, routesTo, tie } from "./network.js";
import { esc, initials, whoRow, routeRow, spoke, bars, closeness } from "./ui.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();

export function search(q, ctx, orgs) {
  const n = norm(q);
  if (n.length < 2) return null;
  const hit = (s) => norm(s).includes(n) || (n.length >= 3 && norm(s).split(" ").some((w) => w.startsWith(n)));
  const themes = Object.entries(orgs.themes).filter(([k, name]) => hit(name) || hit(k)).map(([k]) => k);
  const companies = Object.entries(orgs.orgs)
    .filter(([, o]) => o.symbol || o.peers || o.parent)
    .filter(([, o]) => [o.name, o.symbol, ...(o.aliases || [])].some(hit)).map(([k]) => k).slice(0, 3);
  const people = ctx.people.filter((p) => hit(p.name)).slice(0, 3);
  const contacts = ctx.net.contacts.filter((c) => hit(c.name)).slice(0, 3);
  return { themes, companies, people, contacts };
}

function contactCard(c, ctx) {
  const t = tie(c, ctx.net.as_of);
  return `<div class="card">
    <div class="contact"><span class="avatar" aria-hidden="true">${esc(initials(c.name))}</span>
      <div class="c-body"><div class="c-name">${esc(c.name)} <span class="c-why">· ${esc(c.headline)}</span></div>
        <div class="c-why">${esc(c.rel.how)}</div>
        <div class="c-meta"><span class="meter">${bars(closeness(t))} you: ${spoke(t)}</span><span>${esc(c.city)}</span></div></div></div>
    <ul class="facts">${c.career.map((s) => `<li>${esc(s.role)}, ${esc(s.org)} <span class="yrs">${s.from}–${s.to ?? "now"}</span></li>`).join("")}
      ${c.education.map((e) => `<li>${esc(e.degree)}, ${esc(e.school)} <span class="yrs">${e.from}–${e.to}</span></li>`).join("")}</ul>
  </div>`;
}

export function networkHTML(st, ctx, orgs) {
  const res = search(st.netQuery || "", ctx, orgs);
  const themeChips = Object.entries(orgs.themes).filter(([k]) => experts(k, ctx.net, ctx.R).length >= 2)
    .map(([k, name]) => `<button class="chip" data-act="netq" data-q="${esc(name)}">${esc(name)}</button>`).join("");
  let body = "";
  if (!res) {
    const near = ctx.people.map((p) => ({ p, r: routesTo(p, ctx.net, ctx.R)[0] })).filter((x) => x.r && x.r.link.score >= 0.35)
      .sort((a, b) => b.r.score - a.r.score).slice(0, 4);
    body = `<h2 class="section">Executives in this month's filings you can reach</h2>
      ${near.map(({ p, r }) => `<div class="card"><div class="card-top"><span class="co">${esc(p.name)}</span><span class="tag">${esc(p.symbol)}</span></div>
        <p class="detail">${esc(p.event.kind === "appointed" ? `New ${p.event.role}` : `${p.event.kind} as ${p.event.role}`)}</p>${routeRow(r)}</div>`).join("")}
      <p class="foot">Your network: ${ctx.net.contacts.length} people (synthetic for this demo). It lives on this phone; matching runs here.</p>`;
  } else {
    const parts = [];
    for (const k of res.themes) {
      const xs = experts(k, ctx.net, ctx.R).slice(0, 5);
      parts.push(`<h2 class="section">Go-to people on ${esc(orgs.themes[k].toLowerCase())}</h2><div class="card">${xs.map((x) => whoRow({
        contact: x.contact, tie: x.tie, how: x.current ? "inside" : "alumnus",
        text: `${x.years} years: ${x.where.slice(0, 3).join(", ")}${x.current ? " (now)" : ""}` })).join("")}</div>`);
    }
    for (const k of res.companies) {
      const xs = whoKnows(k, ctx.net, ctx.R).slice(0, 5);
      parts.push(`<h2 class="section">Who knows ${esc(orgs.orgs[k].name)}</h2>${xs.length ? `<div class="card">${xs.map(whoRow).join("")}</div>`
        : `<p class="nobody">No one in your network has worked there, at a competitor, a supplier or a customer.</p>`}`);
    }
    for (const p of res.people) {
      const rs = routesTo(p, ctx.net, ctx.R).slice(0, 3);
      parts.push(`<h2 class="section">Who can reach ${esc(p.name)}</h2>${rs.length ? `<div class="card">${rs.map(routeRow).join("")}</div>`
        : `<p class="nobody">${esc(p.gap || "No known link.")}</p>`}`);
    }
    for (const c of res.contacts) parts.push(`<h2 class="section">In your network</h2>${contactCard(c, ctx)}`);
    body = parts.join("") || `<p class="nobody">Nothing in your network matches “${esc(st.netQuery)}”.</p>`;
  }
  return `<p class="lede">Who can help me understand this?</p>
    <form class="tickerform" data-form="network">
      <input name="q" autocomplete="off" spellcheck="false" placeholder="A company, a theme or a person" value="${esc(st.netQuery || "")}" aria-label="Search your network">
      <button class="primary" type="submit">Ask</button>
    </form>
    <div class="windows chips-wrap">${themeChips}</div>
    ${body}`;
}
