"""The parts of research that code decides, tested without calling a model."""
from pipeline import research as R
from pipeline import transcripts as T


def test_fiscal_period_ends():
    assert R.period_end("Q2 FY27") == (2026, 9)
    assert R.period_end("Q4 FY27") == (2027, 3)
    assert R.period_end("H2 FY27") == (2027, 3)
    assert R.period_end("by FY28") == (2028, 3)
    assert R.period_end("9M FY27") == (2026, 12)
    assert R.period_end("FY2027") == (2027, 3)
    assert R.period_end("next two to three years") is None


def test_horizon_keys_group_the_same_promise():
    assert R.horizon_key("FY27") == R.horizon_key("FY 2027") == R.horizon_key("by FY27") == "FY27"
    assert R.horizon_key("Q3 FY27") == "Q3FY27"


def promise(low, high=None, unit="%", metric="revenue growth", horizon="FY26"):
    return {"metric": metric, "horizon": horizon, "horizon_key": R.horizon_key(horizon),
            "mentions": [{"low": low, "high": high, "unit": unit}]}


def test_a_deadline_in_the_future_is_pending_whatever_the_model_says():
    s = R.settle(promise(20, horizon="FY27"), {"verdict": "delivered", "note": ""}, latest_end=(2026, 9))
    assert s["verdict"] == "pending" and s["settled_by"] == "date" and s["model_verdict"] == "delivered"


def test_numbers_overrule_the_model():
    # Guided 15% growth for FY26, reported 11.5%: missed, even if the model says delivered.
    s = R.settle(promise(15), {"verdict": "delivered", "actual_value": 11.5, "actual_unit": "%", "note": ""}, (2026, 3))
    assert (s["verdict"], s["settled_by"], s["model_verdict"]) == ("missed", "numbers", "delivered")
    close = R.settle(promise(15), {"verdict": "missed", "actual_value": 14.4, "actual_unit": "percent", "note": ""}, (2026, 3))
    assert close["verdict"] == "partly"
    beat = R.settle(promise(30, 35), {"verdict": "partly", "actual_value": 38, "actual_unit": "%", "note": ""}, (2026, 3))
    assert beat["verdict"] == "delivered", "beating the top of a growth range is delivering"


def test_lower_is_better_for_credit_cost():
    p = promise(2.0, 2.2, metric="credit cost")
    assert R.settle(p, {"verdict": "missed", "actual_value": 2.1, "actual_unit": "%", "note": ""}, (2026, 3))["verdict"] == "delivered"
    assert R.settle(p, {"verdict": "delivered", "actual_value": 4.5, "actual_unit": "%", "note": ""}, (2026, 3))["verdict"] == "missed"


def test_mismatched_units_leave_the_verdict_to_the_model():
    s = R.settle(promise(5000, unit="crore"), {"verdict": "delivered", "actual_value": 38, "actual_unit": "%", "note": ""}, (2026, 3))
    assert s["verdict"] == "delivered" and s["settled_by"] == "model"


def test_same_metric_and_horizon_across_calls_is_one_promise_that_can_move():
    calls = [{"label": "May 2026", "month": "2026-05", "url": "a"}, {"label": "Aug 2026", "month": "2026-08", "url": "b"}]
    ex = [{"guidance": [{"metric": "revenue growth", "target": "30-35%", "low": 30, "high": 35, "unit": "%", "horizon": "FY27", "quote": "we expect revenue growth of 30-35% this year"}]},
          {"guidance": [{"metric": "revenue growth", "target": "25%", "low": 25, "high": 25, "unit": "%", "horizon": "FY 2027", "quote": "revenue growth should now be about 25%"}]}]
    ps = R.group_promises(calls, ex)
    assert len(ps) == 1 and len(ps[0]["mentions"]) == 2 and ps[0]["moved"] is True


def test_special_calls_are_not_earnings_calls():
    special = "SRF Limited conference call to discuss the update on the refrigerant segment. " * 3
    assert not T.is_earnings_call(special, "https://x/SRF-Limited-Update-on-Refrigerant-Segment-Concall.pdf")
    earnings = ("Q2 FY27 earnings call. Results for the quarter ended September 30, 2026. "
                "During the quarter, revenue grew. We will give an update on each of our businesses. ") * 3
    assert T.is_earnings_call(earnings, "https://x/transcript.pdf")


def test_loosely_named_segments_merge_and_show_a_cut():
    calls = [{"label": "May 2026", "month": "2026-05", "url": "a"}, {"label": "Aug 2026", "month": "2026-08", "url": "b"}]
    ex = [{"guidance": [{"segment": "telecom network business", "metric": "revenue", "target": "7,500", "low": 7500, "high": 8000, "unit": "crore", "horizon": "FY27", "quote": "We are targeting almost INR7,500 crores, INR8,000 crores in this year"}]},
          {"guidance": [{"segment": "telecom", "metric": "revenue", "target": "6,700-7,000", "low": 6700, "high": 7000, "unit": "crore", "horizon": "FY27", "quote": "we're going to be somewhere between INR6,700 crores to INR7,000 crores"}]}]
    ps = R.group_promises(calls, ex)
    assert len(ps) == 1 and ps[0]["moved"] and len(ps[0]["mentions"]) == 2


def test_a_segment_target_is_not_settled_by_a_company_number():
    p = promise(5500, 6000, unit="crore", metric="revenue")
    s = R.settle(p, {"verdict": "delivered", "actual_value": 48893, "actual_unit": "crore", "note": ""}, (2026, 3))
    assert s["verdict"] == "unclear" and s["model_verdict"] == "delivered"


def test_direction_reads_as_the_investor_would():
    calls = [{"label": "Apr 2026", "month": "2026-04", "url": "a"}, {"label": "Oct 2026", "month": "2026-10", "url": "b"}]
    g = lambda metric, lo, hi, q: {"guidance": [{"segment": "company", "metric": metric, "target": "", "low": lo, "high": hi, "unit": "%", "horizon": "FY27", "quote": q}]}
    cut = R.group_promises(calls, [g("revenue growth", 1.5, 3.5, "revenue growth guidance of 1.5% to 3.5%"), g("revenue growth", 1, 2, "our revenue growth guidance is 1% to 2%")])[0]
    assert cut["direction"] == "cut"
    better = R.group_promises(calls, [g("credit cost", 4, 4.5, "credit cost guidance of 4% to 4.5%"), g("credit cost", 3, 4, "credit cost guidance of 3% to 4%")])[0]
    assert better["direction"] == "raised", "a lower credit-cost target is better news"


def test_the_quote_settles_the_metric_name():
    assert R.metric_from_quote("EBITDA margin", "Our operating margin guidance remains at 20% to 22%") == "operating margin"
    assert R.metric_from_quote("EBITDA margin", "We expect a NIM of 14.4% to 14.7%") == "NIM"
    assert R.metric_from_quote("revenue growth", "operating margin of 21%") == "revenue growth", "only margin labels are corrected"


def _calls(*labels):
    return [{"label": l, "month": f"2026-{i + 1:02d}", "url": l} for i, l in enumerate(labels)]


def test_different_things_with_the_same_metric_stay_apart():
    ex = [{"guidance": [{"segment": "company", "metric": "capex", "target": "1,500-2,000", "low": 1500, "high": 2000, "unit": "crore", "horizon": "FY27",
                         "quote": "the first stage of investments in the Odisha site will probably be in the range of INR1,500 crore to INR2,000 crore"}]},
          {"guidance": [{"segment": "company", "metric": "capex", "target": "2,500", "low": 2500, "high": 2500, "unit": "crore", "horizon": "FY27",
                         "quote": "Our planned capex for financial year 2027 stands at approximately INR2,500 crore"}]}]
    assert len(R.group_promises(_calls("Jan", "May"), ex)) == 2


def test_a_range_restated_with_one_bound_is_not_a_cut():
    q = "revenue growth of 15% to 20% in our Chemicals Business"
    ex = [{"guidance": [{"segment": "Chemicals", "metric": "revenue growth", "target": "15-20%", "low": 15, "high": 20, "unit": "%", "horizon": "FY27", "quote": q}]},
          {"guidance": [{"segment": "Chemicals", "metric": "revenue growth", "target": "higher end", "low": 15, "high": None, "unit": "%", "horizon": "FY27", "quote": q}]}]
    p = R.group_promises(_calls("May", "Oct"), ex)[0]
    assert len(p["mentions"]) == 2 and not p["moved"] and p["direction"] is None
