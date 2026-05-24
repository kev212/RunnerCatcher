import { getDb } from './connection.js';
import type { Candidate, Position } from '../types/index.js';

// Map SQLite snake_case rows to camelCase Position objects
function mapPosition(row: Record<string, unknown>): Position {
  return {
    id: Number(row.id),
    candidateId: Number(row.candidate_id),
    mint: String(row.mint),
    symbol: String(row.symbol || ''),
    name: String(row.name || ''),
    entryPriceUsd: Number(row.entry_price_usd || 0),
    entryMcapUsd: Number(row.entry_mcap_usd || 0),
    sizeSol: Number(row.size_sol || 0),
    tokenAmount: String(row.token_amount || '0'),
    executionMode: String(row.execution_mode || ''),
    status: String(row.status || ''),
    tp1Hit: Number(row.tp1_hit || 0),
    tp1Done: Number(row.tp1_done || 0),
    tp2Hit: Number(row.tp2_hit || 0),
    tp2Done: Number(row.tp2_done || 0),
    slHit: Number(row.sl_hit || 0),
    highWaterPrice: Number(row.high_water_price || 0),
    highWaterMcap: Number(row.high_water_mcap || 0),
    trailingArmed: Number(row.trailing_armed || 0),
    openedAtMs: Number(row.opened_at_ms || 0),
    closedAtMs: row.closed_at_ms ? Number(row.closed_at_ms) : null,
    exitReason: row.exit_reason ? String(row.exit_reason) : null,
    exitPriceUsd: row.exit_price_usd ? Number(row.exit_price_usd) : null,
    exitMcapUsd: row.exit_mcap_usd ? Number(row.exit_mcap_usd) : null,
    pnlPercent: row.pnl_percent ? Number(row.pnl_percent) : null,
    pnlSol: row.pnl_sol ? Number(row.pnl_sol) : null,
    buySignature: row.buy_signature ? String(row.buy_signature) : null,
    sellSignature: row.sell_signature ? String(row.sell_signature) : null,
    strategyId: String(row.strategy_id || 'runner'),
    tp1Percent: Number(row.tp1_percent || 100),
    tp1SellPercent: Number(row.tp1_sell_percent || 50),
    tp2Percent: Number(row.tp2_percent || 150),
    tp2SellPercent: Number(row.tp2_sell_percent || 50),
    trailingPercent: Number(row.trailing_percent || 30),
    slPercent: Number(row.sl_percent || -50),
    maxHoldMinutes: Number(row.max_hold_minutes || 60),
  };
}

export function insertCandidate(c: Candidate): number {
  const db = getDb();
  const res = db.prepare(`
    INSERT INTO candidates (
      mint, symbol, name, launchpad, age_sec, market_cap_usd, volume_1m_usd,
      total_fee_sol, holder_count, smart_degen_count, rug_ratio, is_wash_trading,
      creator_token_status, liquidity, hot_level, price_usd, created_at_ms,
      scanned_at_ms, gates_passed, gates_detail, llm_verdict, llm_confidence,
      llm_reason, status, raw_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.mint, c.symbol, c.name, c.launchpad, c.ageSec, c.marketCapUsd, c.volume1mUsd,
    c.totalFeeSol, c.holderCount, c.smartDegenCount, c.rugRatio, c.isWashTrading ? 1 : 0,
    c.creatorTokenStatus, c.liquidity, c.hotLevel, c.priceUsd, c.createdAtMs,
    c.scannedAtMs, c.gatesPassed ? 1 : 0, JSON.stringify(c.gatesDetail),
    c.llmVerdict || null, c.llmConfidence || null, c.llmReason || null,
    c.status, JSON.stringify(c.rawTrending)
  );
  return Number(res.lastInsertRowid);
}

export function updateCandidateLlm(id: number, verdict: string, confidence: number, reason: string) {
  getDb().prepare(`
    UPDATE candidates SET llm_verdict = ?, llm_confidence = ?, llm_reason = ?, status = ? WHERE id = ?
  `).run(verdict, confidence, reason, verdict.toLowerCase(), id);
}

export function updateCandidateStatus(id: number, status: string) {
  getDb().prepare('UPDATE candidates SET status = ? WHERE id = ?').run(status, id);
}

export function insertPosition(p: {
  candidateId: number; mint: string; symbol: string; name: string;
  entryPriceUsd: number; entryMcapUsd: number; sizeSol: number;
  tokenAmount: string; executionMode: string;
  tp1Percent: number; tp1SellPercent: number; tp2Percent: number;
  tp2SellPercent: number; trailingPercent: number; slPercent: number;
  maxHoldMinutes: number; openedAtMs: number;
}): number {
  const db = getDb();
  const res = db.prepare(`
    INSERT INTO positions (
      candidate_id, mint, symbol, name, entry_price_usd, entry_mcap_usd, size_sol,
      token_amount, execution_mode, high_water_price, high_water_mcap, opened_at_ms,
      tp1_percent, tp1_sell_percent, tp2_percent, tp2_sell_percent,
      trailing_percent, sl_percent, max_hold_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.candidateId, p.mint, p.symbol, p.name, p.entryPriceUsd, p.entryMcapUsd, p.sizeSol,
    p.tokenAmount, p.executionMode, p.entryPriceUsd, p.entryMcapUsd, p.openedAtMs,
    p.tp1Percent, p.tp1SellPercent, p.tp2Percent, p.tp2SellPercent,
    p.trailingPercent, p.slPercent, p.maxHoldMinutes,
  );
  return Number(res.lastInsertRowid);
}

export function getOpenPositions(): Position[] {
  const rows = getDb().prepare(
    'SELECT * FROM positions WHERE status = ? ORDER BY opened_at_ms DESC',
  ).all('open') as Record<string, unknown>[];
  return rows.map(mapPosition);
}

export function updatePositionHighWater(id: number, price: number, mcap: number, armed: number) {
  getDb().prepare(`
    UPDATE positions SET high_water_price = ?, high_water_mcap = ?, trailing_armed = ? WHERE id = ?
  `).run(price, mcap, armed, id);
}

export function closePosition(id: number, exitReason: string, exitPrice: number, exitMcap: number, pnlPercent: number, pnlSol: number, signature: string | null) {
  getDb().prepare(`
    UPDATE positions SET status = 'closed', closed_at_ms = ?, exit_reason = ?,
      exit_price_usd = ?, exit_mcap_usd = ?, pnl_percent = ?, pnl_sol = ?, sell_signature = ?
    WHERE id = ?
  `).run(Date.now(), exitReason, exitPrice, exitMcap, pnlPercent, pnlSol, signature, id);
}

export function markTp1Done(id: number) {
  getDb().prepare('UPDATE positions SET tp1_done = 1 WHERE id = ?').run(id);
}

export function insertTrade(t: {
  positionId: number; mint: string; side: string; atMs: number;
  priceUsd?: number; mcapUsd?: number; sizeSol?: number;
  tokenAmount?: string; reason?: string; signature?: string;
}) {
  getDb().prepare(`
    INSERT INTO trades (position_id, mint, side, at_ms, price_usd, mcap_usd, size_sol, token_amount, reason, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(t.positionId, t.mint, t.side, t.atMs, t.priceUsd || null, t.mcapUsd || null, t.sizeSol || null, t.tokenAmount || null, t.reason || null, t.signature || null);
}

export function seenMint(mint: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM candidates WHERE mint = ? LIMIT 1').get(mint);
  return !!row;
}

export { setting, setSetting } from './connection.js';
