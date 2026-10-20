"""Professional support/resistance price zones.

The previous engine exposed single prices. A price that the market "touched"
three times is not a meaningful object in a volatile market: the market reacted
in a *band* whose width depends on volatility. This module replaces that model
with deterministic zones built from confirmed swing reactions.

Design (version ``sr-zone-1.0``)
--------------------------------
1. **Confirmed pivots only.** A swing high/low at index ``i`` is usable only
   after the ``swingLookback`` bars that follow it exist. Its
   ``confirmedAtTime`` is the open time of that confirming bar, so no zone can
   use a pivot the data had not confirmed yet.
2. **One reaction per interaction.** Pivots closer than
   ``max(2, lookback // 2)`` bars are the same continuous interaction and are
   collapsed to the strongest rejection, so repeated candles cannot inflate a
   zone's touch count.
3. **ATR-normalised clustering.** Reaction prices are sorted and grouped while
   they remain within ``0.35 * ATR`` of the running median. The tolerance is
   volatility-scaled, never a fixed percentage.
4. **Adaptive width.** ``halfWidth = max(0.25*ATR, dispersion*0.75 +
   0.05*ATR, price*0.0003)`` and is capped at ``max(0.9*ATR, price*2%)``.
   The lower bound stops a zone collapsing onto one tick; the cap stops an
   outlier from painting half the chart.
5. **Merging.** Zones whose ranges overlap, or whose gap is below
   ``0.5*tolerance``, are merged before scoring. Their reaction sets are
   unioned, so a merged zone is never double-counted.
6. **Status.** A zone is ``provisional`` with one reaction, ``active`` with two
   or more, and ``broken`` after **two consecutive closes** beyond the far
   boundary plus ``0.15*ATR``. A wick through a boundary is not a break.
7. **Multi-timeframe confluence** is measured on higher timeframes aggregated
   from the same candles. Only buckets that end before the newest candle's open
   time are used, so the unfinished higher-timeframe bar is never included.

The ``strength`` value is a bounded heuristic ranking, not a probability. Every
consumer of this module labels it that way.
"""

from __future__ import annotations

import math
from statistics import median
from typing import Any, Optional, Sequence

from .indicators import atr as atr_series

__all__ = ["detect_zones_from_candles", "ZONE_METHOD_VERSION"]

ZONE_METHOD_VERSION = "sr-zone-1.0"

ATR_PERIOD = 14
CLUSTER_TOLERANCE_ATR = 0.35
MIN_WIDTH_ATR = 0.25
MAX_WIDTH_ATR = 0.9
BREAK_BUFFER_ATR = 0.15
BREAK_CONFIRM_CLOSES = 2
MIN_REACTIONS = 2
MAX_ZONES_PER_SIDE = 6
MAX_BROKEN_ZONES = 2

TIMEFRAME_MINUTES = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
    "1w": 10080,
}

#: A higher timeframe is analysed only when at least this many complete buckets
#: exist. Below that, an "HTF zone" would be a guess dressed up as confluence.
MIN_HTF_CANDLES = 12

#: Factors applied to the selected timeframe for the two higher contexts.
HTF_FACTORS = (4, 16)


def _safe_median(values: Sequence[float]) -> Optional[float]:
    usable = [float(value) for value in values if math.isfinite(float(value))]
    return median(usable) if usable else None


def _std(values: Sequence[float], centre: float) -> float:
    if not values:
        return 0.0
    return math.sqrt(sum((value - centre) ** 2 for value in values) / len(values))


def _round(value: float, decimals: int = 6) -> float:
    factor = 10**decimals
    return round(value * factor) / factor


def _timeframe_minutes(timeframe: str) -> Optional[int]:
    return TIMEFRAME_MINUTES.get(timeframe)


def _reference_atr(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float]) -> Optional[float]:
    """Median ATR over the most recent 120 bars.

    A median is deliberately used instead of the latest ATR: a single violent
    bar should not widen every zone on the chart.
    """
    values = atr_series(highs, lows, closes, ATR_PERIOD)
    usable = [float(value) for value in values[-120:] if value is not None and math.isfinite(float(value)) and float(value) > 0]
    if usable:
        return _safe_median(usable)
    # No ATR (e.g. a very short but valid series): fall back to the median range.
    ranges = [high - low for high, low in zip(highs, lows)]
    return _safe_median([value for value in ranges if value > 0])


def _confirmed_swings(
    candles: Sequence[dict[str, float]],
    lookback: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return confirmed swing highs and lows with confirmation timestamps."""
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]
    count = len(candles)
    swing_highs: list[dict[str, Any]] = []
    swing_lows: list[dict[str, Any]] = []

    for index in range(lookback, count - lookback):
        high_window = highs[index - lookback : index + lookback + 1]
        low_window = lows[index - lookback : index + lookback + 1]
        confirmed_index = index + lookback
        confirmed_at = int(candles[confirmed_index]["time"])

        if highs[index] == max(high_window) and high_window.count(highs[index]) == 1:
            candle = candles[index]
            candle_range = candle["high"] - candle["low"]
            upper_wick = candle["high"] - max(candle["open"], candle["close"])
            rejection = upper_wick / candle_range if candle_range > 0 else 0.0
            swing_highs.append(
                {
                    "index": index,
                    "price": float(candle["high"]),
                    "time": int(candle["time"]),
                    "confirmedAtTime": confirmed_at,
                    "rejection": max(0.0, min(1.0, rejection)),
                }
            )

        if lows[index] == min(low_window) and low_window.count(lows[index]) == 1:
            candle = candles[index]
            candle_range = candle["high"] - candle["low"]
            lower_wick = min(candle["open"], candle["close"]) - candle["low"]
            rejection = lower_wick / candle_range if candle_range > 0 else 0.0
            swing_lows.append(
                {
                    "index": index,
                    "price": float(candle["low"]),
                    "time": int(candle["time"]),
                    "confirmedAtTime": confirmed_at,
                    "rejection": max(0.0, min(1.0, rejection)),
                }
            )

    return swing_highs, swing_lows


def _collapse_interactions(points: Sequence[dict[str, Any]], lookback: int) -> list[dict[str, Any]]:
    """Collapse pivots closer than one interaction window into one reaction."""
    if not points:
        return []
    separation = max(2, lookback // 2)
    ordered = sorted(points, key=lambda point: point["index"])
    kept: list[dict[str, Any]] = []
    group: list[dict[str, Any]] = [ordered[0]]

    def flush() -> None:
        winner = max(group, key=lambda point: (point["rejection"], -point["index"]))
        kept.append(winner)

    for point in ordered[1:]:
        if point["index"] - group[-1]["index"] <= separation:
            group.append(point)
        else:
            flush()
            group = [point]
    flush()
    return kept


def _cluster_points(
    points: Sequence[dict[str, Any]],
    tolerance: float,
) -> list[dict[str, Any]]:
    """Greedy price clustering around a running median."""
    if not points:
        return []
    ordered = sorted(points, key=lambda point: (point["price"], point["index"]))
    groups: list[list[dict[str, Any]]] = [[ordered[0]]]

    for point in ordered[1:]:
        group = groups[-1]
        centre = median([item["price"] for item in group])
        if abs(point["price"] - centre) <= tolerance:
            group.append(point)
        else:
            groups.append([point])

    clusters: list[dict[str, Any]] = []
    for index, group in enumerate(groups):
        prices = [item["price"] for item in group]
        centre = sum(prices) / len(prices)
        dispersion = _std(prices, centre)
        clusters.append(
            {
                "id": f"cluster-{index}",
                "price": centre,
                "prices": prices,
                "dispersion": dispersion,
                "reactions": group,
                "firstTime": min(item["time"] for item in group),
                "lastTime": max(item["time"] for item in group),
                "lastIndex": max(item["index"] for item in group),
            }
        )
    return clusters


def _zone_half_width(centre: float, dispersion: float, atr_ref: float) -> float:
    minimum = max(MIN_WIDTH_ATR * atr_ref, abs(centre) * 0.0003)
    from_data = dispersion * 0.75 + 0.05 * atr_ref
    half = max(minimum, from_data)
    cap = max(MAX_WIDTH_ATR * atr_ref, abs(centre) * 0.02)
    return min(half, cap)


def _build_candidate_zones(
    candles: Sequence[dict[str, float]],
    lookback: int,
    tolerance: float,
    atr_ref: float,
    reference_price: float,
    source_timeframe: str,
) -> list[dict[str, Any]]:
    swing_highs, swing_lows = _confirmed_swings(candles, lookback)
    reactions = _collapse_interactions(swing_highs, lookback) + _collapse_interactions(swing_lows, lookback)
    clusters = _cluster_points(reactions, tolerance)

    candidates: list[dict[str, Any]] = []
    for cluster in clusters:
        centre = float(cluster["price"])
        half = _zone_half_width(centre, float(cluster["dispersion"]), atr_ref)
        low = max(0.0, centre - half)
        high = centre + half
        if not math.isfinite(low) or not math.isfinite(high) or high <= low:
            continue
        candidates.append(
            {
                "centre": centre,
                "zoneLow": low,
                "zoneHigh": high,
                "reactions": list(cluster["reactions"]),
                "methods": ["swing_cluster"],
                "firstTime": int(cluster["firstTime"]),
                "lastTime": int(cluster["lastTime"]),
                "sourceTimeframe": source_timeframe,
            }
        )

    # Merge zones that overlap or nearly touch. This is what prevents a single
    # historical reaction from being shown as three adjacent boxes.
    merged: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: item["zoneLow"]):
        previous = merged[-1] if merged else None
        if previous is not None:
            gap = candidate["zoneLow"] - previous["zoneHigh"]
            if gap <= tolerance * 0.5:
                reaction_times = {reaction["time"] for reaction in previous["reactions"]}
                for reaction in candidate["reactions"]:
                    if reaction["time"] not in reaction_times:
                        previous["reactions"].append(reaction)
                        reaction_times.add(reaction["time"])
                previous["zoneLow"] = min(previous["zoneLow"], candidate["zoneLow"])
                previous["zoneHigh"] = max(previous["zoneHigh"], candidate["zoneHigh"])
                previous["firstTime"] = min(previous["firstTime"], candidate["firstTime"])
                previous["lastTime"] = max(previous["lastTime"], candidate["lastTime"])
                previous["centre"] = (previous["zoneLow"] + previous["zoneHigh"]) / 2.0
                for method in candidate["methods"]:
                    if method not in previous["methods"]:
                        previous["methods"].append(method)
                continue
        merged.append(dict(candidate))

    reference_price = float(reference_price)
    zones: list[dict[str, Any]] = []
    for index, zone in enumerate(merged):
        low = float(zone["zoneLow"])
        high = float(zone["zoneHigh"])
        centre = (low + high) / 2.0
        role = "support" if high < reference_price else "resistance" if low > reference_price else "both"
        reactions = sorted(zone["reactions"], key=lambda item: item["time"])
        reaction_times = sorted({int(reaction["time"]) for reaction in reactions})

        status = _zone_status(candles, low, high, atr_ref)
        if len(reaction_times) < MIN_REACTIONS and status != "broken":
            status = "provisional"

        zones.append(
            {
                "id": f"zone-{index}-{role}",
                "role": role,
                "status": status,
                "zoneLow": _round(low),
                "zoneHigh": _round(high),
                "midpoint": _round(centre),
                "width": _round(high - low),
                "widthPercent": _round(((high - low) / reference_price) * 100.0) if reference_price else 0.0,
                "distancePercent": _round(((centre - reference_price) / abs(reference_price)) * 100.0)
                if reference_price
                else 0.0,
                "strength": 0.0,  # scored after confluence is known
                "strengthMeaning": "heuristic_0_100",
                "methods": list(zone["methods"]),
                "confluenceCount": len(zone["methods"]),
                "reactionCount": len(reaction_times),
                "reactionTimes": reaction_times,
                "firstTouchTime": int(zone["firstTime"]),
                "lastTouchTime": int(zone["lastTime"]),
                "sourceTimeframe": zone["sourceTimeframe"],
                "confluence": [],
                "evidence": [],
                "warnings": [],
                "_reactions": reactions,
            }
        )

    return zones


def _zone_status(
    candles: Sequence[dict[str, float]],
    zone_low: float,
    zone_high: float,
    atr_ref: float,
) -> str:
    """Active unless two consecutive closes sit beyond a buffered boundary."""
    if len(candles) < BREAK_CONFIRM_CLOSES:
        return "active"
    buffer = atr_ref * BREAK_BUFFER_ATR
    last_closes = [float(candle["close"]) for candle in candles[-BREAK_CONFIRM_CLOSES:]]
    broke_up = all(close > zone_high + buffer for close in last_closes)
    broke_down = all(close < zone_low - buffer for close in last_closes)
    return "broken" if broke_up or broke_down else "active"


def _aggregate_higher_timeframe(
    candles: Sequence[dict[str, float]],
    factor: int,
) -> list[dict[str, float]]:
    """Aggregate complete base-candle buckets into a higher timeframe.

    A bucket is used only when it has already ended at or before the newest
    candle's open time. That excludes the in-progress higher-timeframe bar, so
    confluence cannot be computed from a partial candle.
    """
    if len(candles) < 2:
        return []
    base_ms = int(candles[1]["time"]) - int(candles[0]["time"])
    if base_ms <= 0:
        return []
    bucket_ms = base_ms * factor
    last_time = int(candles[-1]["time"])

    buckets: dict[int, dict[str, Any]] = {}
    for candle in candles:
        time = int(candle["time"])
        bucket_time = (time // bucket_ms) * bucket_ms

        # Conservative: the bucket must end no later than the newest bar's open.
        if bucket_time + bucket_ms > last_time:
            continue
        bucket = buckets.get(bucket_time)
        if bucket is None:
            buckets[bucket_time] = {
                "time": bucket_time,
                "open": float(candle["open"]),
                "high": float(candle["high"]),
                "low": float(candle["low"]),
                "close": float(candle["close"]),
                "volume": float(candle.get("volume", 0.0) or 0.0),
                "count": 1,
            }
        else:
            bucket["high"] = max(bucket["high"], float(candle["high"]))
            bucket["low"] = min(bucket["low"], float(candle["low"]))
            bucket["close"] = float(candle["close"])
            bucket["volume"] += float(candle.get("volume", 0.0) or 0.0)
            bucket["count"] += 1

    complete = [
        bucket
        for _, bucket in sorted(buckets.items())
        if bucket["count"] >= max(1, int(factor * 0.7))
    ]
    return complete


def _volume_evidence(
    candles: Sequence[dict[str, float]],
    reactions: Sequence[dict[str, Any]],
) -> tuple[bool, Optional[float]]:
    """Relative volume at reactions, only when volume is actually reported.

    A venue that reports zeros everywhere (some FX feeds) must not be described
    as confirming a zone with volume. The check is deliberately conservative.
    """
    volumes = [float(candle.get("volume", 0.0) or 0.0) for candle in candles]
    non_zero = [value for value in volumes if value > 0]
    if len(non_zero) < max(10, int(len(volumes) * 0.6)):
        return False, None
    baseline = _safe_median(non_zero[-60:])
    if not baseline or baseline <= 0:
        return False, None

    ratio_values: list[float] = []
    for reaction in reactions:
        index = int(reaction["index"])
        if 0 <= index < len(volumes) and volumes[index] > 0:
            ratio_values.append(volumes[index] / baseline)
    if not ratio_values:
        return False, None
    return True, sum(ratio_values) / len(ratio_values)


def _recency_score(zone: dict[str, Any], reference_time: int, first_time: int) -> float:
    span = max(1, reference_time - first_time)
    recency = 1.0 - ((reference_time - int(zone["lastTouchTime"])) / span)
    return 15.0 * max(0.0, min(1.0, recency))


def _finalise_strength(
    zones: list[dict[str, Any]],
    reference_time: int,
    first_time: int,
    volume_available: bool,
    volume_ratio: Optional[float],
) -> None:
    for zone in zones:
        reaction_score = min(40.0, 12.0 + 8.0 * (max(1, int(zone["reactionCount"])) - 1))
        rejections = [float(reaction["rejection"]) for reaction in zone.get("_reactions", [])]
        rejection_score = 20.0 * (sum(rejections) / len(rejections) if rejections else 0.0)
        recency_score = _recency_score(zone, reference_time, first_time)
        confluence_score = 10.0 * min(1.0, len(zone["confluence"]) / 2.0)
        volume_score = 5.0 if volume_available and volume_ratio is not None and volume_ratio >= 1.2 else 0.0
        zone["strength"] = _round(
            max(0.0, min(95.0, reaction_score + rejection_score + recency_score + confluence_score + volume_score)),
            1,
        )


def _evidence(zone: dict[str, Any], volume_available: bool, volume_ratio: Optional[float]) -> None:
    evidence = [
        f"این ناحیه از {zone['reactionCount']} واکنش مستقلِ سوئینگ تأییدشده ساخته شده است.",
        f"پهنا با نوسان بازار تنظیم شده و {zone['width']} واحد قیمت "
        f"({zone['widthPercent']}٪) است.",
    ]
    if zone["confluence"]:
        frames = "، ".join(sorted({item["timeframe"] for item in zone["confluence"]}))
        evidence.append(f"با ناحیه‌های تایم‌فریم بالاتر ({frames}) هم‌پوشانی دارد.")
    if volume_available and volume_ratio is not None:
        if volume_ratio >= 1.2:
            evidence.append(
                f"میانگین حجم در واکنش‌ها {volume_ratio:.2f} برابر میانه اخیر است."
            )
        else:
            evidence.append(
                f"حجم در واکنش‌ها ({volume_ratio:.2f} برابر میانه) تأیید قوی‌ای ارائه نمی‌کند."
            )
    else:
        evidence.append("داده حجم قابل اتکا نبود؛ امتیاز حجم در محاسبه لحاظ نشد.")

    warnings: list[str] = []
    if zone["status"] == "provisional":
        warnings.append("این ناحیه فقط یک واکنش تأییدشده دارد و آزمایشی (provisional) است.")
    if zone["reactionCount"] < MIN_REACTIONS and zone["status"] != "provisional":
        warnings.append("تعداد واکنش‌های مستقل کم است.")
    if zone["status"] == "broken":
        warnings.append("دو بسته‌شدن متوالی فراتر از مرز ناحیه ثبت شده؛ ناحیه شکسته‌شده است.")
    if not zone["confluence"]:
        warnings.append("شواهد تایم‌فریم بالاتر برای این ناحیه موجود نبود.")

    zone["evidence"] = evidence
    zone["warnings"] = warnings


def _detect_zone_set(
    candles: Sequence[dict[str, float]],
    timeframe: str,
    swing_lookback: int,
    max_zones: int,
    include_htf: bool,
) -> dict[str, Any]:
    count = len(candles)
    warnings: list[str] = []
    empty = {
        "zones": [],
        "supports": [],
        "resistances": [],
        "nearestSupport": None,
        "nearestResistance": None,
        "referencePrice": float(candles[-1]["close"]) if candles else 0.0,
        "referenceTime": int(candles[-1]["time"]) if candles else 0,
        "higherTimeframeZones": [],
        "method": {
            "version": ZONE_METHOD_VERSION,
            "atrPeriod": ATR_PERIOD,
            "swingLookback": swing_lookback,
            "clusterToleranceAtr": CLUSTER_TOLERANCE_ATR,
            "minWidthAtr": MIN_WIDTH_ATR,
            "maxWidthAtr": MAX_WIDTH_ATR,
            "breakBufferAtr": BREAK_BUFFER_ATR,
            "breakConfirmCloses": BREAK_CONFIRM_CLOSES,
            "minReactions": MIN_REACTIONS,
        },
        "warnings": warnings,
    }

    if count < swing_lookback * 2 + 5:
        warnings.append("برای ساخت ناحیه قیمتی داده کافی وجود ندارد؛ هیچ ناحیه‌ای ساخته نشد.")
        return empty

    highs = [float(candle["high"]) for candle in candles]
    lows = [float(candle["low"]) for candle in candles]
    closes = [float(candle["close"]) for candle in candles]
    reference_price = closes[-1]
    reference_time = int(candles[-1]["time"])
    first_time = int(candles[0]["time"])

    atr_ref = _reference_atr(highs, lows, closes)
    if not atr_ref or atr_ref <= 0:
        atr_ref = max(reference_price * 0.002, 1e-9)
        warnings.append("ATR قابل محاسبه نبود؛ پهنا با کسری از قیمت تخمین زده شد.")

    tolerance = max(atr_ref * CLUSTER_TOLERANCE_ATR, reference_price * 0.0002, 1e-9)
    zones = _build_candidate_zones(
        candles, swing_lookback, tolerance, atr_ref, reference_price, timeframe
    )
    if not zones:
        warnings.append("هیچ ناحیه‌ای با شواهد کافی شناسایی نشد.")
        return empty

    htf_sets: list[dict[str, Any]] = []
    if include_htf:
        base_minutes = _timeframe_minutes(timeframe)
        if base_minutes is None:
            warnings.append("تایم‌فریم پایه برای هم‌پوشانی چندزمانی قابل تفسیر نبود.")
        else:
            for factor in HTF_FACTORS:
                htf_candles = _aggregate_higher_timeframe(candles, factor)
                if len(htf_candles) < MIN_HTF_CANDLES:
                    continue
                htf_label = _label_for_minutes(base_minutes * factor)
                if htf_label is None:
                    continue
                htf_zones = _detect_zone_set(
                    htf_candles,
                    htf_label,
                    swing_lookback=max(2, min(swing_lookback, 3)),
                    max_zones=4,
                    include_htf=False,
                )["zones"]
                htf_sets.append(
                    {
                        "timeframe": htf_label,
                        "candleCount": len(htf_candles),
                        "zones": htf_zones,
                    }
                )

    # Confluence is decided on the base zones, then strength is finalised.
    for zone in zones:
        overlaps = []
        for htf in htf_sets:
            for htf_zone in htf["zones"]:
                overlap = min(zone["zoneHigh"], htf_zone["zoneHigh"]) - max(
                    zone["zoneLow"], htf_zone["zoneLow"]
                )
                narrower = min(
                    zone["zoneHigh"] - zone["zoneLow"], htf_zone["zoneHigh"] - htf_zone["zoneLow"]
                )
                if overlap <= 0 or narrower <= 0:
                    continue
                ratio = overlap / narrower
                if ratio >= 0.30:
                    overlaps.append(
                        {
                            "timeframe": htf["timeframe"],
                            "zoneLow": htf_zone["zoneLow"],
                            "zoneHigh": htf_zone["zoneHigh"],
                            "overlapRatio": _round(ratio, 3),
                        }
                    )
        zone["confluence"] = overlaps
        if overlaps and "htf_confluence" not in zone["methods"]:
            zone["methods"].append("htf_confluence")
        zone["confluenceCount"] = len(zone["methods"]) + len(overlaps)

    volume_available, volume_ratio = _volume_evidence(candles, [r for zone in zones for r in zone["_reactions"]])
    _finalise_strength(zones, reference_time, first_time, volume_available, volume_ratio)

    for zone in zones:
        _evidence(zone, volume_available, volume_ratio)
        zone.pop("_reactions", None)

    # A zone containing the reference close is genuinely both: it can act as
    # support from above and resistance from below until price leaves it. It is
    # therefore surfaced on both sides, with the `both` role making that clear.
    supports = [
        zone for zone in zones if zone["midpoint"] < reference_price or zone["role"] == "both"
    ]
    resistances = [
        zone for zone in zones if zone["midpoint"] > reference_price or zone["role"] == "both"
    ]

    def rank(zone: dict[str, Any]) -> tuple[int, float, float]:
        status_rank = 0 if zone["status"] == "active" else 1 if zone["status"] == "provisional" else 2
        return (status_rank, -zone["strength"], abs(zone["distancePercent"]))

    supports.sort(key=rank)
    resistances.sort(key=rank)

    # Broken zones are evidence of failed structure, not candidates for a
    # reaction; keep only the most recent ones to avoid a wall of boxes.
    broken = [zone for zone in zones if zone["status"] == "broken"]
    if len(broken) > MAX_BROKEN_ZONES:
        keep = {zone["id"] for zone in sorted(broken, key=lambda item: item["lastTouchTime"], reverse=True)[:MAX_BROKEN_ZONES]}
        zones = [zone for zone in zones if zone["status"] != "broken" or zone["id"] in keep]
        supports = [zone for zone in supports if zone["status"] != "broken" or zone["id"] in keep]
        resistances = [zone for zone in resistances if zone["status"] != "broken" or zone["id"] in keep]

    supports = supports[:max_zones]
    resistances = resistances[:max_zones]
    selected_ids = {zone["id"] for zone in supports + resistances}
    zones = [zone for zone in zones if zone["id"] in selected_ids]
    zones.sort(key=lambda zone: (zone["midpoint"], zone["id"]))

    return {
        "zones": zones,
        "supports": supports,
        "resistances": resistances,
        "nearestSupport": next((zone for zone in supports if zone["status"] != "broken"), None),
        "nearestResistance": next((zone for zone in resistances if zone["status"] != "broken"), None),
        "referencePrice": _round(reference_price),
        "referenceTime": reference_time,
        "higherTimeframeZones": htf_sets,
        "method": {
            "version": ZONE_METHOD_VERSION,
            "atrPeriod": ATR_PERIOD,
            "swingLookback": swing_lookback,
            "clusterToleranceAtr": CLUSTER_TOLERANCE_ATR,
            "minWidthAtr": MIN_WIDTH_ATR,
            "maxWidthAtr": MAX_WIDTH_ATR,
            "breakBufferAtr": BREAK_BUFFER_ATR,
            "breakConfirmCloses": BREAK_CONFIRM_CLOSES,
            "minReactions": MIN_REACTIONS,
        },
        "warnings": warnings,
    }


def _label_for_minutes(minutes: int) -> Optional[str]:
    for label, value in TIMEFRAME_MINUTES.items():
        if value == minutes:
            return label
    # 4h * 16 = 64h is not a standard label; keep the exact hour count so the
    # output never claims a timeframe that was not actually analysed.
    if minutes % 60 == 0:
        return f"{minutes // 60}h"
    return f"{minutes}m"


def detect_zones_from_candles(
    candles: Sequence[dict[str, Any]],
    timeframe: str = "1h",
    swing_lookback: int = 5,
    max_zones: int = 6,
) -> dict[str, Any]:
    """Zone detection over full OHLCV candles (preferred entry point)."""
    normalised = [
        {
            "time": int(candle["time"]),
            "open": float(candle["open"]),
            "high": float(candle["high"]),
            "low": float(candle["low"]),
            "close": float(candle["close"]),
            "volume": float(candle.get("volume", 0.0) or 0.0),
        }
        for candle in candles
    ]
    return _detect_zone_set(
        normalised,
        timeframe=timeframe,
        swing_lookback=max(2, int(swing_lookback)),
        max_zones=max(1, int(max_zones)),
        include_htf=True,
    )
