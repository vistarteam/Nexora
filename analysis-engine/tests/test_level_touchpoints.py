from nexora_analysis.levels import detect_levels


def test_detect_levels_emits_timestamped_touchpoints():
    closes = [100, 102, 99, 103, 100, 104, 101, 105, 102, 106, 103, 107, 104, 108, 105]
    highs = [value + 1 for value in closes]
    lows = [value - 1 for value in closes]
    times = [1_700_000_000_000 + i * 60_000 for i in range(len(closes))]
    result = detect_levels(highs, lows, closes, lookback=2, max_levels=10, times=times)
    assert result is not None
    levels = result["supports"] + result["resistances"]
    assert levels
    assert all("touchpoints" in level for level in levels)
    for level in levels:
        for touch in level["touchpoints"]:
            assert touch["time"] in times
            assert touch["type"] in {"support", "resistance"}
            assert 1 <= touch["strength"] <= 5
