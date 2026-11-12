"""Every fact about a real person must rest on words that are in their filing."""
import json
import re

import pytest

from pipeline import filings
from pipeline.config import DATA

PEOPLE = json.loads((DATA / "people" / "executives.json").read_text())["people"]


def squash(text: str) -> str:
    """Letters and digits only. PDF text splits words ('Appliance s', 'th e'), so spacing can't count."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def filing_text(symbol: str, filing_id: str) -> str:
    match = [f for f in filings.load(symbol) if f["id"] == filing_id]
    assert match, f"{symbol}: filing {filing_id} is not in the cache"
    f = match[0]
    return squash(f["text"] + " " + filings.attachment_text(f))


def facts(person):
    yield "event", person["event"]
    for key in ("career", "education", "credentials", "notable"):
        for i, fact in enumerate(person.get(key, [])):
            yield f"{key}[{i}]", fact


CASES = [(p, where, fact) for p in PEOPLE for where, fact in facts(p)]


@pytest.mark.parametrize("person,where,fact", CASES, ids=[f"{p['id']}-{w}" for p, w, _ in CASES])
def test_every_quote_is_in_the_filing(person, where, fact):
    assert fact.get("quotes"), f"{person['name']} {where}: a fact with no quote"
    text = filing_text(person["symbol"], fact.get("filing") or person["event"]["filing"])
    for q in fact["quotes"]:
        assert squash(q) in text, f"{person['name']} {where}: not in the filing: {q!r}"


def test_the_check_catches_a_changed_fact():
    shingari = next(p for p in PEOPLE if p["id"] == "shingari")
    text = filing_text(shingari["symbol"], shingari["event"]["filing"])
    assert squash("he spent over 16 years with KPMG India") in text
    assert squash("he spent over 18 years with KPMG India") not in text
    assert squash("he spent over 16 years with Deloitte India") not in text


def test_thin_profiles_say_what_is_missing():
    for p in PEOPLE:
        if p["profile"] == "thin":
            assert p.get("gap"), f"{p['name']}: a thin profile must say what the filing leaves out"
