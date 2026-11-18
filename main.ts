// btc-race-bot-24h-1118 — dip-bounce mean-reversion bot for
// make.fun competition btc-race-24h-20261118-1444.
//
// Trades cbBTC (CBBTC) against USDC on 1-minute on-chain bars, long only,
// starting from 1,000 paper USDC. Speaks agent-fun/bars-replay/v1 through
// the kit shim in vendor/makefun-bars.ts. Standard library only, no network,
// no wall clock, no randomness: the same bars always give the same orders.
//
// Idea: BTC mean-reverts on the minute scale. When the close dips a good way
// below its recent average while the medium-term trend is still up, buy the
// dip full size and let the bounce pay the round trip (about 26 bps in fees,
// slippage and pool impact) plus a profit. A tight stop caps the losers.
// A full-size round trip has to catch a move bigger than its cost, so the
// entry demands a real dip and the exit demands a real bounce, not a drift
// back to the mean.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters (all in basis points unless noted) ---
const MEAN_BARS = 30; // window for the dip reference average
const DIP_BPS = 25; // entry: close this far below the 30-bar mean
const FAST_SPAN = 12; // fast EMA span (bars)
const SLOW_SPAN = 60; // slow EMA span (bars)
const TAKE_PROFIT_BPS = 120; // exit: position worth this much over its cost
const STOP_LOSS_BPS = 200; // exit: position worth this much under its cost
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on
const FALLBACK_BAR = 1200; // from this batch, the guardrail fallback may fire
const LAST_ENTRY_BAR = 1380; // no new entries at or after this batch
const FALLBACK_MAX = 2; // at most this many fallback entries
const ARM_BPS = 40; // trailing exit arms once the peak is this far over cost
const TRAIL_BPS = 30; // trailing exit: sell when value falls this far below its peak
const HARD_TP_BPS = 200; // hard take-profit: sell at this much over cost regardless
const BPS = 10000n;

/** One exponential moving average, seeded with the mean of its first span of closes. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

function emaStep(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) {
    e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
  }
}

// --- per-run state (rebuilt from the bars of this run only) ---
const closes: number[] = [];
const fast: Ema = { span: FAST_SPAN, warm: [], value: null };
const slow: Ema = { span: SLOW_SPAN, warm: [], value: null };
let filledBuys = 0;
let fallbackEntries = 0;
/** Best position value seen since the current entry (bigint quote units). */
let peakValue: bigint | null = null;

await runBars({
  onBatch(state: BarsState, batch) {
    // Fold in this batch's fills first: they tell us what actually traded.
    for (const f of batch.fills) {
      if (f.status === 'filled' && f.side === 'buy' && f.symbol === SYMBOL) filledBuys++;
    }

    // Fold in the fresh bar and update the indicators.
    let close: number | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      close = Number(bar.c);
      closes.push(close);
      emaStep(fast, close);
      emaStep(slow, close);
    }
    if (state.warmingUp || close === null) return [];

    const held = state.positions.get(SYMBOL);

    // --- exits: stop-loss, hard take-profit, or a trailing exit that ---
    // --- locks in a bounce once it has run ARM_BPS over cost and ---
    // --- then gives back TRAIL_BPS from its peak. ---
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      if (peakValue === null || value > peakValue) peakValue = value;
      const sl = (held.cost * (BPS - BigInt(STOP_LOSS_BPS))) / BPS;
      const tp = (held.cost * (BPS + BigInt(TAKE_PROFIT_BPS))) / BPS;
      const hardTp = (held.cost * (BPS + BigInt(HARD_TP_BPS))) / BPS;
      const armed = peakValue * BPS >= held.cost * (BPS + BigInt(ARM_BPS));
      const trailed = value * BPS <= peakValue * (BPS - BigInt(TRAIL_BPS));
      if (value >= tp || value <= sl || value >= hardTp || (armed && trailed)) {
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }
    peakValue = null;

    // --- entries ---
    if (batch.seq >= LAST_ENTRY_BAR) return [];
    if (closes.length < MEAN_BARS || fast.value === null || slow.value === null) return [];

    const mean = closes.slice(-MEAN_BARS).reduce((a, x) => a + x, 0) / MEAN_BARS;
    const dipped = close <= mean * (1 - DIP_BPS / 10000);
    if (!dipped) return [];

    const trendUp = fast.value > slow.value;
    const fallback =
      batch.seq >= FALLBACK_BAR && filledBuys === 0 && fallbackEntries < FALLBACK_MAX;
    if (!trendUp && !fallback) return [];

    // Full size on a trend dip; half size on a guardrail fallback entry.
    let spend = state.cash;
    if (fallback) {
      spend = state.cash / 2n;
      fallbackEntries++;
    }
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    if (spend < minNotional) return [];
    const buy: BuyInput = {
      side: 'buy',
      symbol: SYMBOL,
      notional_quote_units: spend,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    };
    return [buy];
  },
});
