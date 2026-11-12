import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as T from "../web/js/today.js";
import { makeResolver } from "../web/js/network.js";

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../web/data/${p}`, import.meta.url), "utf8"));
const feed = read("feed.json");
const ctx = { R: makeResolver(read("orgs.json")), net: read("network.json"), people: read("people.json") };
const today = (over = {}, done) => T.buildToday(feed, { ...feed.defaults, window: "24h", ...over }, ctx, done);

test("volume is compared with the median, so one huge day doesn't hide the next", () => {
  const rows = [["d0", 100, 10], ["d1", 100, 10], ["d2", 100, 500], ["d3", 100, 10], ["d4", 100, 30]];
  const last = T.priceSignals(rows, 20).at(-1);
  assert.equal(last.volMult, 3, "30 against a median of 10, not a mean of 132.5");
});

test("windows count back from the snapshot, not from the phone's clock", () => {
  const items = [{ time: "2026-11-12T03:00:00" }, { time: "2026-11-12T01:00:00" }];
  assert.equal(T.inWindow(items, "2026-11-13T02:16", 24).length, 1);
});

test("price alerts follow the investor's thresholds", () => {
  const rows = { X: [["2026-11-10", 100, 10], ["2026-11-11", 100, 10], ["2026-11-12", 103, 25]] };
  const rule = (v, p) => ({ volume_multiple: v, price_move_pct: p, volume_lookback: 20 });
  assert.equal(T.priceAlerts(rows, "2026-11-13T02:16", 24, rule(2, 5)).length, 1, "2.5x volume");
  assert.equal(T.priceAlerts(rows, "2026-11-13T02:16", 24, rule(3, 5)).length, 0);
  assert.equal(T.priceAlerts(rows, "2026-11-13T02:16", 24, rule(3, 2.5)).length, 1, "+3% move");
});

test("results win 'likely why' over other filings the same day", () => {
  const filings = [
    { symbol: "A", priority: 85, category: "management_change", time: "2026-11-12T13:58:00", id: "cfo" },
    { symbol: "A", priority: 80, category: "results", time: "2026-11-12T14:30:00", id: "res" },
  ];
  assert.equal(T.likelyWhy({ symbol: "A", date: "2026-11-12" }, filings).id, "res");
});

test("leadership filings become one line each", () => {
  assert.equal(T.shortPeopleLine("Appointment of Mr Gopal Kothari as Chief Financial Officer of the Company w.e.f. December 02, 2026"),
    "Gopal Kothari named CFO");
  assert.equal(T.shortPeopleLine("Retirement of Mr. Noel N. Tata as Chairman and Director w.e.f 11th November, 2026 and his appointment as Chairman Emeritus"),
    "Noel N. Tata retires as Chairman and Director");
  assert.equal(T.shortPeopleLine("Resignation of Mr. Mohit Malhotra as Global Chief Executive Officer and Whole-time Director, from the Company"),
    "Mohit Malhotra resigns as Global CEO and whole-time director");
  assert.equal(T.shortPeopleLine("Initiation of Forensic Audit"), "Initiation of Forensic Audit");
});

test("last 24 hours: Alkem's results carry the volume spike; its new CFO brings the filed profile and who to ask", () => {
  const t = today();
  const results = t.needs.find((c) => c.symbol === "ALKEM" && c.category === "results");
  assert.ok(results.moves?.length, "the 12 Nov spike joins the results card");
  assert.ok(results.moves[0].volMult > 9);
  const cfo = t.needs.find((c) => c.symbol === "ALKEM" && c.category === "management_change");
  assert.equal(cfo.headline, "Gopal Kothari named CFO");
  assert.equal(cfo.network.persons[0].person.name, "Gopal Kothari");
  assert.equal(cfo.network.persons[0].routes.length, 0, "the filing names no past employer");
  assert.equal(cfo.network.who[0].contact.name, "Leena Fernandes");
  assert.ok(cfo.context.some((f) => /forensic/i.test(f.headline)), "the forensic audit is shown as context");
});

test("the investor's rules move cards between sections", () => {
  const base = today();
  const quiet = today({ alert_categories: base.needs.length ? ["results"] : [] });
  assert.ok(!quiet.needs.some((c) => c.category === "management_change"));
  assert.ok(quiet.glance.some((c) => c.symbol === "ALKEM" && c.category === "management_change"), "still visible, one line");
  const calm = today({ volume_multiple: 12, price_move_pct: 10 });
  assert.ok(!calm.needs.some((c) => c.kind === "price" || c.moves?.length));
});

test("a week: one card per company and category, and done cards leave the queue", () => {
  const t = today({ window: "7d" });
  const keys = t.needs.map((c) => `${c.symbol}|${c.category}`);
  assert.equal(new Set(keys).size, keys.length);
  const voltas = t.needs.find((c) => c.symbol === "VOLTAS" && c.category === "management_change");
  assert.match(voltas.headline, /Jayant Balan named MD/);
  assert.deepEqual(voltas.network.persons.find((p) => p.person.id === "balan").routes.map((r) => r.contact.name).slice(0, 2),
    ["Vikram Desai", "Meera Pillai"]);
  const after = today({ window: "7d" }, new Set([voltas.id]));
  assert.ok(!after.needs.some((c) => c.id === voltas.id));
  assert.ok(after.cleared.some((c) => c.id === voltas.id));
});

test("routine paperwork is counted, not shown", () => {
  const t = today({ window: "7d" });
  assert.ok(t.routineCount > 20);
  assert.equal(t.routine.reduce((n, [, c]) => n + c, 0), t.routineCount);
});
