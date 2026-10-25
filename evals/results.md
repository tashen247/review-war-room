# Eval results (live agent: lead claude-sonnet-5-5, subagents claude-haiku-5-5)

Generated 2026-10-25T18:36:55.494Z · 3 repeats per scenario, fresh database each repeat.

**4 of 4 scenarios passed on all 3 repeats (12/12 runs), average $0.14 per investigation.**

| Scenario | Pass rate | Average cost per repeat |
|---|---|---|
| android-login-v420 | 3/3 | $0.264 |
| ios-crash-v391 | 3/3 | $0.158 |
| pricing-backlash | 3/3 | $0.129 |
| quiet-week | 3/3 | $0.127 |

The login scenario's cost per repeat covers two investigations (days 1–24, then the rest), and its row shows the second run.

## Every run

| Scenario | Repeat | Pass | Verdict | Confidence | Bugs | Pending replies | Cost | Lead turns | Notes |
|---|---|---|---|---|---|---|---|---|---|
| android-login-v420 | 1 | ✅ | 4.2.0 android | 0.95 (base 0.95) | 0 | 5 | $0.312 | 12 | run 1 4.2.0@0.95, bugs across both runs: 1 |
| android-login-v420 | 2 | ✅ | 4.2.0 android | 0.95 (base 0.95) | 0 | 5 | $0.239 | 12 | run 1 4.2.0@0.95, bugs across both runs: 1 |
| android-login-v420 | 3 | ✅ | 4.2.0 android | 0.95 (base 0.95) | 0 | 5 | $0.242 | 9 | run 1 4.2.0@0.95, bugs across both runs: 1 |
| ios-crash-v391 | 1 | ✅ | 3.9.1 ios | 0.95 (base 0.95) | 1 | 5 | $0.153 | 2 |  |
| ios-crash-v391 | 2 | ✅ | 3.9.1 ios | 0.95 (base 0.95) | 1 | 5 | $0.170 | 9 |  |
| ios-crash-v391 | 3 | ✅ | 3.9.1 ios | 0.95 (base 0.95) | 1 | 5 | $0.151 | 9 |  |
| pricing-backlash | 1 | ✅ | 5.0.0 both | 0.94 (base 0.94) | 0 | 5 | $0.125 | 8 |  |
| pricing-backlash | 2 | ✅ | 5.0.0 both | 0.94 (base 0.94) | 0 | 5 | $0.123 | 7 |  |
| pricing-backlash | 3 | ✅ | 5.0.0 both | 0.94 (base 0.94) | 0 | 5 | $0.140 | 8 |  |
| quiet-week | 1 | ✅ | none | 0.78 (base 0.78) | 0 | 0 | $0.123 | 7 |  |
| quiet-week | 2 | ✅ | none | 0.78 (base 0.78) | 0 | 0 | $0.119 | 7 |  |
| quiet-week | 3 | ✅ | none | 0.78 (base 0.78) | 0 | 0 | $0.138 | 6 |  |
