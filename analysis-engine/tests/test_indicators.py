from __future__ import annotations

import unittest

from nexora_analysis.indicators import atr, ema, macd, percent_change, rsi, sma, stdev


class TestSma(unittest.TestCase):
    def test_matches_hand_computed_values(self) -> None:
        result = sma([1, 2, 3, 4, 5], 3)
        self.assertEqual(result, [None, None, 2.0, 3.0, 4.0])

    def test_warm_up_region_is_none(self) -> None:
        self.assertEqual(sma([1, 2], 5), [None, None])

    def test_rejects_non_positive_period(self) -> None:
        with self.assertRaises(ValueError):
            sma([1, 2, 3], 0)


class TestEma(unittest.TestCase):
    def test_seeds_with_sma_then_smooths(self) -> None:
        result = ema([1, 2, 3, 4, 5], 3)
        # seed = mean(1,2,3) = 2 ; multiplier = 0.5
        # index 3: (4 - 2)*0.5 + 2 = 3 ; index 4: (5 - 3)*0.5 + 3 = 4
        self.assertEqual(result[:2], [None, None])
        self.assertAlmostEqual(result[2], 2.0)
        self.assertAlmostEqual(result[3], 3.0)
        self.assertAlmostEqual(result[4], 4.0)

    def test_constant_series_is_constant(self) -> None:
        result = ema([7.0] * 10, 4)
        for value in result[3:]:
            self.assertAlmostEqual(value, 7.0)


class TestRsi(unittest.TestCase):
    def test_monotonic_increase_is_100(self) -> None:
        closes = [float(index) for index in range(1, 40)]
        result = rsi(closes, 14)
        self.assertIsNone(result[13])
        self.assertAlmostEqual(result[-1], 100.0)

    def test_monotonic_decrease_is_zero(self) -> None:
        closes = [float(index) for index in range(60, 20, -1)]
        result = rsi(closes, 14)
        self.assertAlmostEqual(result[-1], 0.0)

    def test_stays_within_bounds(self) -> None:
        closes = [100 + (index % 7) * 1.5 - (index % 3) * 2 for index in range(120)]
        result = rsi([float(value) for value in closes], 14)
        for value in result:
            if value is not None:
                self.assertGreaterEqual(value, 0.0)
                self.assertLessEqual(value, 100.0)

    def test_insufficient_data_returns_all_none(self) -> None:
        self.assertEqual(rsi([1.0, 2.0, 3.0], 14), [None, None, None])


class TestMacd(unittest.TestCase):
    def test_constant_series_has_zero_macd(self) -> None:
        macd_line, signal, histogram = macd([50.0] * 80)
        self.assertAlmostEqual(macd_line[-1], 0.0)
        self.assertAlmostEqual(signal[-1], 0.0)
        self.assertAlmostEqual(histogram[-1], 0.0)

    def test_alignment_lengths_match_input(self) -> None:
        closes = [float(index) for index in range(1, 101)]
        macd_line, signal, histogram = macd(closes)
        self.assertEqual(len(macd_line), len(closes))
        self.assertEqual(len(signal), len(closes))
        self.assertEqual(len(histogram), len(closes))

    def test_histogram_equals_macd_minus_signal(self) -> None:
        closes = [100 + (index**0.5) * 3 for index in range(120)]
        macd_line, signal, histogram = macd([float(value) for value in closes])
        self.assertIsNotNone(histogram[-1])
        self.assertAlmostEqual(histogram[-1], macd_line[-1] - signal[-1], places=9)

    def test_rejects_fast_slower_than_slow(self) -> None:
        with self.assertRaises(ValueError):
            macd([1.0] * 50, fast_period=30, slow_period=10)


class TestAtr(unittest.TestCase):
    def test_constant_range(self) -> None:
        highs = [10.0] * 30
        lows = [9.0] * 30
        closes = [9.5] * 30
        result = atr(highs, lows, closes, 14)
        self.assertIsNone(result[13])
        self.assertAlmostEqual(result[-1], 1.0, places=6)

    def test_length_mismatch_raises(self) -> None:
        with self.assertRaises(ValueError):
            atr([1.0, 2.0], [1.0], [1.0, 2.0])


class TestHelpers(unittest.TestCase):
    def test_stdev_of_identical_values_is_zero(self) -> None:
        self.assertAlmostEqual(stdev([5.0, 5.0, 5.0]), 0.0)

    def test_stdev_needs_two_samples(self) -> None:
        self.assertIsNone(stdev([1.0]))

    def test_percent_change(self) -> None:
        self.assertAlmostEqual(percent_change(100, 110), 10.0)
        self.assertAlmostEqual(percent_change(100, 90), -10.0)
        self.assertIsNone(percent_change(0, 10))


if __name__ == "__main__":
    unittest.main()
