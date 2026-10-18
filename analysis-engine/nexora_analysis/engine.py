"""Analysis orchestration.

`analyze()` is the whole public surface of the engine: it takes a validated
payload of candles plus options and returns a structured result that separates

* **facts** — numbers computed from the supplied candles,
* **interpretation** — prose derived from those numbers, clearly labelled as an
  interpretation, and
* **scenarios** — conditional, hypothetical setups with explicit invalidation, and
* **series** — index-aligned indicator arrays, returned only when
  ``options.includeSeries`` is set, so a chart can draw the same numbers this
  engine reports instead of recomputing them.

The engine never invents candles. If it is not given usable data it returns
``status="insufficient_data"`` or ``status="unavailable"`` with an explanation,
and no analytical conclusions at all.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Optional

from .indicators import atr, ema, macd, percent_change, rsi, sma, stdev
from .levels import detect_levels, find_swings
from .trend import classify_trend, regression_line

ENGINE_ID = "python"
ENGINE_NAME = "nexora-analysis-engine"
ENGINE_VERSION = "0.3.0"

DEFAULT_OPTIONS: dict[str, Any] = {
    "rsiPeriod": 14,
    "macdFast": 12,
    "macdSlow": 26,
    "macdSignal": 9,
    "smaPeriods": [20, 50, 200],
    "emaPeriods": [9, 21, 55],
    "atrPeriod": 14,
    "swingLookback": 5,
    "maxLevels": 5,
    # Off by default: `series` is a chart-rendering payload (every indicator value
    # for every candle), so a caller that only wants the report does not pay for
    # it. Reports never store it; the chart endpoint asks for it explicitly.
    "includeSeries": False,
}

# Absolute floor: below this we cannot even report a meaningful change.
MINIMUM_CANDLES = 5

#: Decimal places for the chart series payload. Prices are quoted far coarser
#: than this by every provider; the extra digits only exist so a chart curve is
#: visually identical to the value `facts` reports for the same bar.
SERIES_DECIMALS = 6
#: RSI is bounded 0-100, so two decimals are all a chart or a tooltip can use.
RSI_DECIMALS = 2


class EngineInputError(ValueError):
    """Raised when the payload itself is malformed (not merely too short)."""


def _coerce_options(raw: Any) -> dict[str, Any]:
    options = dict(DEFAULT_OPTIONS)
    if not isinstance(raw, dict):
        return options

    for key in ("rsiPeriod", "macdFast", "macdSlow", "macdSignal", "atrPeriod", "swingLookback", "maxLevels"):
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            options[key] = int(value)

    for key in ("smaPeriods", "emaPeriods"):
        value = raw.get(key)
        if isinstance(value, list):
            periods = [
                int(item)
                for item in value
                if isinstance(item, (int, float)) and not isinstance(item, bool) and item > 1
            ]
            if periods:
                options[key] = periods[:5]

    include_series = raw.get("includeSeries")
    if isinstance(include_series, bool):
        options["includeSeries"] = include_series

    if options["macdFast"] >= options["macdSlow"]:
        options["macdFast"], options["macdSlow"] = DEFAULT_OPTIONS["macdFast"], DEFAULT_OPTIONS["macdSlow"]

    return options


def required_candle_count(options: dict[str, Any]) -> int:
    """Candles needed before any indicator in the set is defined.

    Dominated by the MACD signal line: the slow EMA must warm up, then the
    signal EMA warms up on top of that.
    """
    slow = int(options["macdSlow"])
    signal = int(options["macdSignal"])
    longest_ma = max([int(p) for p in options["smaPeriods"]] + [int(p) for p in options["emaPeriods"]] + [slow])
    return max(slow + signal, longest_ma) + 5


# Candle-open-time window, in epoch milliseconds. This mirrors the TypeScript
# gateway in backend/src/services/marketData/types.ts (``sanitizeCandles``) and
# the reference port in backend/src/services/analysis/reference/index.ts, so a
# candle series cannot be interpreted differently on opposite sides of the
# Node/Python boundary. The window spans 2001-09-09 to ~2286: it accepts every
# realistic candle while rejecting the same instant expressed in seconds
# (~1.7e9), microseconds (~1.7e15) or nanoseconds (~1.7e18).
MIN_EPOCH_MS = 1e12
MAX_EPOCH_MS = 1e13


def _is_usable_candle(candle: dict[str, float]) -> bool:
    """Per-row validity check shared with the TypeScript gateway.

    Rows whose high/low do not bracket open/close are rejected rather than
    repaired: a real exchange bar cannot have that shape, and silently rewriting
    it would feed the indicators data that never actually traded.
    """
    if not all(math.isfinite(candle[key]) for key in ("time", "open", "high", "low", "close")):
        return False
    if candle["time"] < MIN_EPOCH_MS or candle["time"] >= MAX_EPOCH_MS:
        return False
    if min(candle["open"], candle["high"], candle["low"], candle["close"]) <= 0:
        return False
    return (
        candle["high"] >= candle["low"]
        and candle["high"] >= candle["open"]
        and candle["high"] >= candle["close"]
        and candle["low"] <= candle["open"]
        and candle["low"] <= candle["close"]
    )


def decode_candles(raw: Any) -> tuple[list[dict[str, float]], list[str]]:
    """Validate and normalise raw candle dictionaries.

    Returns the usable candles (ascending by time) plus warnings describing any
    entries that were skipped. Malformed *shape* raises; malformed *values* are
    skipped so one bad bar does not destroy an otherwise usable series.

    The row-level rules are intentionally identical to the TypeScript gateway
    (``sanitizeCandles``): same epoch-millisecond window, same OHLC bracketing
    requirement, same first-wins duplicate handling, same lenient volume — so
    whichever side processes a series, the result is the same.
    """
    if not isinstance(raw, list):
        raise EngineInputError("`candles` must be a list of OHLCV objects")

    usable: list[dict[str, float]] = []
    warnings: list[str] = []
    skipped = 0

    for entry in raw:
        if not isinstance(entry, dict):
            skipped += 1
            continue
        try:
            candle = {
                "time": float(entry["time"]),
                "open": float(entry["open"]),
                "high": float(entry["high"]),
                "low": float(entry["low"]),
                "close": float(entry["close"]),
            }
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue

        try:
            volume = float(entry.get("volume") or 0.0)
        except (TypeError, ValueError):
            volume = 0.0
        # Volume is lenient, as on the gateway: a missing, unparseable or
        # negative volume is zero rather than a reason to drop an otherwise
        # valid bar.
        candle["volume"] = volume if (math.isfinite(volume) and volume >= 0) else 0.0

        if not _is_usable_candle(candle):
            skipped += 1
            continue
        usable.append(candle)

    if skipped:
        warnings.append(f"{skipped} کندل نامعتبر نادیده گرفته شد.")

    usable.sort(key=lambda item: item["time"])

    # Collapse duplicate open times, keeping the *first* occurrence (as the
    # gateway does) so each step is a strictly positive interval for the slope
    # and swing logic.
    deduped: list[dict[str, float]] = []
    for candle in usable:
        if deduped and deduped[-1]["time"] == candle["time"]:
            continue
        deduped.append(candle)
    if len(deduped) != len(usable):
        warnings.append(f"{len(usable) - len(deduped)} کندل با زمان تکراری حذف شد.")

    return deduped, warnings


def _rsi_state(value: Optional[float]) -> tuple[str, str]:
    if value is None:
        return "unknown", "neutral"
    if value >= 70:
        return "overbought", "bearish"
    if value <= 30:
        return "oversold", "bullish"
    if value >= 55:
        return "bullish_bias", "bullish"
    if value <= 45:
        return "bearish_bias", "bearish"
    return "neutral", "neutral"


def _macd_state(histogram: Optional[float], previous: Optional[float]) -> tuple[str, str]:
    if histogram is None:
        return "unknown", "neutral"
    if previous is not None:
        if histogram > 0 and histogram > previous:
            return "bullish_rising", "bullish"
        if histogram > 0 and histogram <= previous:
            return "bullish_fading", "neutral"
        if histogram < 0 and histogram < previous:
            return "bearish_widening", "bearish"
        if histogram < 0 and histogram >= previous:
            return "bearish_fading", "neutral"
    if histogram > 0:
        return "bullish", "bullish"
    if histogram < 0:
        return "bearish", "bearish"
    return "neutral", "neutral"


def _ma_snapshot(closes: list[float], periods: Iterable[int], method: str) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    last_close = closes[-1]
    for period in periods:
        series = sma(closes, period) if method == "sma" else ema(closes, period)
        value = series[-1] if series else None
        if value is None:
            snapshots.append({"period": int(period), "value": None, "state": "warming_up", "signal": "neutral"})
            continue
        distance = ((last_close - value) / value) * 100.0 if value else 0.0
        signal = "bullish" if distance > 0 else "bearish" if distance < 0 else "neutral"
        snapshots.append(
            {
                "period": int(period),
                "value": float(value),
                "state": "above" if distance > 0 else "below" if distance < 0 else "at",
                "signal": signal,
            }
        )
    return snapshots


def _build_facts(
    candles: list[dict[str, float]],
    options: dict[str, Any],
) -> dict[str, Any]:
    closes = [candle["close"] for candle in candles]
    highs = [candle["high"] for candle in candles]
    lows = [candle["low"] for candle in candles]

    rsi_values = rsi(closes, int(options["rsiPeriod"]))
    latest_rsi = rsi_values[-1]
    rsi_state, rsi_signal = _rsi_state(latest_rsi)

    macd_line, signal_line, histogram = macd(
        closes, int(options["macdFast"]), int(options["macdSlow"]), int(options["macdSignal"])
    )
    macd_state, macd_signal = _macd_state(
        histogram[-1],
        histogram[-2] if len(histogram) >= 2 else None,
    )

    atr_values = atr(highs, lows, closes, int(options["atrPeriod"]))
    latest_atr = atr_values[-1]

    returns = [
        (closes[index] - closes[index - 1]) / closes[index - 1]
        for index in range(1, len(closes))
        if closes[index - 1] != 0
    ]
    volatility = stdev(returns)

    change = percent_change(closes[0], closes[-1])
    trend = classify_trend(highs, lows, closes, int(options["swingLookback"]))
    levels = detect_levels(highs, lows, closes, int(options["swingLookback"]), int(options["maxLevels"]), times=[int(c["time"]) for c in candles])

    return {
        "lastCandle": candles[-1],
        "candleCount": len(candles),
        "changePercent": None if change is None else round(change, 4),
        "volatilityPercent": None if volatility is None else round(volatility * 100.0, 4),
        "indicators": {
            "rsi": None
            if latest_rsi is None
            else {
                "value": round(float(latest_rsi), 2),
                "state": rsi_state,
                "signal": rsi_signal,
            },
            "macd": None
            if macd_line[-1] is None
            else {
                "macd": None if macd_line[-1] is None else round(float(macd_line[-1]), 6),
                "signal": None if signal_line[-1] is None else round(float(signal_line[-1]), 6),
                "histogram": None if histogram[-1] is None else round(float(histogram[-1]), 6),
                "state": macd_state,
                "signalDirection": macd_signal,
            },
            "sma": _ma_snapshot(closes, options["smaPeriods"], "sma"),
            "ema": _ma_snapshot(closes, options["emaPeriods"], "ema"),
            "atr": None
            if latest_atr is None
            else {"value": round(float(latest_atr), 6), "state": "volatility", "signal": "neutral"},
        },
        "trend": {
            "direction": trend["direction"],
            "strength": trend["strength"],
            "evidence": trend["evidence"],
            "higherHighs": trend["higherHighs"],
            "higherLows": trend["higherLows"],
        },
        "levels": levels,
        # Internal, stripped before the result leaves `analyze()`.
        "_meta": {"slopePercentPerCandle": trend.get("slopePercentPerCandle")},
    }


def _rounded(values: Iterable[Optional[float]], decimals: int = SERIES_DECIMALS) -> list[Optional[float]]:
    """Round an aligned indicator series, preserving its ``None`` warm-up gaps."""
    return [None if value is None else round(float(value), decimals) for value in values]


def _build_series(candles: list[dict[str, float]], options: dict[str, Any]) -> dict[str, Any]:
    """Every indicator value for every bar, aligned to the candle index.

    This is the payload a chart needs and nothing more. Two properties matter:

    * **Alignment** — each array has exactly ``len(candles)`` entries, so entry
      ``i`` belongs to ``candles[i]`` and the client never has to guess where an
      indicator starts,
    * **Agreement** — the last defined value of each array is the same number
      ``facts.indicators`` reports, because both come from these functions. A
      chart drawn from this block therefore cannot contradict the text report.

    The numbers are rounded only for transport; the rounding is stated here so it
    is not mistaken for precision that was never computed.
    """
    closes = [candle["close"] for candle in candles]
    highs = [candle["high"] for candle in candles]
    lows = [candle["low"] for candle in candles]

    macd_line, signal_line, histogram = macd(
        closes, int(options["macdFast"]), int(options["macdSlow"]), int(options["macdSignal"])
    )
    swing_highs, swing_lows = find_swings(highs, lows, int(options["swingLookback"]))
    regression = regression_line(closes)

    return {
        "count": len(candles),
        "sma": {str(period): _rounded(sma(closes, int(period))) for period in options["smaPeriods"]},
        "ema": {str(period): _rounded(ema(closes, int(period))) for period in options["emaPeriods"]},
        "rsi": _rounded(rsi(closes, int(options["rsiPeriod"])), RSI_DECIMALS),
        "macd": {
            "macd": _rounded(macd_line),
            "signal": _rounded(signal_line),
            "histogram": _rounded(histogram),
        },
        "atr": _rounded(atr(highs, lows, closes, int(options["atrPeriod"]))),
        "swings": {
            "highs": [
                {"index": int(index), "price": round(float(price), SERIES_DECIMALS)}
                for index, price in swing_highs
            ],
            "lows": [
                {"index": int(index), "price": round(float(price), SERIES_DECIMALS)}
                for index, price in swing_lows
            ],
        },
        "regression": None
        if regression is None
        else {
            "slope": round(float(regression["slope"]), 10),
            "intercept": round(float(regression["intercept"]), 10),
            "window": int(regression["window"]),
            "startIndex": int(regression["startIndex"]),
        },
    }


_TREND_LABELS = {
    "uptrend": "صعودی",
    "downtrend": "نزولی",
    "sideways": "بدون روند مشخص (رِنج)",
    "unknown": "نامشخص",
}


def _build_interpretation(facts: dict[str, Any], symbol: str, timeframe: str) -> dict[str, Any]:
    indicators = facts["indicators"]
    trend = facts["trend"] or {}
    direction = str(trend.get("direction", "unknown"))
    strength = trend.get("strength")

    rsi_data = indicators.get("rsi")
    macd_data = indicators.get("macd")
    levels = facts.get("levels") or {}
    rsi_value = rsi_data["value"] if rsi_data else None
    macd_histogram = macd_data["histogram"] if macd_data else None

    summary_parts = [
        f"در تایم‌فریم {timeframe}، روند فعلی {symbol} «{_TREND_LABELS.get(direction, 'نامشخص')}» "
        f"خوانده می‌شود"
        + (f" با قدرت تقریبی {strength} از ۱۰۰." if isinstance(strength, (int, float)) else ".")
    ]
    if rsi_value is not None:
        summary_parts.append(f"RSI روی {rsi_value} است.")
    if macd_histogram is not None:
        summary_parts.append(
            "هیستوگرام MACD "
            + ("مثبت است." if macd_histogram > 0 else "منفی است." if macd_histogram < 0 else "صفر است.")
        )
    nearest_support = levels.get("nearestSupport")
    nearest_resistance = levels.get("nearestResistance")
    if nearest_support and nearest_resistance:
        summary_parts.append(
            f"نزدیک‌ترین حمایت در {nearest_support['price']} و نزدیک‌ترین مقاومت در "
            f"{nearest_resistance['price']} قرار دارد."
        )

    trend_reading = (
        f"شیب اندازه‌گیری‌شده {facts.get('_meta', {}).get('slopePercentPerCandle')} درصد در هر کندل است. "
        if facts.get("_meta", {}).get("slopePercentPerCandle") is not None
        else ""
    ) + (
        "ساختار سقف‌ها و کف‌ها از ادامه روند حمایت می‌کند."
        if trend.get("higherHighs") and direction == "uptrend"
        else "ساختار سقف‌ها و کف‌ها از ادامه روند حمایت نمی‌کند."
        if direction in ("uptrend", "downtrend")
        else "قیمت در محدوده‌ای بدون جهت غالب نوسان می‌کند."
    )

    if rsi_value is None:
        momentum_reading = "برای محاسبه مومنتوم داده کافی وجود نداشت."
    elif rsi_value >= 70:
        momentum_reading = "RSI در ناحیه اشباع خرید است؛ ادامه حرکت نیازمند تایید حجم و ساختار قیمتی است."
    elif rsi_value <= 30:
        momentum_reading = "RSI در ناحیه اشباع فروش است؛ احتمال بازگشت کوتاه‌مدت وجود دارد اما تضمینی نیست."
    else:
        momentum_reading = "RSI در ناحیه میانی است و مومنتوم قاطعانه‌ای نشان نمی‌دهد."

    volatility = facts.get("volatilityPercent")
    candle_count = facts.get("candleCount")
    if volatility is None:
        volatility_reading = "نوسان قابل اندازه‌گیری نبود."
    elif volatility > 3:
        volatility_reading = (
            f"نوسان بازده‌ها (انحراف معیار ساده روی کل {candle_count} کندل) برابر "
            f"{volatility:g} درصد است؛ در چنین شرایطی حد ضرر باید بازتر و حجم کوچک‌تر باشد."
        )
    elif volatility < 0.8:
        volatility_reading = (
            f"نوسان بازده‌ها (انحراف معیار ساده روی کل {candle_count} کندل) برابر "
            f"{volatility:g} درصد است؛ بازار کم‌نوسان است."
        )
    else:
        volatility_reading = (
            f"نوسان بازده‌ها (انحراف معیار ساده روی کل {candle_count} کندل) برابر "
            f"{volatility:g} درصد در محدوده متعارف این تایم‌فریم است."
        )

    caveats = [
        "تمام اعداد این بخش از کندل‌های ورودی محاسبه شده‌اند و به کیفیت همان داده وابسته‌اند.",
        "هیچ‌کدام از این خوانش‌ها قطعی نیستند و می‌توانند با یک کندل جدید بی‌اعتبار شوند.",
        "این تحلیل جایگزین مدیریت ریسک، حجم معاملاتی و بررسی اخبار بنیادی نیست.",
    ]
    if facts["candleCount"] < 200:
        caveats.append(
            f"تنها {facts['candleCount']} کندل در دسترس بود؛ اندیکاتورهای بلندمدت مانند SMA200 معنای محدودی دارند."
        )

    return {
        "summary": " ".join(summary_parts),
        "trendReading": trend_reading,
        "momentumReading": momentum_reading,
        "volatilityReading": volatility_reading,
        "caveats": caveats,
    }


def _build_scenarios(facts: dict[str, Any]) -> list[dict[str, Any]]:
    levels = facts.get("levels") or {}
    trend = facts.get("trend") or {}
    last_close = facts["lastCandle"]["close"]
    nearest_support = levels.get("nearestSupport")
    nearest_resistance = levels.get("nearestResistance")
    direction = str(trend.get("direction", "unknown"))
    strength = trend.get("strength") or 0

    confidence = "high" if strength >= 60 else "medium" if strength >= 30 else "low"
    scenarios: list[dict[str, Any]] = []

    if nearest_resistance:
        scenarios.append(
            {
                "id": "breakout-up",
                "title": "شکست مقاومت نزدیک",
                "bias": "bullish",
                "condition": (
                    f"بسته‌شدن یک کندل بالای {nearest_resistance['price']} "
                    "شرط اولیه این سناریو است."
                ),
                "invalidation": (
                    f"بازگشت قیمت به زیر {nearest_resistance['price']} و تثبیت زیر آن، این سناریو را بی‌اعتبار می‌کند."
                ),
                "confidence": confidence,
            }
        )

    if nearest_support:
        scenarios.append(
            {
                "id": "breakdown-down",
                "title": "شکست حمایت نزدیک",
                "bias": "bearish",
                "condition": (
                    f"بسته‌شدن یک کندل زیر {nearest_support['price']} سناریوی ادامه نزول را فعال می‌کند."
                ),
                "invalidation": (
                    f"بازگشت و تثبیت قیمت بالای {nearest_support['price']} این سناریو را بی‌اعتبار می‌کند."
                ),
                "confidence": confidence,
            }
        )

    if direction == "sideways":
        scenarios.append(
            {
                "id": "range-play",
                "title": "نوسان در محدوده",
                "bias": "neutral",
                "condition": (
                    "تا زمانی که قیمت بین حمایت و مقاومت نزدیک نوسان می‌کند، حرکت جهت‌دار کم‌احتمال است."
                ),
                "invalidation": "خروج قیمت از محدوده با بسته‌شدن کندل خارج از آن، این خوانش را باطل می‌کند.",
                "confidence": "medium",
            }
        )

    if not scenarios:
        scenarios.append(
            {
                "id": "insufficient-levels",
                "title": "سطوح کافی شناسایی نشد",
                "bias": "neutral",
                "condition": "برای ساخت سناریوی شرطی، حداقل یک سطح حمایت یا مقاومت معتبر لازم است.",
                "invalidation": "با افزایش تعداد کندل‌ها این بخش بازمحاسبه می‌شود.",
                "confidence": "low",
            }
        )

    return scenarios


def analyze(payload: Any) -> dict[str, Any]:
    """Run the full analysis pipeline over a payload of candles."""
    if not isinstance(payload, dict):
        raise EngineInputError("payload must be a JSON object")

    options = _coerce_options(payload.get("options"))
    timeframe = str(payload.get("timeframe") or "unknown")
    symbol = str(payload.get("symbol") or "unknown")

    candles, warnings = decode_candles(payload.get("candles"))
    required = required_candle_count(options)

    base: dict[str, Any] = {
        "engine": {"id": ENGINE_ID, "name": ENGINE_NAME, "version": ENGINE_VERSION},
        "requiredCandles": required,
        "receivedCandles": len(candles),
        "warnings": warnings,
    }

    if len(candles) < MINIMUM_CANDLES:
        base.update(
            {
                "status": "unavailable",
                "facts": None,
                "interpretation": None,
                "scenarios": [],
                "series": None,
                "reason": (
                    f"برای تحلیل حداقل {MINIMUM_CANDLES} کندل معتبر لازم است "
                    f"اما فقط {len(candles)} کندل قابل استفاده دریافت شد."
                ),
            }
        )
        return base

    if len(candles) < required:
        base.update(
            {
                "status": "insufficient_data",
                "facts": None,
                "interpretation": None,
                "scenarios": [],
                "series": None,
                "reason": (
                    f"این مجموعه اندیکاتورها به {required} کندل نیاز دارد "
                    f"اما فقط {len(candles)} کندل دریافت شد. نتیجه‌ای تولید نشد."
                ),
            }
        )
        return base

    facts = _build_facts(candles, options)
    interpretation = _build_interpretation(facts, symbol, timeframe)
    # `_meta` is plumbing used while composing the narrative, not a fact.
    facts.pop("_meta", None)

    base.update(
        {
            "status": "ok",
            "facts": facts,
            "interpretation": interpretation,
            "scenarios": _build_scenarios(facts),
            "series": _build_series(candles, options) if options.get("includeSeries") else None,
            "reason": None,
        }
    )
    return base
