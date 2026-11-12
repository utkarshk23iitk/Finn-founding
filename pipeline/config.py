"""What FINN watches, and the investor's default alert rules.

The portfolio was chosen from a month of real NSE filings (14 Oct to 13 Nov 2026):
a sector and size mix, three themes deep enough for an expertise map
(specialty chemicals, rural lending, electronics and semiconductors), and
companies with fresh senior-management changes, so the Push demo has real
material to work on.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("FINN_DATA_DIR") or ROOT / "data")

# symbol -> (short name, sector, size)
PORTFOLIO = {
    # Large caps
    "HDFCBANK":   ("HDFC Bank", "Private bank", "large"),
    "BHARTIARTL": ("Bharti Airtel", "Telecom", "large"),
    "LT":         ("Larsen & Toubro", "Engineering", "large"),
    "SUNPHARMA":  ("Sun Pharma", "Pharma", "large"),
    "M&M":        ("Mahindra & Mahindra", "Autos", "large"),
    "TITAN":      ("Titan", "Consumer", "large"),
    "WIPRO":      ("Wipro", "IT services", "large"),
    # Mid caps
    "DABUR":      ("Dabur", "FMCG", "mid"),
    "ALKEM":      ("Alkem Labs", "Pharma", "mid"),
    "VOLTAS":     ("Voltas", "Consumer durables", "mid"),
    "APOLLOTYRE": ("Apollo Tyres", "Auto parts", "mid"),
    "CHOLAFIN":   ("Cholamandalam Finance", "Rural lending", "mid"),
    "MANAPPURAM": ("Manappuram Finance", "Gold loans", "mid"),
    "PIIND":      ("PI Industries", "Specialty chemicals", "mid"),
    "NAVINFLUOR": ("Navin Fluorine", "Specialty chemicals", "mid"),
    "CGPOWER":    ("CG Power", "Electricals and chips", "mid"),
    # Small caps
    "KAYNES":     ("Kaynes Technology", "Electronics and chips", "small"),
    "AMBER":      ("Amber Enterprises", "Electronics", "small"),
}

# Pull-side demo companies. Any NSE ticker works; these give explicit numeric
# guidance, which "promised vs delivered" needs.
RESEARCH = {
    "INFY":     ("Infosys", "IT services"),
    "DIXON":    ("Dixon Technologies", "Electronics"),
    "SRF":      ("SRF", "Specialty chemicals"),
    "CREDITACC": ("CreditAccess Grameen", "Rural lending"),
}

# Default alert rules. The investor changes these in the app.
ALERTS = {
    "volume_multiple": 2.0,   # volume above 2x its recent average
    "volume_lookback": 20,    # recent average = previous 20 trading days
    "price_move_pct": 5.0,    # close-to-close move beyond +/-5%
}

PRICE_HISTORY = "1y"
REQUEST_PAUSE = 1.0           # seconds between requests to the same site
