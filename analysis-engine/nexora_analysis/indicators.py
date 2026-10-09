"""Technical indicators.

Pure standard library on purpose: the engine must be runnable anywhere Python
3.10+ exists, with no install step and no supply-chain surface. Every function
accepts plain sequences of floats and returns lists aligned to the input, using
``None`` for the warm-up region where a value is not yet defined.

Every indicator here is a *calculation* over supplied candles. Nothing in this
module looks at the clock, the network, or any external source.
"""

from __future__ import annotations

from math import sqrt
from typing import Optional, Sequence

Number = Optional[float]

__all__ = [
    "sma",
    "ema",
    "rsi",
    "macd",
    "atr",
    "stdev",
    "percent_change",
    "last_value",
]


def _as_floats(values: Sequence[float]) -> list[float]:
    return [float(value) for value in values]


def sma(values: Sequence[float], period: int) -> list[Number]:
    """Simple moving average, aligned to ``values`` (``None`` during warm-up)."""
    if period <= 0:
        raise ValueError("period must be positive")
    series = _as_floats(values)
    result: list[Number] = [None] * len(series)
    if len(series) < period:
        return result

    window_sum = sum(series[:period])
    result[period - 1] = window_sum / period
    for index in range(period, len(series)):
        window_sum += series[index] - series[index - period]
        result[index] = window_sum / period
    return result


def ema(values: Sequence[float], period: int) -> list[Number]:
    """Exponential moving average, seeded with the SMA of the first window."""
    if period <= 0:
        raise ValueError("period must be positive")
    series = _as_floats(values)
    result: list[Number] = [None] * len(series)
    if len(series) < period:
        return result

    multiplier = 2.0 / (period + 1.0)
    seed = sum(series[:period]) / period
    result[period - 1] = seed
    previous = seed
    for index in range(period, len(series)):
        previous = (series[index] - previous) * multiplier + previous
        result[index] = previous
    return result


def _wilder_smoothing(values: list[float], period: int) -> list[Number]:
    """Wilder's smoothing used by RSI and ATR."""
    result: list[Number] = [None] * len(values)
    if len(values) < period:
        return result

    running = sum(values[:period]) / period
    result[period - 1] = running
    for index in range(period, len(values)):
        running = (running * (period - 1) + values[index]) / period
        result[index] = running
    return result


def rsi(closes: Sequence[float], period: int = 14) -> list[Number]:
    """Relative Strength Index using Wilder's smoothing (0-100)."""
    if period <= 1:
        raise ValueError("rsi period must be greater than 1")
    series = _as_floats(closes)
    result: list[Number] = [None] * len(series)
    if len(series) <= period:
        return result

    # Changes start at index 1, so the smoothed averages are offset by one and
    # the first defined RSI lands at index `period` (not `period - 1`).
    gains: list[float] = []
    losses: list[float] = []
    for index in range(1, len(series)):
        delta = series[index] - series[index - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))

    avg_gain = [None] + _wilder_smoothing(gains, period)
    avg_loss = [None] + _wilder_smoothing(losses, period)

    for index in range(len(series)):
        gain = avg_gain[index]
        loss = avg_loss[index]
        if gain is None or loss is None:
            continue
        if loss == 0:
            result[index] = 100.0 if gain > 0 else 50.0
        else:
            relative_strength = gain / loss
            result[index] = 100.0 - (100.0 / (1.0 + relative_strength))
    return result


def macd(
    closes: Sequence[float],
    fast_period: int = 12,
    slow_period: int = 26,
    signal_period: int = 9,
) -> tuple[list[Number], list[Number], list[Number]]:
    """MACD line, signal line and histogram, each aligned to ``closes``."""
    if fast_period >= slow_period:
        raise ValueError("macd fast period must be shorter than the slow period")

    series = _as_floats(closes)
    fast = ema(series, fast_period)
    slow = ema(series, slow_period)

    macd_line: list[Number] = [None] * len(series)
    for index in range(len(series)):
        fast_value = fast[index]
        slow_value = slow[index]
        if fast_value is not None and slow_value is not None:
            macd_line[index] = fast_value - slow_value

    # The signal line is an EMA of the *defined* portion of the MACD line, then
    # mapped back onto the original index space.
    defined = [(index, value) for index, value in enumerate(macd_line) if value is not None]
    signal_line: list[Number] = [None] * len(series)
    histogram: list[Number] = [None] * len(series)

    if len(defined) >= signal_period:
        compact = [value for _, value in defined]
        compact_signal = ema(compact, signal_period)
        for position, (original_index, value) in enumerate(defined):
            signal_value = compact_signal[position]
            if signal_value is None:
                continue
            signal_line[original_index] = signal_value
            histogram[original_index] = value - signal_value

    return macd_line, signal_line, histogram


def atr(
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    period: int = 14,
) -> list[Number]:
    """Average True Range (Wilder), aligned to the input series."""
    if not (len(highs) == len(lows) == len(closes)):
        raise ValueError("highs, lows and closes must have equal length")
    if len(closes) < period + 1:
        return [None] * len(closes)

    true_ranges: list[float] = [0.0]
    for index in range(1, len(closes)):
        true_range = max(
            highs[index] - lows[index],
            abs(highs[index] - closes[index - 1]),
            abs(lows[index] - closes[index - 1]),
        )
        true_ranges.append(true_range)

    smoothed = _wilder_smoothing(true_ranges[1:], period)
    # Re-align: smoothing started at true_ranges[1].
    return [None] + smoothed


def stdev(values: Sequence[float]) -> Optional[float]:
    """Population standard deviation; ``None`` for fewer than two samples."""
    series = _as_floats(values)
    if len(series) < 2:
        return None
    mean = sum(series) / len(series)
    variance = sum((value - mean) ** 2 for value in series) / len(series)
    return sqrt(variance)


def percent_change(first: float, last: float) -> Optional[float]:
    if first == 0:
        return None
    return ((last - first) / abs(first)) * 100.0


def last_value(series: Sequence[Number]) -> Optional[float]:
    """Last non-``None`` value of an indicator series."""
    for value in reversed(series):
        if value is not None:
            return float(value)
    return None
