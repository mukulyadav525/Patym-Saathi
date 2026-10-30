"""Festival calendar for shop-demand planning. Dates are the main festival day (Lakshmi Puja for Diwali).
Verify against a panchang each year before relying on a new entry; demand evidence always comes from the
merchant's own past festival week, never from this table."""

from datetime import date

CALENDAR: list[dict] = [
    {"code": "DIWALI", "name": "Diwali", "name_hi": "दिवाली", "date": date(2026, 11, 8)},
    {"code": "DIWALI", "name": "Diwali", "name_hi": "दिवाली", "date": date(2027, 10, 29)},
    {"code": "DIWALI", "name": "Diwali", "name_hi": "दिवाली", "date": date(2028, 10, 17)},
    {"code": "DIWALI", "name": "Diwali", "name_hi": "दिवाली", "date": date(2029, 11, 5)},
    {"code": "DIWALI", "name": "Diwali", "name_hi": "दिवाली", "date": date(2030, 10, 26)},
]
NUDGE_DAYS = 30


def next_festival(today: date, within_days: int = NUDGE_DAYS) -> dict | None:
    upcoming = sorted((f for f in CALENDAR if 0 <= (f["date"] - today).days <= within_days), key=lambda f: f["date"])
    return upcoming[0] if upcoming else None
