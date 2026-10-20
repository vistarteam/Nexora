"""Market structure, trend lines and conditional projections.

Everything here is deterministic over the supplied candles. Nothing reads the
clock, the network, or a future bar. The projection is deliberately labelled
experimental: its scenarios are *conditional*, and the confidence category is a
coarse evidence grade, never a calibrated probability.
"""

from __future__ import annotations

import math
from typing import Any, Optional, Sequence

from .zones import _confirmed_swings, _reference_atr

__all__ = [
    "analyze_market_structure",
    "detect_trendlines",
    "build_projection",
    "PROJECTION_VERSION",
]

PROJECTION_VERSION = "projection-0.1-experimental"

TIMEFRAME_MINUTES = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
    "1w": 10080,
}

STRUCTURE_BREAK_BUFFER_ATR = 0.15
TRENDLINE_TOLERANCE_ATR = 0.35
TRENDLINE_MAX_STEEPNESS = 0.35


def _round(value: float, decimals: int = 6) -> float:
    factor = 10**decimals
    return round(value * factor) / factor


def _structure_direction(
    highs: Sequence[dict[str, Any]], lows: Sequence[dict[str, Any]]
) -> str:
    if len(highs) < 2 or len(lows) < 2:
        return "unknown"
    last_highs = [point["price"] for point in highs[-3:]]
    last_lows = [point["price"] for point in lows[-3:]]
    higher_highs = all(b > a for a, b in zip(last_highs, last_highs[1:]))
    higher_lows = all(b > a for a, b in zip(last_lows, last_lows[1:]))
    lower_highs = all(b < a for a, b in zip(last_highs, last_highs[1:]))
    lower_lows = all(b < a for a, b in zip(last_lows, last_lows[1:]))
    if higher_highs and higher_lows:
        return "bullish"
    if lower_highs and lower_lows:
        return "bearish"
    return "ranging"


def analyze_market_structure(
    candles: Sequence[dict[str, float]],
    swing_lookback: int = 5,
) -> dict[str, Any]:
    """Confirmed swing structure plus BOS/CHoCH events.

    A break requires a candle *close* at least ``0.15 * ATR`` beyond the broken
    swing extreme. The first close that satisfies it is the event time. Swings
    are only available after their confirmation window, so a break can never be
    reported before the pivot it breaks was knowable.
    """
    count = len(candles)
    if count < swing_lookback * 2 + 3:
        return {
            "direction": "unknown",
            "swings": {"highs": [], "lows": []},
            "events": [],
            "lastEvent": None,
            "rules": {
                "confirmationBars": swing_lookback,
                "breakBufferAtr": STRUCTURE_BREAK_BUFFER_ATR,
            },
            "evidence": ["داده کافی برای ساختار بازار وجود ندارد."],
            "warnings": ["ساختار بازار بدون تعداد کافی کندل قابل تشخیص نیست."],
        }

    highs = [float(candle["high"]) for candle in candles]
    lows = [float(candle["low"]) for candle in candles]
    closes = [float(candle["close"]) for candle in candles]
    atr_ref = _reference_atr(highs, lows, closes) or max(closes[-1] * 0.002, 1e-9)
    swing_highs, swing_lows = _confirmed_swings(candles, swing_lookback)
    direction = _structure_direction(swing_highs, swing_lows)

    events: list[dict[str, Any]] = []
    last_direction: Optional[str] = None

    # Oldest swings first: an older level broken later is still a BOS; the
    # *sequence* is what makes a CHoCH visible.
    for swing in sorted(swing_highs, key=lambda point: point["index"]):
        confirmed_index = int(swing["index"]) + swing_lookback
        level = float(swing["price"])
        for index in range(confirmed_index, count):
            close = closes[index]
            if close <= level + atr_ref * STRUCTURE_BREAK_BUFFER_ATR:
                continue
            event_direction = "bullish"
            events.append(
                {
                    "type": "bos" if last_direction in (None, "bullish") else "choch",
                    "direction": event_direction,
                    "level": _round(level),
                    "close": _round(close),
                    "time": int(candles[index]["time"]),
                    "atrMultiple": _round((close - level) / atr_ref, 3) if atr_ref else None,
                }
            )
            last_direction = event_direction
            break

    for swing in sorted(swing_lows, key=lambda point: point["index"]):
        confirmed_index = int(swing["index"]) + swing_lookback
        level = float(swing["price"])
        for index in range(confirmed_index, count):
            close = closes[index]
            if close >= level - atr_ref * STRUCTURE_BREAK_BUFFER_ATR:
                continue
            event_direction = "bearish"
            events.append(
                {
                    "type": "bos" if last_direction in (None, "bearish") else "choch",
                    "direction": event_direction,
                    "level": _round(level),
                    "close": _round(close),
                    "time": int(candles[index]["time"]),
                    "atrMultiple": _round((level - close) / atr_ref, 3) if atr_ref else None,
                }
            )
            last_direction = event_direction
            break

    events.sort(key=lambda event: event["time"])
    events = events[-6:]
    last_event = events[-1] if events else None
    if last_event is not None:
        direction = "bullish" if last_event["direction"] == "bullish" else "bearish"

    evidence = [
        f"ساختار از سوئینگ‌های تأییدشده با پنجره {swing_lookback} کندل ساخته شده است.",
        f"آستانه شکست {STRUCTURE_BREAK_BUFFER_ATR:g} برابر ATR و بر اساس بسته‌شدن کندل است.",
    ]
    if last_event:
        label = "شکست ساختار (BOS)" if last_event["type"] == "bos" else "تغییر کاراکتر (CHoCH)"
        evidence.append(
            f"آخرین رخداد {label} {last_event['direction']} در سطح {last_event['level']} "
            f"با بسته‌شدن {last_event['close']} ثبت شده است."
        )
    else:
        evidence.append("هیچ شکست ساختاری با آستانه فعلی ثبت نشده است.")

    warnings: list[str] = []
    if len(events) >= 2:
        last_two = events[-2:]
        if {event["direction"] for event in last_two} == {"bullish", "bearish"}:
            warnings.append("آخرین دو رخداد ساختاری خلاف جهت هم هستند؛ بازار در حال گذار است.")
    if direction == "ranging":
        warnings.append("ساختار سقف/کف جهت غالب ندارد؛ رخدادهای شکست را با احتیاط بخوانید.")

    return {
        "direction": direction,
        "swings": {
            "highs": [
                {
                    "time": int(point["time"]),
                    "price": _round(float(point["price"])),
                    "index": int(point["index"]),
                    "confirmedAtTime": int(point["confirmedAtTime"]),
                    "rejection": _round(float(point["rejection"]), 4),
                }
                for point in swing_highs
            ],
            "lows": [
                {
                    "time": int(point["time"]),
                    "price": _round(float(point["price"])),
                    "index": int(point["index"]),
                    "confirmedAtTime": int(point["confirmedAtTime"]),
                    "rejection": _round(float(point["rejection"]), 4),
                }
                for point in swing_lows
            ],
        },
        "events": events,
        "lastEvent": last_event,
        "rules": {
            "confirmationBars": swing_lookback,
            "breakBufferAtr": STRUCTURE_BREAK_BUFFER_ATR,
        },
        "evidence": evidence,
        "warnings": warnings,
    }


def _line_value(anchor: dict[str, Any], slope: float, index: int) -> float:
    return float(anchor["price"]) + slope * (index - int(anchor["index"]))


def detect_trendlines(
    candles: Sequence[dict[str, float]],
    swing_lookback: int = 5,
    max_lines: int = 4,
) -> list[dict[str, Any]]:
    """Fit rising support / falling resistance lines to confirmed swing anchors.

    Candidate lines need two confirmed pivots and a slope that is not steeper
    than 35% of price over the whole window. Lines are ranked by independent
    touches, then R², then a steepness penalty. Two anchors are therefore enough
    only for a *provisional* line; three independent touches make it active.
    """
    count = len(candles)
    if count < swing_lookback * 2 + 5:
        return []

    highs = [float(candle["high"]) for candle in candles]
    lows = [float(candle["low"]) for candle in candles]
    closes = [float(candle["close"]) for candle in candles]
    atr_ref = _reference_atr(highs, lows, closes) or max(closes[-1] * 0.002, 1e-9)
    tolerance = atr_ref * TRENDLINE_TOLERANCE_ATR
    swing_highs, swing_lows = _confirmed_swings(candles, swing_lookback)
    last_index = count - 1
    last_time = int(candles[-1]["time"])
    reference_price = closes[-1]

    def candidates(points: Sequence[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = []
        if len(points) < 2:
            return found

        for first_index in range(len(points)):
            for second_index in range(first_index + 1, len(points)):
                first = points[first_index]
                second = points[second_index]
                span = int(second["index"]) - int(first["index"])
                if span < max(3, swing_lookback):
                    continue
                slope = (float(second["price"]) - float(first["price"])) / span
                if kind == "rising_support" and slope <= 0:
                    continue
                if kind == "falling_resistance" and slope >= 0:
                    continue
                if abs(slope) * count / reference_price > TRENDLINE_MAX_STEEPNESS:
                    continue

                touched: list[dict[str, Any]] = []
                for point in points:
                    predicted = _line_value(first, slope, int(point["index"]))
                    if abs(float(point["price"]) - predicted) <= tolerance:
                        touched.append(point)
                if len(touched) < 2:
                    continue

                predictions = [
                    _line_value(first, slope, int(point["index"])) for point in touched
                ]
                prices = [float(point["price"]) for point in touched]
                mean_price = sum(prices) / len(prices)
                sst = sum((price - mean_price) ** 2 for price in prices)
                sse = sum((price - prediction) ** 2 for price, prediction in zip(prices, predictions))
                r_squared = None if sst == 0 else max(0.0, min(1.0, 1.0 - sse / sst))

                line_now = _line_value(first, slope, last_index)
                broken = False
                if kind == "rising_support":
                    broken = reference_price < line_now - atr_ref * 0.5
                else:
                    broken = reference_price > line_now + atr_ref * 0.5

                status = "broken" if broken else "active" if len(touched) >= 3 else "provisional"
                steepness = abs(slope) * count / reference_price
                score = len(touched) * 10.0 + (r_squared or 0.0) * 20.0 - steepness * 10.0
                found.append(
                    {
                        "kind": kind,
                        "status": status,
                        "slopePerBar": slope,
                        "rSquared": r_squared,
                        "touches": len(touched),
                        "score": score,
                        "steepness": steepness,
                        "anchors": [touched[0], touched[-1]],
                        "endPrice": line_now,
                    }
                )
        return found

    combined = candidates(swing_lows, "rising_support") + candidates(swing_highs, "falling_resistance")
    combined.sort(key=lambda line: line["score"], reverse=True)

    lines: list[dict[str, Any]] = []
    seen_anchor_keys: set[tuple[str, int, int]] = set()
    for candidate in combined:
        anchor_key = (
            candidate["kind"],
            int(candidate["anchors"][0]["index"]),
            int(candidate["anchors"][-1]["index"]),
        )
        if anchor_key in seen_anchor_keys:
            continue
        # Different anchor pairs often describe the same geometric line. Keep
        # the best-scoring representative instead of drawing four copies.
        duplicate = any(
            line["kind"] == candidate["kind"]
            and abs(float(line["slopePerBar"]) - float(candidate["slopePerBar"])) * count <= tolerance
            and abs(float(line["endPoint"]["value"]) - float(candidate["endPrice"])) <= tolerance
            for line in lines
        )
        if duplicate:
            continue
        seen_anchor_keys.add(anchor_key)
        anchors = candidate["anchors"]
        evidence = [
            f"خط از {candidate['touches']} سوئینگ تأییدشده عبور می‌کند.",
            f"شیب خط {candidate['slopePerBar']:.8g} واحد قیمت در هر کندل است.",
        ]
        if candidate["rSquared"] is not None:
            evidence.append(f"ضریب تعیین برازش لنگرها {candidate['rSquared']:.3f} است.")
        warnings: list[str] = []
        if candidate["status"] == "provisional":
            warnings.append("این خط فقط دو لنگر تأییدشده دارد و آزمایشی است.")
        if candidate["status"] == "broken":
            warnings.append("قیمت با فاصله بیش از نیم ATR از خط عبور کرده؛ خط شکسته تلقی می‌شود.")
        if candidate["steepness"] > 0.2:
            warnings.append("شیب خط تند است و احتمال برازش بیش‌ازحد دارد.")

        lines.append(
            {
                "id": f"trendline-{len(lines) + 1}",
                "kind": candidate["kind"],
                "status": candidate["status"],
                "anchors": [
                    {
                        "time": int(anchor["time"]),
                        "price": _round(float(anchor["price"])),
                        "index": int(anchor["index"]),
                        "confirmedAtTime": int(anchor["confirmedAtTime"]),
                    }
                    for anchor in anchors
                ],
                "slopePerBar": _round(float(candidate["slopePerBar"]), 10),
                "rSquared": None
                if candidate["rSquared"] is None
                else _round(float(candidate["rSquared"]), 4),
                "touches": int(candidate["touches"]),
                "toleranceAtr": TRENDLINE_TOLERANCE_ATR,
                "endPoint": {"time": last_time, "value": _round(float(candidate["endPrice"]))},
                "evidence": evidence,
                "warnings": warnings,
            }
        )
        if len(lines) >= max_lines:
            break

    return lines


def _horizon_bars(timeframe: str) -> int:
    minutes = TIMEFRAME_MINUTES.get(timeframe)
    if minutes is None:
        return 24
    target_minutes = 24 * 60 if minutes <= 240 else 5 * 24 * 60
    return max(4, min(48, int(round(target_minutes / minutes))))


def _path(
    start_price: float,
    end_price: float,
    start_time: int,
    step_ms: int,
    horizon: int,
    atr_ref: float,
) -> tuple[list[dict[str, float]], list[dict[str, float]], list[dict[str, float]]]:
    path: list[dict[str, float]] = []
    band_low: list[dict[str, float]] = []
    band_high: list[dict[str, float]] = []
    steps = 6
    for step in range(steps + 1):
        fraction = step / steps
        value = start_price + (end_price - start_price) * fraction
        time = start_time + int(round(step_ms * horizon * fraction))
        uncertainty = atr_ref * math.sqrt(max(1e-9, horizon * fraction)) * 0.55
        path.append({"time": time, "value": _round(value)})
        band_low.append({"time": time, "value": _round(max(0.0, value - uncertainty))})
        band_high.append({"time": time, "value": _round(value + uncertainty)})
    return path, band_low, band_high


def build_projection(
    candles: Sequence[dict[str, float]],
    timeframe: str,
    structure: dict[str, Any],
    zones: Optional[dict[str, Any]],
    trendlines: Sequence[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Conditional, volatility-scaled projection with three scenarios.

    The method is intentionally simple and auditable: ATR-scaled horizons and
    ranges, shifted by the nearest zone boundaries when they exist. It does not
    extrapolate the last slope, and it does not output probabilities.
    """
    if len(candles) < 30:
        return None

    closes = [float(candle["close"]) for candle in candles]
    highs = [float(candle["high"]) for candle in candles]
    lows = [float(candle["low"]) for candle in candles]
    reference_price = closes[-1]
    reference_time = int(candles[-1]["time"])
    atr_ref = _reference_atr(highs, lows, closes)
    if not atr_ref or atr_ref <= 0:
        return None

    minutes = TIMEFRAME_MINUTES.get(timeframe, 60)
    step_ms = minutes * 60_000
    horizon = _horizon_bars(timeframe)
    horizon_ends = reference_time + step_ms * horizon
    sigma = atr_ref * math.sqrt(horizon)

    support_zone = None
    resistance_zone = None
    if zones:
        support_zone = next(
            (zone for zone in zones.get("supports", []) if zone["status"] != "broken"), None
        )
        resistance_zone = next(
            (zone for zone in zones.get("resistances", []) if zone["status"] != "broken"), None
        )

    direction = str(structure.get("direction", "unknown"))
    active_lines = [line for line in trendlines if line["status"] == "active"]
    trendline_confluence = len(active_lines) > 0

    # Bullish: aim for the far side of the nearest resistance zone, but never
    # beyond 1.9 sigma; with no zone, use 0.9 sigma.
    bull_floor = reference_price + 0.35 * sigma
    if resistance_zone is not None:
        bull_target = max(bull_floor, float(resistance_zone["zoneHigh"]))
    else:
        bull_target = reference_price + 0.9 * sigma
    bull_target = min(bull_target, reference_price + 1.9 * sigma)
    bull_low = max(bull_floor, bull_target - 0.45 * sigma)
    bull_high = max(bull_low, bull_target)

    bear_ceiling = reference_price - 0.35 * sigma
    if support_zone is not None:
        bear_target = min(bear_ceiling, float(support_zone["zoneLow"]))
    else:
        bear_target = reference_price - 0.9 * sigma
    bear_target = max(bear_target, reference_price - 1.9 * sigma)
    bear_high = min(bear_ceiling, bear_target + 0.45 * sigma)
    bear_low = min(bear_high, bear_target)

    base_low = reference_price - 0.35 * sigma
    base_high = reference_price + 0.35 * sigma

    def confidence(aligned: bool) -> str:
        if aligned and direction in ("bullish", "bearish") and trendline_confluence:
            return "medium"
        return "low"

    experimental_note = (
        "این مسیر یک سناریوی شرطی و آزمایشی است؛ احتمال کالیبره‌شده یا پیش‌بینی قطعی قیمت نیست."
    )
    data_warnings: list[str] = []
    if len(candles) < 120:
        data_warnings.append("تعداد کندل‌ها برای اعتبارسنجی تاریخی این افق کم است.")
    if not zones or not zones.get("higherTimeframeZones"):
        data_warnings.append("شواهد تایم‌فریم بالاتر برای این پیش‌بینی موجود نبود.")
    if not any(float(candle.get("volume", 0.0) or 0.0) > 0 for candle in candles):
        data_warnings.append("داده حجم در دسترس نیست؛ سناریوها تنها بر قیمت و نوسان تکیه دارند.")

    bull_path, bull_band_low, bull_band_high = _path(
        reference_price, (bull_low + bull_high) / 2, reference_time, step_ms, horizon, atr_ref
    )
    base_path, base_band_low, base_band_high = _path(
        reference_price, reference_price, reference_time, step_ms, horizon, atr_ref
    )
    bear_path, bear_band_low, bear_band_high = _path(
        reference_price, (bear_low + bear_high) / 2, reference_time, step_ms, horizon, atr_ref
    )

    support_high = float(support_zone["zoneHigh"]) if support_zone else None
    resistance_low = float(resistance_zone["zoneLow"]) if resistance_zone else None

    scenarios: list[dict[str, Any]] = [
        {
            "id": "bullish",
            "name": "ادامه یا شکست صعودی",
            "activation": (
                f"بسته‌شدن یک کندل بالای سقف ناحیه مقاومت {resistance_zone['zoneHigh']} "
                "با فاصله حداقل ۰٫۱۵ برابر ATR."
                if resistance_zone
                else f"بسته‌شدن یک کندل بالاتر از {_round(reference_price + 0.5 * atr_ref)} "
                "همراه با ساختار سقف/کف صعودی."
            ),
            "invalidation": (
                f"بازگشت و بسته‌شدن زیر کف ناحیه حمایت {support_zone['zoneLow']}."
                if support_zone
                else f"بسته‌شدن زیر {_round(reference_price - 0.75 * atr_ref)}."
            ),
            "direction": "up",
            "targetLow": _round(bull_low),
            "targetHigh": _round(bull_high),
            "projectedPath": bull_path,
            "bandLow": bull_band_low,
            "bandHigh": bull_band_high,
            "confidence": confidence(direction == "bullish"),
            "confidenceMeaning": "درجه شواهد (کم/متوسط)، نه احتمال وقوع",
            "evidence": [
                f"نوسان مرجع ATR برابر {_round(atr_ref)} و افق {horizon} کندل است.",
                "ساختار فعلی: " + ("صعودی" if direction == "bullish" else "نزولی" if direction == "bearish" else "رِنج"),
            ]
            + (
                ["هم‌پوشانی با ناحیه تایم‌فریم بالاتر وجود دارد."]
                if resistance_zone and resistance_zone.get("confluence")
                else []
            ),
            "dataQualityWarnings": data_warnings,
        },
        {
            "id": "base",
            "name": "ادامه نوسان / خنثی",
            "activation": (
                "ماندن قیمت بین ناحیه حمایت و مقاومت نزدیک و نداشتن بسته‌شدن تأییدشده بیرون از آن‌ها."
                if support_zone and resistance_zone
                else "نبود شکست تأییدشده در هیچ جهت و ماندن نوسان در محدوده ATR اخیر."
            ),
            "invalidation": (
                "بسته‌شدن تأییدشده بیرون از محدوده حمایت/مقاومت، این سناریو را کنار می‌گذارد."
            ),
            "direction": "sideways",
            "targetLow": _round(base_low),
            "targetHigh": _round(base_high),
            "projectedPath": base_path,
            "bandLow": base_band_low,
            "bandHigh": base_band_high,
            "confidence": "low",
            "confidenceMeaning": "درجه شواهد (کم/متوسط)، نه احتمال وقوع",
            "evidence": [
                f"بازه پایه با ۰٫۳۵ برابر انحراف نوسانی افق ({_round(0.35 * sigma)}) ساخته شده است.",
            ],
            "dataQualityWarnings": data_warnings,
        },
        {
            "id": "bearish",
            "name": "رد یا شکست نزولی",
            "activation": (
                f"بسته‌شدن یک کندل زیر کف ناحیه حمایت {support_zone['zoneLow']} "
                "با فاصله حداقل ۰٫۱۵ برابر ATR."
                if support_zone
                else f"بسته‌شدن یک کندل زیر {_round(reference_price - 0.5 * atr_ref)} "
                "همراه با ساختار سقف/کف نزولی."
            ),
            "invalidation": (
                f"بازگشت و بسته‌شدن بالای سقف ناحیه مقاومت {resistance_zone['zoneHigh']}."
                if resistance_zone
                else f"بسته‌شدن بالای {_round(reference_price + 0.75 * atr_ref)}."
            ),
            "direction": "down",
            "targetLow": _round(bear_low),
            "targetHigh": _round(bear_high),
            "projectedPath": bear_path,
            "bandLow": bear_band_low,
            "bandHigh": bear_band_high,
            "confidence": confidence(direction == "bearish"),
            "confidenceMeaning": "درجه شواهد (کم/متوسط)، نه احتمال وقوع",
            "evidence": [
                f"نوسان مرجع ATR برابر {_round(atr_ref)} و افق {horizon} کندل است.",
                "ساختار فعلی: " + ("صعودی" if direction == "bullish" else "نزولی" if direction == "bearish" else "رِنج"),
            ]
            + (
                ["هم‌پوشانی با ناحیه تایم‌فریم بالاتر وجود دارد."]
                if support_zone and support_zone.get("confluence")
                else []
            ),
            "dataQualityWarnings": data_warnings,
        },
    ]

    return {
        "experimental": True,
        "method": "volatility_scaled_conditional_ranges",
        "version": PROJECTION_VERSION,
        "referenceTime": reference_time,
        "referencePrice": _round(reference_price),
        "horizonBars": horizon,
        "horizonEndsAt": horizon_ends,
        "atr": _round(atr_ref),
        "scenarios": scenarios,
        "warnings": [experimental_note]
        + ([f"آستانه‌های حمایت/مقاومت: {support_high} / {resistance_low}"] if support_high and resistance_low else []),
    }
