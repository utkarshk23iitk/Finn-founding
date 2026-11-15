// Small display helpers shared by every screen.
import { parseLocal } from "./today.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function when(iso, withTime = true) {
  const d = parseLocal(iso);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (!withTime || iso.endsWith("T15:30:00")) return day;
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  return `${day}, ${(h % 12) || 12}:${m} ${h < 12 ? "am" : "pm"}`;
}
export const pct = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
export const mult = (x) => `${x.toFixed(1)}×`;
export const initials = (name) => name.replace(/^dr\.?\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: keep in memory */ } },
};
export function spoke(tie) {
  const m = tie.months;
  const txt = tie.days < 14 ? "spoke this fortnight" : m < 1 ? "spoke this month" : m === 1 ? "spoke a month ago" : `spoke ${m} months ago`;
  return m >= 6 ? `<span class="stale">${txt}</span>` : txt;
}
export const bars = (level) => `<span class="bars s${level}"><i></i><i></i><i></i></span>`;
export const LEVEL = { strong: 3, medium: 2, weak: 1, none: 0 };
export const closeness = (tie) => (tie.score >= 0.6 ? 3 : tie.score >= 0.3 ? 2 : 1);
export const HOW = { inside: "works there", alumnus: "worked there", peer: "at a competitor", supplier: "at a supplier",
                     customer: "at a customer", specialist: "specialist" };

// One contact from a who-knows list: name, why, and the two signals.
export function whoRow(w) {
  return `<div class="contact"><span class="avatar" aria-hidden="true">${esc(initials(w.contact.name))}</span>
    <div class="c-body"><div class="c-name">${esc(w.contact.name)}${w.how === "inside" || w.how === "specialist" ? "" : ` <span class="c-why">· now ${esc(w.contact.headline)}</span>`}</div>
      <div class="c-why">${esc(w.text)}</div>
      <div class="c-meta"><span class="meter">${bars(w.how === "inside" || w.how === "alumnus" ? 3 : w.how === "specialist" ? 2 : 1)} ${esc(HOW[w.how] || w.how)}</span>
        <span class="meter">${bars(closeness(w.tie))} you: ${spoke(w.tie)}</span></div></div></div>`;
}

// One route to a real person: the contact, the evidence, both signals.
export function routeRow(r) {
  const c = r.contact, ev = r.link.evidence[0];
  return `<div class="contact"><span class="avatar" aria-hidden="true">${esc(initials(c.name))}</span>
    <div class="c-body"><div class="c-name">${esc(c.name)}</div>
      <div class="c-why">${esc(ev.text)}</div>
      <div class="c-meta"><span class="meter">${bars(LEVEL[r.link.strength])} knows them: ${esc(r.link.strength)}</span>
        <span class="meter">${bars(closeness(r.tie))} you: ${spoke(r.tie)}</span></div></div></div>`;
}
