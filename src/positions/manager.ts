import type { Position } from '../types/index.js';
import {
  getOpenPositions, updatePositionHighWater, closePosition,
  insertTrade, markTp1Done, markTp2Done,
} from '../db/queries.js';
import { POSITION_CHECK_MS, TRADING_MODE } from '../config.js';
import { executeSell } from '../executor/buy.js';
import { recordLesson } from '../learning/advisor.js';
import { getDb } from '../db/connection.js';

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startPositionMonitor(onSell: (pos: Position, reason: string, pnlPercent: number, pnlSol: number, signature: string | null) => void) {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    try {
      const positions = getOpenPositions();
      if (positions.length === 0) return;

      for (const pos of positions) {
        await evaluatePosition(pos, onSell);
      }
    } catch (err) {
      console.error(`[positions] monitor error: ${(err as Error).message}`);
    }
  }, POSITION_CHECK_MS);

  console.log(`[positions] monitor started (every ${POSITION_CHECK_MS}ms)`);
}

export function stopPositionMonitor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function evaluatePosition(
  pos: Position,
  onSell: (pos: Position, reason: string, pnlPercent: number, pnlSol: number, signature: string | null) => void,
) {
  if (TRADING_MODE === 'dry_run') {
    // Dry run: still track price for PnL estimation, but skip real execution
    try {
      const price = await fetchCurrentPrice(pos.mint);
      if (!price) {
        // No price data — just check max hold
        const now = Date.now();
        const maxHoldMs = pos.maxHoldMinutes * 60 * 1000;
        if (now - pos.openedAtMs >= maxHoldMs) {
          const pnl = 0;
          closePosition(pos.id, 'MAX_HOLD', pos.entryPriceUsd, pos.entryMcapUsd, pnl, 0, null);
          insertTrade({ positionId: pos.id, mint: pos.mint, side: 'sell', atMs: now, reason: 'MAX_HOLD', priceUsd: pos.entryPriceUsd });
          recordLessonFromPos(pos, 'MAX_HOLD', pnl, 0);
          onSell(pos, 'MAX_HOLD', pnl, 0, null);
        }
        return;
      }

      const currentMcap = pos.entryMcapUsd > 0
        ? (price / pos.entryPriceUsd) * pos.entryMcapUsd
        : pos.entryMcapUsd;
      const pnlPercent = pos.entryPriceUsd > 0
        ? ((price / pos.entryPriceUsd) - 1) * 100
        : 0;
      const pnlSol = (pnlPercent / 100) * pos.sizeSol;
      const highWaterPrice = Math.max(pos.highWaterPrice || 0, price);
      const highWaterMcap = Math.max(pos.highWaterMcap || 0, currentMcap);
      const maxHoldMs = pos.maxHoldMinutes * 60 * 1000;
      const now = Date.now();

      // TP2
      if (pos.tp1Done && pnlPercent >= pos.tp2Percent && !pos.tp2Done) {
        closePosition(pos.id, 'TP2', price, currentMcap, pnlPercent, pnlSol, null);
        insertTrade({ positionId: pos.id, mint: pos.mint, side: 'sell', atMs: now, reason: 'TP2', priceUsd: price });
        markTp2Done(pos.id);
        recordLessonFromPos(pos, 'TP2', pnlPercent, pnlSol);
        onSell(pos, 'TP2', pnlPercent, pnlSol, null);
        return;
      }
      // TP1
      if (!pos.tp1Done && pnlPercent >= pos.tp1Percent) {
        insertTrade({ positionId: pos.id, mint: pos.mint, side: 'sell', atMs: now, reason: 'TP1_PARTIAL', priceUsd: price });
        markTp1Done(pos.id);
        console.log(`[dry] TP1 hit: $${pos.symbol} +${pnlPercent.toFixed(1)}%`);
      }
      // Trailing
      const trailingArmed = pos.tp1Done ? 1 : 0;
      if (trailingArmed && highWaterPrice > 0) {
        const trailDrop = (price / highWaterPrice - 1) * 100;
        if (trailDrop <= -Math.abs(pos.trailingPercent)) {
          closePosition(pos.id, 'TRAILING_TP', price, currentMcap, pnlPercent, pnlSol, null);
          insertTrade({ positionId: pos.id, mint: pos.mint, side: 'sell', atMs: now, reason: 'TRAILING_TP', priceUsd: price });
          recordLessonFromPos(pos, 'TRAILING_TP', pnlPercent, pnlSol);
          onSell(pos, 'TRAILING_TP', pnlPercent, pnlSol, null);
          return;
        }
      }
      // SL
      if (pnlPercent <= pos.slPercent) {
        closePosition(pos.id, 'SL', price, currentMcap, pnlPercent, pnlSol, null);
        insertTrade({ positionId: pos.id, mint: pos.mint, side: 'sell', atMs: now, reason: 'SL', priceUsd: price });
        recordLessonFromPos(pos, 'SL', pnlPercent, pnlSol);
        onSell(pos, 'SL', pnlPercent, pnlSol, null);
        return;
      }
      // Max hold
      if (now - pos.openedAtMs >= maxHoldMs) {
        closePosition(pos.id, 'MAX_HOLD', price, currentMcap, pnlPercent, pnlSol, null);
        insertTrade({ positionId: pos.id, mint: pos.mint, side: 'sell', atMs: now, reason: 'MAX_HOLD', priceUsd: price });
        recordLessonFromPos(pos, 'MAX_HOLD', pnlPercent, pnlSol);
        onSell(pos, 'MAX_HOLD', pnlPercent, pnlSol, null);
        return;
      }
      // Update high water
      updatePositionHighWater(pos.id, highWaterPrice, highWaterMcap, trailingArmed);
    } catch (err) {
      console.error(`[dry-pos] eval ${pos.id}: ${(err as Error).message}`);
    }
    return;
  }

  try {
    const price = await fetchCurrentPrice(pos.mint);
    if (!price) return;

    const currentMcap = pos.entryMcapUsd > 0
      ? (price / pos.entryPriceUsd) * pos.entryMcapUsd
      : pos.entryMcapUsd;

    const pnlPercent = pos.entryPriceUsd > 0
      ? ((price / pos.entryPriceUsd) - 1) * 100
      : 0;
    const pnlSol = (pnlPercent / 100) * pos.sizeSol;

    const highWaterPrice = Math.max(pos.highWaterPrice || 0, price);
    const highWaterMcap = Math.max(pos.highWaterMcap || 0, currentMcap);

    let trailingArmed = pos.trailingArmed;
    const tp1Pct = pos.tp1Percent;
    const tp2Pct = pos.tp2Percent;
    const slPct = pos.slPercent;
    const trailingPct = pos.trailingPercent;
    const maxHoldMs = pos.maxHoldMinutes * 60 * 1000;

    // TP2: +150% (2.5x) → sell remaining 50%
    if (pos.tp1Done && pnlPercent >= tp2Pct && !pos.tp2Done) {
      await doSell(pos, 'TP2', pnlPercent, pnlSol);
      markTp2Done(pos.id);
      return;
    }

    // TP1: +100% (2x) → sell 50%
    if (!pos.tp1Done && pnlPercent >= tp1Pct) {
      await doSell(pos, 'TP1_PARTIAL', pnlPercent, pnlSol);
      markTp1Done(pos.id);
      trailingArmed = 1;
    }

    // Arm trailing on TP1
    if (pos.tp1Done && !trailingArmed && pnlPercent >= tp1Pct) {
      trailingArmed = 1;
    }

    // Trailing stop check
    if (trailingArmed && highWaterPrice > 0) {
      const trailDrop = (price / highWaterPrice - 1) * 100;
      if (trailDrop <= -Math.abs(trailingPct)) {
        await doSell(pos, 'TRAILING_TP', pnlPercent, pnlSol);
        updatePositionHighWater(pos.id, highWaterPrice, highWaterMcap, trailingArmed);
        return;
      }
    }

    // SL
    if (pnlPercent <= slPct) {
      await doSell(pos, 'SL', pnlPercent, pnlSol);
      updatePositionHighWater(pos.id, highWaterPrice, highWaterMcap, trailingArmed);
      return;
    }

    // Max hold
    const now = Date.now();
    if (now - pos.openedAtMs >= maxHoldMs) {
      await doSell(pos, 'MAX_HOLD', pnlPercent, pnlSol);
      updatePositionHighWater(pos.id, highWaterPrice, highWaterMcap, trailingArmed);
      return;
    }

    // Update high water mark
    updatePositionHighWater(pos.id, highWaterPrice, highWaterMcap, trailingArmed);
  } catch (err) {
    console.error(`[position] eval ${pos.id}: ${(err as Error).message}`);
  }
}

async function doSell(pos: Position, reason: string, pnlPercent: number, pnlSol: number) {
  const result = await executeSell(pos.mint, pos.tokenAmount, reason);
  closePosition(pos.id, reason, pos.entryPriceUsd, pos.entryMcapUsd, pnlPercent, pnlSol, result.signature || null);
  insertTrade({
    positionId: pos.id, mint: pos.mint, side: 'sell', atMs: Date.now(),
    priceUsd: pos.entryPriceUsd, mcapUsd: pos.entryMcapUsd,
    sizeSol: pos.sizeSol, tokenAmount: pos.tokenAmount,
    reason, signature: result.signature,
  });
  recordLessonFromPos(pos, reason, pnlPercent, pnlSol);
}

function recordLessonFromPos(pos: Position, reason: string, pnlPercent: number, pnlSol: number) {
  const db = getDb();
  const candidate = db.prepare('SELECT * FROM candidates WHERE mint = ? ORDER BY scanned_at_ms DESC LIMIT 1').get(pos.mint) as any;
  if (!candidate) return;

  recordLesson({
    positionId: pos.id,
    mint: pos.mint,
    symbol: pos.symbol,
    llmVerdict: candidate.llm_verdict,
    launchpad: candidate.launchpad || '',
    smartDegenCount: candidate.smart_degen_count || 0,
    rugRatio: candidate.rug_ratio || 0,
    volume1mUsd: candidate.volume_1m_usd || 0,
    marketCapUsd: candidate.market_cap_usd || 0,
    holderCount: candidate.holder_count || 0,
    twitter: String(candidate.raw_data ? JSON.parse(candidate.raw_data)?.twitter_username || '' : ''),
    creatorTokenStatus: candidate.creator_token_status || '',
    exitReason: reason,
    pnlPercent,
    pnlSol,
    closedAtMs: Date.now(),
  });
}

export async function fetchCurrentPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as any;
    const price = Number(data?.data?.[mint]?.price || data?.[mint]?.usdPrice);
    if (Number.isFinite(price) && price > 0) return price;
  } catch {}

  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as any;
    const pair = data?.pairs?.[0];
    if (pair) return Number(pair.priceUsd);
  } catch {}

  return null;
}
