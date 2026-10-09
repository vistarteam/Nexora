from __future__ import annotations

import unittest

from nexora_analysis.levels import classic_pivots, cluster_levels, detect_levels, find_swings
from nexora_analysis.trend import classify_trend, linear_regression_slope

from .helpers import make_candles


class TestSwings(unittest.TestCase):
    def test_detects_a_single_peak(self) -> None:
        highs = [1, 2, 3, 4, 5, 4, 3, 2, 1]
        lows = [0, 1, 2, 3, 4, 3, 2, 1, 0]
        swing_highs, swing_lows = find_swings(
            [float(value) for value in highs], [float(value) for value in lows], lookback=2
        )
        self.assertIn((4, 5.0), swing_highs)

    def test_clusters_nearby_prices(self) -> None:
        clusters = cluster_levels([(0, 100.0), (5, 100.4), (9, 140.0)], tolerance=1.0, kind="swing")
        self.assertEqual(len(clusters), 2)
        self.assertEqual(clusters[0]["touches"], 2)
        self.assertAlmostEqual(clusters[0]["price"], 100.2)

    def test_returns_none_when_data_is_too_short(self) -> None:
        candles = make_candles(6)
        result = detect_levels(
            [c["high"] for c in candles], [c["low"] for c in candles], [c["close"] for c in candles]
        )
        self.assertIsNone(result)

    def test_levels_bracket_the_last_price(self) -> None:
        candles = make_candles(300, amplitude=3.0)
        highs = [c["high"] for c in candles]
        lows = [c["low"] for c in candles]
        closes = [c["close"] for c in candles]
        result = detect_levels(highs, lows, closes, lookback=5, max_levels=5)
        self.assertIsNotNone(result)
        assert result is not None
        last_price = closes[-1]
        for support in result["supports"]:
            self.assertLess(support["price"], last_price)
        for resistance in result["resistances"]:
            self.assertGreater(resistance["price"], last_price)

    def test_classic_pivots_have_expected_labels(self) -> None:
        candles = make_candles(30)
        pivots = classic_pivots(
            [c["high"] for c in candles], [c["low"] for c in candles], [c["close"] for c in candles]
        )
        labels = {pivot["label"] for pivot in pivots}
        self.assertEqual(labels, {"P", "R1", "R2", "R3", "S1", "S2", "S3"})


class TestTrend(unittest.TestCase):
    def test_linear_regression_slope_on_a_line(self) -> None:
        self.assertAlmostEqual(linear_regression_slope([0, 1, 2, 3, 4]), 1.0)

    def test_flat_series_is_sideways(self) -> None:
        candles = make_candles(200, drift=0.0, amplitude=0.0)
        result = classify_trend(
            [c["high"] for c in candles], [c["low"] for c in candles], [c["close"] for c in candles]
        )
        self.assertEqual(result["direction"], "sideways")

    def test_steadily_rising_series_is_uptrend(self) -> None:
        candles = make_candles(200, drift=0.004, amplitude=0.0)
        result = classify_trend(
            [c["high"] for c in candles], [c["low"] for c in candles], [c["close"] for c in candles]
        )
        self.assertEqual(result["direction"], "uptrend")
        self.assertIsNotNone(result["strength"])
        assert result["strength"] is not None
        self.assertGreater(result["strength"], 0.0)

    def test_steadily_falling_series_is_downtrend(self) -> None:
        candles = make_candles(200, drift=-0.004, amplitude=0.0)
        result = classify_trend(
            [c["high"] for c in candles], [c["low"] for c in candles], [c["close"] for c in candles]
        )
        self.assertEqual(result["direction"], "downtrend")

    def test_too_little_data_reports_unknown(self) -> None:
        result = classify_trend([1.0, 2.0], [0.5, 1.5], [1.0, 2.0])
        self.assertEqual(result["direction"], "unknown")
        self.assertIsNone(result["strength"])


if __name__ == "__main__":
    unittest.main()
