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
    ex = [{"guidance": [{"metric": "revenue growth", "target": "30-35%", "low": 30, "high": 35, "unit": "%", "horizon": "FY27", "quote": "q1"}]},
          {"guidance": [{"metric": "revenue growth", "target": "25%", "low": 25, "high": 25, "unit": "%", "horizon": "FY 2027", "quote": "q2"}]}]
    ps = R.group_promises(calls, ex)
    assert len(ps) == 1 and len(ps[0]["mentions"]) == 2 and ps[0]["moved"] is True


def test_special_calls_are_not_earnings_calls():
    special = "SRF Limited conference call to discuss the update on the refrigerant segment. " * 3
    assert not T.is_earnings_call(special, "https://x/SRF-Limited-Update-on-Refrigerant-Segment-Concall.pdf")
    earnings = ("Q2 FY27 earnings call. Results for the quarter ended September 30, 2026. "
                "During the quarter, revenue grew. We will give an update on each of our businesses. ") * 3
    assert T.is_earnings_call(earnings, "https://x/transcript.pdf")
