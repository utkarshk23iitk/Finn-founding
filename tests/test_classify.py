"""Ranking rules, each pinned to a real filing it once got wrong or must keep right."""
from pipeline import classify as C


def f(nse_type, text, time="2026-11-12T13:58:25"):
    return {"nse_type": nse_type, "text": text, "time": time}


def rank(nse_type, text, subject=""):
    return C.classify(f(nse_type, text), subject)


def test_senior_appointments_and_exits_need_you():
    assert rank("Appointment", "Apollo Tyres Limited has informed the Exchange regarding Appointment of Mr Ravi Kumar "
                "Shingari as Chief Financial Officer of the company w.e.f. November 04, 2026.")["priority"] == 85
    assert rank("Resignation", "Dabur India Limited has informed the Exchange regarding Resignation of Mr. Mohit Malhotra "
                "as Global Chief Executive Officer and Whole-time Director")["priority"] == 90


def test_non_executive_director_is_not_a_senior_executive():
    # "Non- Executive Director" contains "Executive Director"; it once scored 85.
    r = rank("Appointment", "Voltas Limited has informed the Exchange regarding Appointment of Mr Venkatesalu Palaniswamy "
             "as Non- Executive Director of the company w.e.f. November 12, 2026.")
    assert r["priority"] == 38 and r["tier"] == "low"


def test_a_subsidiarys_board_is_not_the_company():
    r = rank("Resignation of Director/KMP/SMP", "We hereby inform the exchange that the Board of Directors of IL JIN "
             "Electronics (India) Limited, a material subsidiary, approved the resignation of its Managing Director")
    assert r["priority"] < C.HIGH


def test_closure_order_outranks_a_generic_order():
    r = rank("Action(s) taken or orders passed", "CG Power has informed the Exchange about Action(s) taken or orders passed",
             "The Company has received a Direction from Maharashtra Pollution Control Board directing closure of "
             "manufacturing operations of the Company's unit")
    assert (r["kind"], r["priority"]) == ("regulatory", 82)
    telecom = rank("Action(s) taken or orders passed", "Bharti Airtel has informed the Exchange about Action(s) taken",
                   "Notices received by the Company from the Department of Telecommunications, as Annexure A")
    assert telecom["priority"] == 42


def test_governance_and_routine():
    assert rank("Initiation of Forensic Audit", "Alkem has informed the Exchange about Initiation of Forensic Audit")["priority"] == 88
    assert rank("ESOP/ESOS/ESPS", "HDFC Bank has informed the Exchange regarding Allotment of 4675598 Shares.")["tier"] == "low"
    assert rank("Copy of Newspaper Publication", "Bharti Airtel has informed the Exchange about Copy of Newspaper Publication")["tier"] == "low"
    sebi = rank("Action(s) taken or orders passed", "Dabur has informed the Exchange about Action(s) taken",
                "Administrative warning letter received from SEBI")
    assert sebi["priority"] == 68


def test_results_headline_names_the_quarter():
    assert C.results_headline("2026-11-12T13:58") == "Results for July–September 2026 (Q2 FY27)"
    assert C.results_headline("2026-05-10T10:00") == "Results for January–March 2026 (Q4 FY26)"
    assert C.results_headline("2026-02-01T10:00") == "Results for October–December 2025 (Q3 FY26)"
    assert C.results_headline("2026-07-20T10:00") == "Results for April–June 2026 (Q1 FY27)"


def test_subject_lines_from_real_letters():
    lt = "Dear Sirs, Re : L&T bags ( Significant*) order from Noida Metro for Aqua Line Extension We enclose herewith"
    assert C.subject_line(lt).startswith("L&T bags ( Significant*) order from Noida Metro")
    airtel = ("Sub: Disclosure under Regulation 30 of SEBI (Listing Obligations and Disclosure Requirements), Regulations, "
              "2015 ('SEBI Listing Regulations') Dear Sir/ Ma'am, Pursuant to Regulation 30 read with Clause 20, we hereby "
              "submit the details of N otices received by the Company from the Department of Telecommunications, as Annexure A. We")
    assert C.subject_line(airtel) == "Notices received by the Company from the Department of Telecommunications, as Annexure A"


def test_sentences_keep_initials_and_wef():
    s = "Retirement of Mr. Noel N. Tata as Chairman w.e.f. 11th November, 2026. His appointment as Chairman Emeritus."
    assert C.first_sentence(s) == "Retirement of Mr. Noel N. Tata as Chairman w.e.f. 11th November, 2026"


def test_clean_rewrites_nse_queries_and_preambles():
    sun = ("The Exchange has sought clarification from Sun Pharmaceutical Industries Limited with respect to recent news "
           "item captioned India orders Sun Pharma to halt eye-care drug production at plant after quality lapses.")
    assert C.clean(sun).startswith("NSE asked about a news report: India orders Sun Pharma")
    wipro = ("To please refer to our earlier letter dated October 16, 2026, informing that Wipro Limited through its "
             "step-down subsidiary had signed a definitive agreement")
    assert C.clean(wipro).startswith("Wipro Limited through its step-down subsidiary")
    assert "L&T bags" in C.clean("L&T bags ( Significant*) order")


def test_letter_detail_is_not_borrowed_by_specific_filings():
    # One Voltas letter covers four appointments; a specific NSE line keeps its own words.
    letter = ("Dear Sir, Retirement of Mr. Noel N. Tata as the Chairman of the Company pursuant to the Tata Group "
              "Governance Guidelines. Appointment of Mr. Jayant Balan as Managing Director.")
    a = C.analyse(f("Appointment", "Voltas Limited has informed the Exchange regarding Appointment of Mr Jayant Balan as "
                    "Managing Director of the company w.e.f. 25th May, 2027."), letter)
    assert a["detail"] == "" and a["headline"].startswith("Appointment of Mr Jayant Balan")


def test_forensic_audit_keeps_type_as_headline_and_letter_as_detail():
    letter = ("Dear Sir(s)/ Madam, Pursuant to Regulation 30, we wish to inform you that the Audit Committee at its "
              "meeting today has approved the initiation of forensic audit in connection with a recent incident "
              "involving alleged misappropriation of funds by a former employee of the Company.")
    a = C.analyse(f("Initiation of Forensic Audit", "Alkem has informed the Exchange about Initiation of Forensic Audit"), letter)
    assert a["headline"] == "Initiation of Forensic Audit"
    assert "misappropriation of funds by a former employee" in a["detail"]
