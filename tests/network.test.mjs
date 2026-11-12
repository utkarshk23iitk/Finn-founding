// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as E from "../web/js/network.js";

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const orgs = read("data/network/orgs.json");
const net = read("data/network/demo_network.json");
const people = read("data/people/executives.json").people;
const R = E.makeResolver(orgs);
const person = (id) => people.find((p) => p.id === id);
const names = (rows) => rows.map((r) => r.contact.name);

test("names in filings and profiles resolve to one organisation", () => {
  assert.equal(R.org("Hindustan Unilever"), "unilever");
  assert.equal(R.org("ICICI Bank Limited"), "icici-bank");
  assert.equal(R.org("Tata Administrative Services"), "tas");
  assert.equal(R.org("Cholamandalam Investment and Finance"), "cholamandalam");
  assert.equal(R.school("NIT Surathkal"), R.school("NIT Karnataka"));
  assert.equal(R.school("Sri Venkateshwara University"), "sv-univ");
  assert.equal(R.org("A payments company"), null);
});

test("a company's family runs up and down the ownership chain", () => {
  assert.ok(R.family("amber").has("ascent-circuits"));
  assert.ok(R.family("ascent-circuits").has("amber"));
  assert.ok(!R.family("voltbek").has("trent"), "siblings in a group are not family");
});

test("overlap: confirmed, a shared boundary year, disjoint, unknown, current", () => {
  assert.deepEqual(E.overlap({ from: 2008, to: 2016 }, { from: 2002, to: 2018 }, 2026),
    { kind: "confirmed", from: 2008, to: 2016, years: 8, approx: false });
  assert.equal(E.overlap({ from: 1999, to: 2001 }, { from: 2001, to: null }, 2026).kind, "touching");
  assert.equal(E.overlap({ from: 2004, to: 2009 }, { from: 2012, to: 2020 }, 2026).kind, "disjoint");
  assert.equal(E.overlap({ from: 2006, to: 2017 }, { from: null, to: null }, 2026).kind, "unknown");
  assert.equal(E.overlap({ from: 2018, to: null }, { from: 2020, to: null }, 2026).years, 6);
  // An end year alone still rules out someone who started later.
  assert.equal(E.overlap({ from: 2027, to: null }, { from: null, to: 2026 }, 2027).kind, "disjoint");
});

test("people match on surname plus compatible given names", () => {
  assert.ok(E.samePerson("Mr. V. N. Srivatsan", "Venkat N Srivatsan"));
  assert.ok(E.samePerson("Dr. Amrut Naik", "Amrut Naik"));
  assert.ok(!E.samePerson("Gopal Krishna Jain", "Ankush Jain"));
  assert.ok(!E.samePerson("Srivatsan", "V. N. Srivatsan"), "a surname alone is not enough");
});

test("Apollo Tyres' new CFO: the KPMG tax colleague is the best route", () => {
  const routes = E.routesTo(person("shingari"), net, R);
  assert.equal(routes[0].contact.name, "Rohan Talwar");
  assert.equal(routes[0].link.strength, "strong");
  assert.match(routes[0].link.evidence[0].text, /KPMG India, 2008–2016, about 8 years together, both in tax/);
  const kavya = routes.find((r) => r.contact.name === "Kavya Iyer");
  assert.equal(kavya.link.strength, "weak", "a school in common with no years is weak");
});

test("Voltas' new MD: same TAS intake beats a stale but closer colleague", () => {
  const routes = E.routesTo(person("balan"), net, R);
  assert.deepEqual(names(routes).slice(0, 2), ["Vikram Desai", "Meera Pillai"]);
  const meera = routes[1];
  assert.equal(meera.link.evidence.length, 2, "one piece of evidence per employer");
  assert.ok(meera.link.score > routes[0].link.score, "Meera knows him better...");
  assert.ok(meera.tie.months >= 12, "...but you haven't spoken in a year");
});

test("unknown years are said plainly, never guessed", () => {
  const [top] = E.routesTo(person("guha"), net, R);
  assert.equal(top.contact.name, "Neha Kulkarni");
  assert.equal(top.link.strength, "medium");
  assert.match(top.link.evidence[0].text, /doesn't say when \(over 28 years there\)/);
});

test("a thin filing gives no route; the network still finds who knows the company", () => {
  assert.equal(E.routesTo(person("naik"), net, R).length, 0);
  const who = E.whoKnows("alkem", net, R, "management_change");
  assert.equal(who[0].contact.name, "Leena Fernandes");
  assert.equal(who[0].how, "specialist");
  assert.ok(names(who).includes("Dr. Sanjay Kelkar"));
});

test("Amber's acquisition: the person who ran the acquired company's plant comes first", () => {
  const [top] = E.whoKnows("amber", net, R, "M&A");
  assert.equal(top.contact.name, "Farhan Qureshi");
  assert.match(top.text, /Ascent Circuits, 2016–2023; Amber's IL JIN took full ownership/);
});

test("specialists fit the event: drug regulator for a plant, securities lawyer for SEBI", () => {
  const sun = names(E.whoKnows("sun-pharma", net, R, "regulatory"));
  assert.deepEqual(sun.slice(0, 2), ["Dr. Ritu Baruah", "Anil Menon"]);
  assert.ok(!sun.includes("Advait Joshi"), "a securities lawyer is not a drug-plant specialist");
  const dabur = names(E.whoKnows("dabur", net, R, "litigation"));
  assert.equal(dabur[0], "Advait Joshi");
  assert.ok(!dabur.includes("Anil Menon"), "a drug regulator is not a SEBI specialist");
  const amber = names(E.whoKnows("amber", net, R, "M&A"));
  assert.ok(!amber.includes("Kavya Iyer"), "a CFO elsewhere is not an M&A specialist on Amber");
});

test("inside knowledge outranks a closer friend who is only an expert", () => {
  const who = E.whoKnows("cgpower", net, R, "capex");
  assert.equal(who[0].contact.name, "Deepa Raghavan");
  assert.equal(who[0].how, "inside");
});

test("expertise map", () => {
  assert.equal(E.experts("specialty-chemicals", net, R)[0].contact.name, "Lakshmi Raman");
  const rural = names(E.experts("rural-lending", net, R));
  for (const n of ["Nandini Kamath", "Joseph Thomas", "Suresh Gowda", "Mohan Krishnan"]) assert.ok(rural.includes(n), n);
});

test("reconnect: stale ties whose company just did something", () => {
  const events = [{ symbol: "AMBER", title: "Acquisition completed" }, { symbol: "TITAN", title: "Results" }];
  const r = E.reconnect(events, net, R);
  const farhan = r.find((x) => x.contact.name === "Farhan Qureshi");
  assert.ok(farhan);
  assert.match(farhan.why, /Ascent Circuits, now part of Amber Enterprises/);
  for (const x of r) assert.ok(x.tie.months >= 6, `${x.contact.name} was spoken to recently`);
});

test("findInNetwork needs a shared employer, not just a name", () => {
  const twin = { name: "Rohan Talwar", symbol: "APOLLOTYRE", career: [{ org: "KPMG India" }] };
  assert.equal(E.findInNetwork(twin, net, R).length, 1);
  const stranger = { name: "Rohan Talwar", symbol: "TITAN", career: [{ org: "Titan" }] };
  assert.equal(E.findInNetwork(stranger, net, R).length, 0);
});

test("the demo network is synthetic and names no real executive", () => {
  assert.equal(net.synthetic, true);
  for (const c of net.contacts) for (const p of people) {
    assert.ok(!E.samePerson(c.name, p.name), `${c.name} shares a name with ${p.name}`);
  }
});

test("the engine cannot send anything anywhere", () => {
  const src = fs.readFileSync(new URL("../web/js/network.js", import.meta.url), "utf8");
  for (const call of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "import("]) {
    assert.ok(!src.includes(call), `network.js must not use ${call}`);
  }
});
