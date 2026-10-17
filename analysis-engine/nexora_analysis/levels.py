"""Support and resistance detection.

Two complementary, fully deterministic methods:

* **Swings** — local extrema of the high/low series, clustered when they sit
  within one tolerance band so a level that price tested repeatedly counts once
  with a higher touch count.
* **Classic pivots** — floor-trader pivots (P, S1..S3, R1..R3) computed from the
  most recent window treated as one completed session.

Both only read the candles they are given.
"""

from __future__ import annotations

from typing import Optional, Sequence

from .indicators import atr as atr_series
from .indicators import last_value

__all__ = ["find_swings", "cluster_levels", "classic_pivots", "detect_levels"]


def find_swings(
    highs: Sequence[float],
    lows: Sequence[float],
    lookback: int = 5,
) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Return ``(swing_highs, swing_lows)`` as ``(index, price)`` pairs.

    A bar is a swing high when its high is the maximum of the surrounding
    ``2 * lookback + 1`` bars (strictly greater than its neighbours).
    """
    if lookback < 1:
        raise ValueError("lookback must be at least 1")

    swing_highs: list[tuple[int, float]] = []
    swing_lows: list[tuple[int, float]] = []

    for index in range(lookback, len(highs) - lookback):
        window_highs = highs[index - lookback : index + lookback + 1]
        window_lows = lows[index - lookback : index + lookback + 1]
        if highs[index] == max(window_highs) and window_highs.count(highs[index]) == 1:
            swing_highs.append((index, float(highs[index])))
        if lows[index] == min(window_lows) and window_lows.count(lows[index]) == 1:
            swing_lows.append((index, float(lows[index])))

    return swing_highs, swing_lows


def cluster_levels(
    points: Sequence[tuple[int, float]],
    tolerance: float,
    kind: str,
) -> list[dict]:
    """Merge nearby prices into weighted-average levels with touch counts."""
    if not points:
        return []

    ordered = sorted(points, key=lambda item: item[1])
    clusters: list[dict] = []
    current: list[tuple[int, float]] = [ordered[0]]

    for point in ordered[1:]:
        cluster_price = sum(price for _, price in current) / len(current)
        if abs(point[1] - cluster_price) <= tolerance:
            current.append(point)
        else:
            clusters.append(_summarise(current, kind))
            current = [point]
    clusters.append(_summarise(current, kind))
    return clusters


def _summarise(points: Sequence[tuple[int, float]], kind: str) -> dict:
    price = sum(value for _, value in points) / len(points)
    return {
        "price": price,
        "touches": len(points),
        "kind": kind,
        "lastIndex": max(index for index, _ in points),
    }


def classic_pivots(
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    window: int = 24,
) -> list[dict]:
    """Classic floor-trader pivot levels from the most recent ``window`` bars."""
    if len(closes) < 2:
        return []

    start = max(0, len(closes) - window)
    session_high = max(highs[start:])
    session_low = min(lows[start:])
    session_close = closes[-1]

    pivot = (session_high + session_low + session_close) / 3.0
    span = session_high - session_low

    levels = {
        "P": pivot,
        "R1": 2 * pivot - session_low,
        "S1": 2 * pivot - session_high,
        "R2": pivot + span,
        "S2": pivot - span,
        "R3": session_high + 2 * (pivot - session_low),
        "S3": session_low - 2 * (session_high - pivot),
    }
    return [
        {"label": label, "price": value, "kind": "pivot", "touches": 1}
        for label, value in levels.items()
    ]


def detect_levels(
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    lookback: int = 5,
    max_levels: int = 5,
    atr_decimals: int = 6,
) -> Optional[dict]:
    """Full support/resistance detection for one candle series.

    Returns ``None`` when there is not enough data to say anything meaningful,
    rather than inventing levels.
    """
    if len(closes) < lookback * 2 + 3:
        return None

    last_price = float(closes[-1])
    current_atr = last_value(atr_series(highs, lows, closes, 14))

    # Tolerance: prefer a multiple of ATR, fall back to a fraction of price.
    if current_atr and current_atr > 0:
        tolerance = float(current_atr) * 0.75
    else:
        tolerance = abs(last_price) * 0.004
    if tolerance <= 0:
        tolerance = max(abs(last_price) * 0.001, 1e-8)

    swing_highs, swing_lows = find_swings(highs, lows, lookback)
    candidates = cluster_levels(swing_highs, tolerance, "swing")
    candidates += cluster_levels(swing_lows, tolerance, "swing")

    pivot_points = classic_pivots(highs, lows, closes, window=min(len(closes), 24))
    for pivot in pivot_points:
        candidates.append(
            {
                "price": float(pivot["price"]),
                "touches": 1,
                "kind": "pivot",
                "lastIndex": len(closes) - 1,
            }
        )

    # Drop levels that sit exactly on top of the current price and de-duplicate
    # across methods.
    merged: list[dict] = []
    for level in sorted(candidates, key=lambda item: item["price"]):
        price = round(float(level["price"]), atr_decimals)
        if price <= 0:
            continue
        existing = next(
            (item for item in merged if abs(item["price"] - price) <= tolerance),
            None,
        )
        if existing:
            if level["kind"] == "swing" and existing["kind"] == "swing":
                existing["touches"] += int(level["touches"])
            continue
        merged.append(
            {
                "price": price,
                "touches": int(level["touches"]),
                "kind": level["kind"],
                "lastIndex": int(level.get("lastIndex", 0)),
            }
        )

    def distance_percent(price: float) -> float:
        if last_price == 0:
            return 0.0
        return ((price - last_price) / abs(last_price)) * 100.0

    supports = [
        {
            "price": level["price"],
            "touches": level["touches"],
            "kind": level["kind"],
            "distancePercent": distance_percent(level["price"]),
        }
        for level in merged
        if level["price"] < last_price
    ]
    resistances = [
        {
            "price": level["price"],
            "touches": level["touches"],
            "kind": level["kind"],
            "distancePercent": distance_percent(level["price"]),
        }
        for level in merged
        if level["price"] > last_price
    ]

    # Nearest to the reference price first: the analysis surfaces levels by their
    # real distance from the current price, so the closest level on each side is
    # the first row and `nearestSupport`/`nearestResistance` is always the first
    # entry of its table (it can no longer be pushed past `max_levels` by levels
    # that only had more touches).
    supports.sort(key=lambda item: item["distancePercent"], reverse=True)
    resistances.sort(key=lambda item: item["distancePercent"])

    # With the nearest-first ordering above, the closest level is always the first
    # row of its table, which is exactly what `nearestSupport`/`nearestResistance`
    # promise.
    return {
        "supports": supports[:max_levels],
        "resistances": resistances[:max_levels],
        "nearestSupport": supports[0] if supports else None,
        "nearestResistance": resistances[0] if resistances else None,
    }
