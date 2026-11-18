# btc-race-bot-24h-1118

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/sagaevil530/btc-race-bot-24h-1118/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/sagaevil530/btc-race-bot-24h-1118/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A dip-bounce BTC trading bot for the make.fun 24-hour cbBTC race. It trades Coinbase Wrapped BTC against USDC on 1-minute on-chain bars, long only, starting from $1,000 of paper money.

## Strategy

Buy the dip inside an uptrend, then wait for the bounce to pay for itself:

- **Entry:** the 1-minute close dips at least 25 bps below its 30-bar moving average while EMA(12) sits above EMA(60). Full size, one position at a time.
- **Exit:** sell the whole position at +120 bps above its cost, at −200 bps below it, or on a trailing exit: once the position has peaked at least 40 bps over its cost, sell when it gives back 30 bps from that peak. The trailing exit locks in bounces that stall short of the fixed target instead of riding them back down.
- **Why it works:** a full-size round trip costs ~26 bps in fees, slippage and pool impact, so a trade must catch a move bigger than that. Buying 25 bps under the mean and demanding 120 bps from the fill puts the exit well above the mean: the bounce has to continue past the mean, not just revert to it.
- **Risk controls:** the EMA trend filter keeps the bot out of sustained downtrends; the 200 bps stop caps any single loss. If no trade has filled by bar 1200, the trend filter is dropped for at most two half-size entries so the bot still meets the race's minimum-1-trade guardrail, and entries stop after bar 1380 so no fresh position is forced into the end-of-window flatten.

Local grade on the published dev window (1,440 1-minute bars): **+10.91 USDC net PnL, 1 round trip, 0.26% max drawdown** (+10.10 USDC at 2× fees), deterministic across two runs.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (NDJSON on stdin/stdout) via the kit shim in `vendor/makefun-bars.ts`. Standard library only, no network, no wall clock, deterministic: two runs produce byte-identical action logs.

---

<sub>Entered on [make.fun](https://make.fun/?ref=5gnbx9zn&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
