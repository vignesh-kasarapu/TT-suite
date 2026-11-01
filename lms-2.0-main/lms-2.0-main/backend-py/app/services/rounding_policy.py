"""BR-14 rounding, in one place so the policy can be changed by one line once HR decides.

The three candidate methods are all implemented and tested; `ACTIVE_METHOD` selects the one
the application actually uses. It is deliberately left on the method the system has always
used (round UP to a whole day, `math.ceil`, BR-14) — **switching it is an HR decision, not a
technical one**, because it changes every employee's visible balance. See the comparison in
the implementation report.

Scope: this applies to the joining/opening credit only. Periodic accrual credits are stored
unrounded and land on the ledger's own `DECIMAL(8,1)` scale, which is what the system has
always done; rounding each period up would turn Sick's 0.75/month into 12 days a year
against a 9-day policy.
"""
import math

METHOD_A = "CEIL_WHOLE_DAY"      # 1.2 -> 2,   1.7 -> 2,   1.75 -> 2,   2.1 -> 3
METHOD_B = "CEIL_ONE_DECIMAL"    # 1.21 -> 1.3, 1.71 -> 1.8, 1.75 -> 1.8, 2.01 -> 2.1
METHOD_C = "NEAREST_ONE_DECIMAL" # 1.21 -> 1.2, 1.25 -> 1.3, 1.71 -> 1.7, 1.75 -> 1.8

#: The method in force. Changing this is pending HR sign-off (BR-14).
ACTIVE_METHOD = METHOD_A


def ceil_whole_day(value: float) -> float:
    return float(math.ceil(value))


def ceil_one_decimal(value: float) -> float:
    # Scale, ceil, unscale. The epsilon absorbs binary-float error so 1.7 does not become
    # 1.8 just because it is stored as 1.70000000000000018.
    return math.ceil(round(value * 10, 9)) / 10


def nearest_one_decimal(value: float) -> float:
    # Half-up, not Python's banker's rounding: 1.25 -> 1.3, never 1.2.
    return math.floor(round(value * 10, 9) + 0.5) / 10


_METHODS = {
    METHOD_A: ceil_whole_day,
    METHOD_B: ceil_one_decimal,
    METHOD_C: nearest_one_decimal,
}


def apply(value: float, method: str | None = None) -> float:
    """Round one credit. `method` is for tests and the comparison report; production code
    leaves it out and gets `ACTIVE_METHOD`."""
    return _METHODS[method or ACTIVE_METHOD](value)


def compare(value: float) -> dict[str, float]:
    """Every method's answer for one value — what the BR-14 comparison table is built from."""
    return {name: fn(value) for name, fn in _METHODS.items()}
