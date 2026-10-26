"""ULID (contract `Id`: ^[0-9A-HJKMNP-TV-Z]{26}$): 48-bit ms timestamp + 80 random bits.

Monotonic within a millisecond: under the frozen test clock every id of a run shares the time
prefix, so ordering by id must still follow insertion order. Same algorithm as before the
migration, so ids keep sorting the same way.
"""

import secrets
from datetime import datetime

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

_last_time = -1
_last_rand: list[int] = []


def ulid(now: datetime | int | None = None) -> str:
    global _last_time, _last_rand
    if now is None:
        ms = int(datetime.now().timestamp() * 1000)
    elif isinstance(now, datetime):
        ms = int(now.timestamp() * 1000)
    else:
        ms = now
    time = ""
    t = ms
    for _ in range(10):
        time = ALPHABET[t % 32] + time
        t //= 32
    if ms == _last_time:
        # Increment the previous random part (base-32 digits, carry towards the front).
        for i in range(15, -1, -1):
            _last_rand[i] = (_last_rand[i] + 1) % 32
            if _last_rand[i] != 0:
                break
    else:
        _last_time = ms
        _last_rand = [b % 32 for b in secrets.token_bytes(16)]
        _last_rand[0] %= 16  # headroom so the carry cannot overflow into the time part
    return time + "".join(ALPHABET[d] for d in _last_rand)
