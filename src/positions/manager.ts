import type { Position } from '../types/index.js';
import {
  getOpenPositions, updatePositionHighWater, closePosition,
  insertTrade, markTp1Done,
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
      markTp1Done(pos.id);
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

async function fetchCurrentPrice(mint: string): Promise<number | null> {
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
