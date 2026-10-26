from datetime import date, datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def now() -> datetime:
    return datetime.now(IST)


def today() -> date:
    return now().date()
