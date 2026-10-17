from __future__ import annotations

import unittest

from nexora_analysis import EngineInputError, analyze, decode_candles, required_candle_count
from nexora_analysis.engine import DEFAULT_OPTIONS
from nexora_analysis.trend import classify_trend, regression_line

from .helpers import make_candles


def payload(candles: list[dict]) -> dict:
    return {"symbol": "BINANCE:BTCUSDT", "timeframe": "1h", "candles": candles}


# A realistic epoch-millisecond open time. The decoder accepts only this unit
# (see MIN_EPOCH_MS / MAX_EPOCH_MS), so every hand-built candle below uses it.
T0 = 1_700_000_000_000


def candle(index: int, **overrides: float) -> dict:
    """A well-formed candle at ``T0 + index`` hours, with fields overridden."""
    entry = {"time": T0 + index * 3_600_000, "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5}
    entry.update(overrides)
    return entry


class TestDecodeCandles(unittest.TestCase):
    def test_rejects_non_list(self) -> None:
        with self.assertRaises(EngineInputError):
            decode_candles({"not": "a list"})

    def test_skips_malformed_entries_and_warns(self) -> None:
        raw = [
            candle(0),
            {**candle(1), "open": "bad"},
            "junk",
            candle(2),
        ]
        candles, warnings = decode_candles(raw)
        self.assertEqual(len(candles), 2)
        self.assertTrue(any("نادیده" in warning for warning in warnings))

    def test_keeps_first_duplicate_timestamp(self) -> None:
        raw = [candle(0), {**candle(0), "high": 3.0, "close": 2.5}]
        candles, warnings = decode_candles(raw)
        self.assertEqual(len(candles), 1)
        self.assertEqual(candles[0]["close"], 1.5)
        self.assertTrue(any("تکراری" in warning for warning in warnings))

    def test_drops_candles_whose_high_low_do_not_bracket_prices(self) -> None:
        raw = [candle(0, open=5.0, high=2.0, low=9.0, close=6.0)]
        candles, warnings = decode_candles(raw)
        self.assertEqual(candles, [])
        self.assertTrue(any("نادیده" in warning for warning in warnings))

    def test_drops_candle_whose_high_is_below_close(self) -> None:
        raw = [candle(0, high=1.2)]
        candles, warnings = decode_candles(raw)
        self.assertEqual(candles, [])
        self.assertTrue(any("نادیده" in warning for warning in warnings))

    def test_rejects_wrong_timestamp_units(self) -> None:
        raw = [
            candle(0, time=1_700_000_000),          # seconds — silently wrong
            candle(1, time=1_700_000_000_000_000),  # microseconds — silently wrong
            candle(2, time=1_700_000_000_000_000_000),  # nanoseconds — silently wrong
        ]
        candles, warnings = decode_candles(raw)
        self.assertEqual(candles, [])
        self.assertTrue(any("نادیده" in warning for warning in warnings))

    def test_drops_non_finite_prices(self) -> None:
        raw = [
            candle(0, high=float("nan")),
            candle(1, low=float("inf")),
        ]
        candles, warnings = decode_candles(raw)
        self.assertEqual(candles, [])
        self.assertTrue(any("نادیده" in warning for warning in warnings))

    def test_clamps_negative_volume_to_zero(self) -> None:
        candles, _ = decode_candles([candle(0, volume=-5.0)])
        self.assertEqual(len(candles), 1)
        self.assertEqual(candles[0]["volume"], 0.0)

    def test_volume_defaults_to_zero_when_missing_or_invalid(self) -> None:
        raw = [candle(0), {**candle(1), "volume": "not-a-number"}]
        candles, _ = decode_candles(raw)
        self.assertEqual(len(candles), 2)
        self.assertEqual([item["volume"] for item in candles], [0.0, 0.0])

    def test_sorts_by_time_ascending(self) -> None:
        raw = [candle(3), candle(1)]
        candles, _ = decode_candles(raw)
        self.assertEqual([item["time"] for item in candles], [T0 + 3_600_000, T0 + 10_800_000])


class TestAnalyzeStatuses(unittest.TestCase):
    def test_no_candles_is_unavailable_without_conclusions(self) -> None:
        result = analyze(payload([]))
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["facts"])
        self.assertIsNone(result["interpretation"])
        self.assertEqual(result["scenarios"], [])
        self.assertIn("reason", result)

    def test_short_series_is_insufficient_data(self) -> None:
        result = analyze(payload(make_candles(20)))
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIsNone(result["facts"])
        self.assertEqual(result["scenarios"], [])
        self.assertIn("requiredCandles", result)
        self.assertEqual(result["receivedCandles"], 20)

    def test_malformed_payload_raises(self) -> None:
        with self.assertRaises(EngineInputError):
            analyze("not an object")


class TestAnalyzeResults(unittest.TestCase):
    def setUp(self) -> None:
        self.result = analyze(payload(make_candles(300, amplitude=2.0)))

    def test_reports_ok_with_enough_data(self) -> None:
        self.assertEqual(self.result["status"], "ok", self.result.get("reason"))

    def test_engine_identity_is_reported(self) -> None:
        self.assertEqual(self.result["engine"]["id"], "python")
        self.assertTrue(self.result["engine"]["version"])

    def test_facts_are_present_and_numeric(self) -> None:
        facts = self.result["facts"]
        self.assertIsNotNone(facts)
        assert facts is not None
        self.assertEqual(facts["candleCount"], 300)
        self.assertIsNotNone(facts["lastCandle"])
        self.assertIsNotNone(facts["changePercent"])
        self.assertIsNotNone(facts["volatilityPercent"])

    def test_rsi_is_within_bounds(self) -> None:
        rsi_value = self.result["facts"]["indicators"]["rsi"]
        self.assertIsNotNone(rsi_value)
        self.assertGreaterEqual(rsi_value["value"], 0.0)
        self.assertLessEqual(rsi_value["value"], 100.0)

    def test_macd_histogram_is_consistent(self) -> None:
        macd_data = self.result["facts"]["indicators"]["macd"]
        self.assertIsNotNone(macd_data)
        self.assertAlmostEqual(
            macd_data["histogram"], macd_data["macd"] - macd_data["signal"], places=5
        )

    def test_moving_averages_cover_configured_periods(self) -> None:
        sma_periods = [item["period"] for item in self.result["facts"]["indicators"]["sma"]]
        self.assertEqual(sma_periods, DEFAULT_OPTIONS["smaPeriods"])
        ema_periods = [item["period"] for item in self.result["facts"]["indicators"]["ema"]]
        self.assertEqual(ema_periods, DEFAULT_OPTIONS["emaPeriods"])

    def test_levels_and_trend_are_deterministic(self) -> None:
        trend = self.result["facts"]["trend"]
        self.assertIn(trend["direction"], {"uptrend", "downtrend", "sideways"})
        self.assertTrue(trend["evidence"])
        levels = self.result["facts"]["levels"]
        self.assertIsNotNone(levels)

    def test_scenarios_are_conditional_and_carry_invalidation(self) -> None:
        scenarios = self.result["scenarios"]
        self.assertGreater(len(scenarios), 0)
        for scenario in scenarios:
            self.assertTrue(scenario["condition"])
            self.assertTrue(scenario["invalidation"])
            self.assertIn(scenario["confidence"], {"low", "medium", "high"})
            self.assertIn(scenario["bias"], {"bullish", "bearish", "neutral"})

    def test_interpretation_is_separated_from_facts(self) -> None:
        interpretation = self.result["interpretation"]
        self.assertIsNotNone(interpretation)
        self.assertTrue(interpretation["summary"])
        self.assertTrue(interpretation["caveats"])

    def test_no_forbidden_promises_in_output(self) -> None:
        """The engine must never claim certainty or guaranteed profit."""
        text = str(self.result)
        for forbidden in ("تضمین سود", "قطعا", "قطعاً سود"):
            self.assertNotIn(forbidden, text)

    def test_deterministic_output_for_identical_input(self) -> None:
        again = analyze(payload(make_candles(300, amplitude=2.0)))
        self.assertEqual(again["facts"]["indicators"]["rsi"], self.result["facts"]["indicators"]["rsi"])
        self.assertEqual(again["scenarios"], self.result["scenarios"])

    def test_two_volatility_metrics_are_labeled_with_their_window(self) -> None:
        """The whole-series and trend-window volatilities each state their definition."""
        text_volatility = self.result["interpretation"]["volatilityReading"]
        self.assertIn("انحراف معیار ساده روی کل 300 کندل", text_volatility)
        trend_volatility = next(
            line for line in self.result["facts"]["trend"]["evidence"] if "نوسان بازده‌ها" in line
        )
        self.assertIn("انحراف معیار روی آخرین 90 کندل روند", trend_volatility)

    def test_trend_volatility_does_not_masquerade_as_whole_series(self) -> None:
        """The two volatility labels must be distinguishable in the same report."""
        trend_volatility = next(
            line for line in self.result["facts"]["trend"]["evidence"] if "نوسان بازده‌ها" in line
        )
        # The trend line names its window and the whole-series label is absent,
        # so a reader can tell the trend figure from `facts.volatilityPercent`.
        self.assertIn("آخرین 90 کندل روند", trend_volatility)
        self.assertNotIn("ساده روی کل", trend_volatility)
        self.assertIn(
            "ساده روی کل 300 کندل",
            self.result["interpretation"]["volatilityReading"],
        )

    def test_levels_are_ordered_by_distance_nearest_first(self) -> None:
        levels = self.result["facts"]["levels"]
        self.assertIsNotNone(levels)
        assert levels is not None

        support_distances = [level["distancePercent"] for level in levels["supports"]]
        resistance_distances = [level["distancePercent"] for level in levels["resistances"]]

        self.assertEqual(support_distances, sorted(support_distances, reverse=True))
        self.assertEqual(resistance_distances, sorted(resistance_distances))

        if levels["supports"]:
            self.assertEqual(levels["nearestSupport"], levels["supports"][0])
        if levels["resistances"]:
            self.assertEqual(levels["nearestResistance"], levels["resistances"][0])


def series_payload(candles: list[dict]) -> dict:
    """An analysis request that explicitly asks for the chart series."""
    return {
        "symbol": "BINANCE:BTCUSDT",
        "timeframe": "1h",
        "candles": candles,
        "options": {"includeSeries": True},
    }


def zigzag_candles(count: int = 300, leg: int = 6, step: float = 0.01) -> list[dict]:
    """A deterministic zigzag: alternating legs of `leg` bars up and down.

    `make_candles` is deliberately smooth (it integrates a sine wave), so it has
    no unambiguous local extrema. Swing detection needs a series that actually
    turns, hence this second, also fully deterministic, generator.

    Wicks vary bar by bar on purpose. A bar's high is its `max(open, close)` plus
    a wick, and the bar that reverses a leg opens exactly where the previous one
    closed — a constant wick would therefore give two bars the *same* high, which
    `find_swings` rightly refuses to call a swing. Varying the wick makes every
    turning point strictly unique, as it is in real data.
    """
    candles: list[dict] = []
    price = 100.0
    for index in range(count):
        direction = 1.0 if (index // leg) % 2 == 0 else -1.0
        open_price = price
        close_price = open_price * (1 + direction * step)
        wick = 1.0 + 0.0005 + 0.002 * ((index * 37) % 11) / 11.0
        high = max(open_price, close_price) * wick
        low = min(open_price, close_price) * (2.0 - wick)
        candles.append(
            {
                "time": T0 + index * 3_600_000,
                "open": round(open_price, 6),
                "high": round(high, 6),
                "low": round(low, 6),
                "close": round(close_price, 6),
                "volume": 1000.0 + index,
            }
        )
        price = close_price
    return candles


class TestSeries(unittest.TestCase):
    """The chart series must be aligned to the candles and agree with `facts`."""

    def setUp(self) -> None:
        self.candles = zigzag_candles(300)
        self.result = analyze(series_payload(self.candles))
        self.series = self.result["series"]

    def test_absent_unless_requested(self) -> None:
        plain = analyze(payload(self.candles))
        self.assertIsNone(plain["series"])

    def test_present_when_requested(self) -> None:
        self.assertEqual(self.result["status"], "ok", self.result.get("reason"))
        self.assertIsNotNone(self.series)

    def test_every_array_is_aligned_to_the_candles(self) -> None:
        count = len(self.candles)
        assert self.series is not None
        self.assertEqual(self.series["count"], count)
        for period, values in self.series["sma"].items():
            self.assertEqual(len(values), count, f"sma {period}")
        for period, values in self.series["ema"].items():
            self.assertEqual(len(values), count, f"ema {period}")
        self.assertEqual(len(self.series["rsi"]), count)
        self.assertEqual(len(self.series["atr"]), count)
        for key in ("macd", "signal", "histogram"):
            self.assertEqual(len(self.series["macd"][key]), count, f"macd {key}")

    def test_warm_up_is_null_not_zero(self) -> None:
        assert self.series is not None
        sma200 = self.series["sma"][str(DEFAULT_OPTIONS["smaPeriods"][-1])]
        self.assertIsNone(sma200[0])
        self.assertIsNone(sma200[100])
        self.assertIsNotNone(sma200[-1])

    def test_last_values_agree_with_facts(self) -> None:
        """A chart drawn from `series` cannot contradict the text report."""
        facts = self.result["facts"]
        indicators = facts["indicators"]
        assert self.series is not None

        self.assertAlmostEqual(self.series["rsi"][-1], indicators["rsi"]["value"], places=2)
        self.assertAlmostEqual(
            self.series["macd"]["macd"][-1], indicators["macd"]["macd"], places=5
        )
        self.assertAlmostEqual(
            self.series["macd"]["signal"][-1], indicators["macd"]["signal"], places=5
        )
        self.assertAlmostEqual(
            self.series["macd"]["histogram"][-1], indicators["macd"]["histogram"], places=5
        )
        self.assertAlmostEqual(self.series["atr"][-1], indicators["atr"]["value"], places=5)

        for snapshot in indicators["sma"]:
            points = self.series["sma"][str(snapshot["period"])]
            self.assertAlmostEqual(points[-1], snapshot["value"], places=5)
        for snapshot in indicators["ema"]:
            points = self.series["ema"][str(snapshot["period"])]
            self.assertAlmostEqual(points[-1], snapshot["value"], places=5)

    def test_swings_point_at_real_bars(self) -> None:
        assert self.series is not None
        swings = self.series["swings"]
        self.assertTrue(swings["highs"] or swings["lows"])
        for point in swings["highs"]:
            self.assertEqual(
                point["price"], round(self.candles[point["index"]]["high"], 6)
            )
        for point in swings["lows"]:
            self.assertEqual(point["price"], round(self.candles[point["index"]]["low"], 6))

    def test_regression_line_reproduces_the_reported_slope(self) -> None:
        """The drawn line is the same fit `trend.slopePercentPerCandle` describes."""
        assert self.series is not None
        regression = self.series["regression"]
        self.assertIsNotNone(regression)

        start = regression["startIndex"]
        window = regression["window"]
        window_closes = [candle["close"] for candle in self.candles[start:]]
        self.assertEqual(len(window_closes), window)

        mean_price = sum(window_closes) / len(window_closes)
        slope_percent = (regression["slope"] / abs(mean_price)) * 100.0
        trend = classify_trend(
            [candle["high"] for candle in self.candles],
            [candle["low"] for candle in self.candles],
            [candle["close"] for candle in self.candles],
            int(DEFAULT_OPTIONS["swingLookback"]),
        )
        self.assertAlmostEqual(slope_percent, trend["slopePercentPerCandle"], places=4)

        # Both ends of the window lie on the fitted line.
        fitted_first = regression["intercept"]
        fitted_last = regression["intercept"] + regression["slope"] * (window - 1)
        self.assertNotAlmostEqual(fitted_first, fitted_last, places=6)

    def test_series_is_absent_when_the_engine_has_no_analysis(self) -> None:
        short = analyze(series_payload(make_candles(20)))
        self.assertEqual(short["status"], "insufficient_data")
        self.assertIsNone(short["series"])

    def test_deterministic_series(self) -> None:
        again = analyze(series_payload(self.candles))
        self.assertEqual(again["series"], self.series)


class TestRegressionLine(unittest.TestCase):
    def test_returns_none_for_short_series(self) -> None:
        self.assertIsNone(regression_line([1.0, 2.0]))

    def test_fits_a_straight_line_exactly(self) -> None:
        line = regression_line([float(index) for index in range(40)])
        assert line is not None
        self.assertAlmostEqual(line["slope"], 1.0, places=9)
        self.assertAlmostEqual(line["intercept"], float(line["startIndex"]), places=6)
        self.assertEqual(line["window"], 40)

    def test_window_is_capped_and_indexed_from_the_end(self) -> None:
        line = regression_line([float(index) for index in range(300)], max_window=90)
        assert line is not None
        self.assertEqual(line["window"], 90)
        self.assertEqual(line["startIndex"], 210)


class TestRequiredCandleCount(unittest.TestCase):
    def test_dominated_by_macd_warm_up(self) -> None:
        required = required_candle_count(DEFAULT_OPTIONS)
        self.assertGreaterEqual(required, DEFAULT_OPTIONS["macdSlow"] + DEFAULT_OPTIONS["macdSignal"])

    def test_long_sma_raises_the_requirement(self) -> None:
        options = {**DEFAULT_OPTIONS, "smaPeriods": [500]}
        self.assertGreater(required_candle_count(options), required_candle_count(DEFAULT_OPTIONS))


if __name__ == "__main__":
    unittest.main()
