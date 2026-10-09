from __future__ import annotations

import unittest

from nexora_analysis import EngineInputError, analyze, decode_candles, required_candle_count
from nexora_analysis.engine import DEFAULT_OPTIONS

from .helpers import make_candles


def payload(candles: list[dict]) -> dict:
    return {"symbol": "BINANCE:BTCUSDT", "timeframe": "1h", "candles": candles}


class TestDecodeCandles(unittest.TestCase):
    def test_rejects_non_list(self) -> None:
        with self.assertRaises(EngineInputError):
            decode_candles({"not": "a list"})

    def test_skips_malformed_entries_and_warns(self) -> None:
        raw = [
            {"time": 1, "open": 1, "high": 2, "low": 0.5, "close": 1.5},
            {"time": 2, "open": "bad", "high": 2, "low": 1, "close": 1.5},
            "junk",
            {"time": 3, "open": 1.5, "high": 2, "low": 1, "close": 1.8},
        ]
        candles, warnings = decode_candles(raw)
        self.assertEqual(len(candles), 2)
        self.assertTrue(any("نادیده" in warning for warning in warnings))

    def test_drops_duplicate_timestamps(self) -> None:
        raw = [
            {"time": 1, "open": 1, "high": 2, "low": 0.5, "close": 1.5},
            {"time": 1, "open": 1, "high": 3, "low": 0.5, "close": 2.5},
        ]
        candles, warnings = decode_candles(raw)
        self.assertEqual(len(candles), 1)
        self.assertEqual(candles[0]["close"], 2.5)
        self.assertTrue(any("تکراری" in warning for warning in warnings))

    def test_repairs_inverted_high_low(self) -> None:
        raw = [{"time": 1, "open": 5, "high": 2, "low": 9, "close": 6}]
        candles, _ = decode_candles(raw)
        self.assertGreaterEqual(candles[0]["high"], candles[0]["low"])

    def test_sorts_by_time_ascending(self) -> None:
        raw = [
            {"time": 3, "open": 1, "high": 2, "low": 1, "close": 1.5},
            {"time": 1, "open": 1, "high": 2, "low": 1, "close": 1.5},
        ]
        candles, _ = decode_candles(raw)
        self.assertEqual([candle["time"] for candle in candles], [1.0, 3.0])


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


class TestRequiredCandleCount(unittest.TestCase):
    def test_dominated_by_macd_warm_up(self) -> None:
        required = required_candle_count(DEFAULT_OPTIONS)
        self.assertGreaterEqual(required, DEFAULT_OPTIONS["macdSlow"] + DEFAULT_OPTIONS["macdSignal"])

    def test_long_sma_raises_the_requirement(self) -> None:
        options = {**DEFAULT_OPTIONS, "smaPeriods": [500]}
        self.assertGreater(required_candle_count(options), required_candle_count(DEFAULT_OPTIONS))


if __name__ == "__main__":
    unittest.main()
