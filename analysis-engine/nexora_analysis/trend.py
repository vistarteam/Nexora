"""Trend classification.

A trend reading is built from computable ingredients only, never from opinion:

1. the least-squares slope of closes over the analysis window;
2. the *statistical significance* of that slope — its t-statistic, i.e. the
   slope divided by its own standard error. This is scale-free and, crucially,
   does not depend on the instrument's price level or on floating-point noise:
   a perfectly linear series yields an infinite t-statistic and is always an
   uptrend/downtrend, never a coin flip;
3. the structure of successive swing highs and lows (higher highs / lower
   lows).

`strength` is a bounded 0-100, log-scaled score derived from the t-statistic. It
measures how pronounced the observed move is, not a probability and not a
forecast. The raw t-statistic is returned as well, so the score can be audited.
"""

from __future__ import annotations

from math import log1p, sqrt
from typing import Optional, Sequence

from .levels import find_swings

__all__ = [
    "linear_regression_slope",
    "least_squares_fit",
    "regression_line",
    "slope_t_statistic",
    "classify_trend",
]

#: |t| at or above this is treated as a directed trend. 2.5 is a deliberately
#: conservative bar: it asks for a slope unlikely to be pure noise.
TREND_T_THRESHOLD = 2.5

#: |t| at which `strength` reaches 100. A linear map would saturate almost
#: immediately (90-bar windows routinely reach |t| in the tens), telling the
#: reader nothing; 200 keeps the score discriminating across the range real
#: series produce. The raw t-statistic is always reported alongside it.
STRENGTH_SATURATION_T = 200.0


def least_squares_fit(values: Sequence[float]) -> tuple[Optional[float], Optional[float]]:
    """Return ``(slope, intercept)`` of the least-squares fit against the index.

    The index is the only regressor, so the fit is fully described by these two
    numbers: ``price(i) = intercept + slope * i``. ``(None, None)`` when the fit
    is undefined (fewer than three points, or a degenerate x-spread).
    """
    count = len(values)
    if count < 3:
        return None, None

    series = [float(value) for value in values]
    mean_x = (count - 1) / 2.0
    mean_y = sum(series) / count
    numerator = sum((index - mean_x) * (value - mean_y) for index, value in enumerate(series))
    denominator = sum((index - mean_x) ** 2 for index in range(count))
    if denominator == 0:
        return None, None

    slope = numerator / denominator
    return slope, mean_y - slope * mean_x


def linear_regression_slope(values: Sequence[float]) -> Optional[float]:
    """Least-squares slope of ``values`` against its index."""
    return least_squares_fit(values)[0]


def regression_line(values: Sequence[float], max_window: int = 90) -> Optional[dict]:
    """Least-squares trend line over the most recent ``max_window`` values.

    Returns the fit together with the window it was computed over, so a chart can
    draw the exact line the trend classification is based on. The regression is
    indexed from the *start of the window*, which is why ``startIndex`` is part of
    the result: ``price(i) = intercept + slope * (i - startIndex)``.
    """
    window = min(len(values), max_window)
    if window < 3:
        return None

    window_values = [float(value) for value in values[-window:]]
    slope, intercept = least_squares_fit(window_values)
    if slope is None or intercept is None:
        return None

    return {
        "slope": slope,
        "intercept": intercept,
        "window": window,
        "startIndex": len(values) - window,
    }


def slope_t_statistic(values: Sequence[float]) -> tuple[Optional[float], Optional[float]]:
    """Return ``(slope, t)`` for the least-squares fit of ``values`` on its index.

    ``t`` is ``slope / standard_error(slope)``. It is ``inf`` for a series that
    lies exactly on a line (zero residual variance) and ``0`` when the slope is
    exactly zero, so degenerate inputs classify deterministically instead of
    depending on rounding.
    """
    count = len(values)
    if count < 3:
        return None, None

    series = [float(value) for value in values]
    mean_x = (count - 1) / 2.0
    mean_y = sum(series) / count
    sxx = sum((index - mean_x) ** 2 for index in range(count))
    if sxx == 0:
        return None, None

    sxy = sum((index - mean_x) * (value - mean_y) for index, value in enumerate(series))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x

    residuals = [value - (intercept + slope * index) for index, value in enumerate(values)]
    sse = sum(residual * residual for residual in residuals)
    degrees_of_freedom = count - 2

    if degrees_of_freedom <= 0:
        return slope, None

    mean_squared_error = sse / degrees_of_freedom
    if mean_squared_error <= 0:
        # Perfectly linear. Report the sign of the slope with infinite confidence.
        if slope == 0:
            return slope, 0.0
        return slope, float("inf") if slope > 0 else float("-inf")

    standard_error = sqrt(mean_squared_error / sxx)
    if standard_error == 0:
        return slope, 0.0
    return slope, slope / standard_error


def _structure(highs: Sequence[float], lows: Sequence[float], lookback: int) -> tuple[bool, bool]:
    swing_highs, swing_lows = find_swings(highs, lows, lookback)
    higher_highs = False
    higher_lows = False

    if len(swing_highs) >= 2:
        recent = [price for _, price in swing_highs[-3:]]
        higher_highs = all(b > a for a, b in zip(recent, recent[1:])) if len(recent) >= 2 else False
    if len(swing_lows) >= 2:
        recent_lows = [price for _, price in swing_lows[-3:]]
        higher_lows = all(b > a for a, b in zip(recent_lows, recent_lows[1:]))

    return higher_highs, higher_lows


def classify_trend(
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    lookback: int = 5,
    max_window: int = 90,
) -> dict:
    """Classify the trend of a candle series.

    The caller must already have verified that there is enough data; this
    function reports ``direction: "unknown"`` when it cannot decide.
    """
    window = min(len(closes), max_window)
    window_closes = [float(value) for value in closes[-window:]]
    window_highs = [float(value) for value in highs[-window:]]
    window_lows = [float(value) for value in lows[-window:]]

    slope, t_statistic = slope_t_statistic(window_closes)
    mean_price = sum(window_closes) / len(window_closes) if window_closes else 0.0

    evidence: list[str] = []
    if slope is None or mean_price == 0:
        return {
            "direction": "unknown",
            "strength": None,
            "evidence": ["داده کافی برای برازش روند وجود ندارد."],
            "higherHighs": None,
            "higherLows": None,
            "slopePercentPerCandle": None,
            "tStatistic": None,
        }

    slope_percent = (slope / abs(mean_price)) * 100.0

    # Volatility of close-to-close returns: supporting evidence, and the scale
    # the reader needs to judge how large the slope is in practice. It is the
    # standard deviation of close-to-close returns over the *same* rolling
    # window the slope was fitted on — deliberately distinct from the whole
    # series volatility reported in `facts.volatilityPercent` — and the Persian
    # evidence states the window so the two can never be mistaken for one number.
    returns = [
        (window_closes[index] - window_closes[index - 1]) / window_closes[index - 1]
        for index in range(1, len(window_closes))
        if window_closes[index - 1] != 0
    ]
    mean_return = sum(returns) / len(returns) if returns else 0.0
    variance = (
        sum((value - mean_return) ** 2 for value in returns) / len(returns) if returns else 0.0
    )
    volatility = variance**0.5

    higher_highs, higher_lows = _structure(window_highs, window_lows, lookback)

    # The direction decision rests on the t-statistic, not on the raw slope:
    # significance is what separates a trend from noise, and it is independent
    # of the instrument's price level.
    signed_t = float(t_statistic) if t_statistic is not None else 0.0
    if signed_t >= TREND_T_THRESHOLD:
        direction = "uptrend"
    elif signed_t <= -TREND_T_THRESHOLD:
        direction = "downtrend"
    else:
        direction = "sideways"

    # Log-scaled score. See STRENGTH_SATURATION_T for why it is not linear.
    if signed_t == float("inf"):
        strength = 100.0
    else:
        capped_t = min(abs(signed_t), STRENGTH_SATURATION_T)
        strength = round(100.0 * log1p(capped_t) / log1p(STRENGTH_SATURATION_T), 1)

    evidence.append(
        f"شیب خط برازش‌شده روی {window} کندل برابر {slope_percent:+.4f} درصد در هر کندل است."
    )
    if signed_t == float("inf"):
        evidence.append("آماره t این شیب بی‌نهایت است: قیمت‌ها دقیقاً روی یک خط قرار دارند.")
    else:
        evidence.append(
            f"آماره t این شیب {signed_t:+.2f} است "
            f"(آستانه معناداری {TREND_T_THRESHOLD:g}) و بنابراین "
            f"{'معنادار' if abs(signed_t) >= TREND_T_THRESHOLD else 'قابل تفکیک از نویز نیست'} ارزیابی می‌شود."
        )
    evidence.append(
        f"نوسان بازده‌ها (انحراف معیار روی آخرین {window} کندل روند) "
        f"{volatility * 100:.3f} درصد در هر کندل است."
    )
    evidence.append(
        "ساختار سقف‌ها: سقف‌های بالاتر"
        + (" دیده می‌شود." if higher_highs else " دیده نمی‌شود.")
    )
    evidence.append(
        "ساختار کف‌ها: کف‌های بالاتر" + (" دیده می‌شود." if higher_lows else " دیده نمی‌شود.")
    )

    return {
        "direction": direction,
        "strength": strength,
        "evidence": evidence,
        "higherHighs": higher_highs,
        "higherLows": higher_lows,
        "slopePercentPerCandle": round(slope_percent, 6),
        "tStatistic": None if signed_t == float("inf") else round(signed_t, 4),
    }
