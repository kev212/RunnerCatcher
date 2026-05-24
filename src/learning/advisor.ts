import { getDb } from '../db/connection.js';
import { setting, setSetting } from '../db/connection.js';
import { sendMessage } from '../notify/telegram.js';

interface PatternStat {
  category: string;
  value: string;
  wins: number;
  losses: number;
  totalPnlSol: number;
}

interface LearnedRule {
  label: string;
  winRate: number;
  avgPnlSol: number;
  totalTrades: number;
}

interface LessonInput {
  positionId: number;
  mint: string;
  symbol: string;
  llmVerdict: string | null;
  launchpad: string;
  smartDegenCount: number;
  rugRatio: number;
  volume1mUsd: number;
  marketCapUsd: number;
  holderCount: number;
  twitter: string;
  creatorTokenStatus: string;
  exitReason: string;
  pnlPercent: number;
  pnlSol: number;
  closedAtMs: number;
}

const CATEGORIES = [
  { cat: 'launchpad', val: (l: LessonInput) => l.launchpad || 'unknown' },
  { cat: 'rug_ratio', val: (l: LessonInput) => l.rugRatio < 0.1 ? '<0.1' : l.rugRatio < 0.2 ? '0.1-0.2' : '>0.2' },
  { cat: 'smart_degen', val: (l: LessonInput) => l.smartDegenCount === 0 ? '0' : l.smartDegenCount <= 2 ? '1-2' : '3+' },
  { cat: 'volume_range', val: (l: LessonInput) => l.volume1mUsd < 250000 ? '100k-250k' : l.volume1mUsd < 500000 ? '250k-500k' : '500k+' },
  { cat: 'social', val: (l: LessonInput) => l.twitter ? 'has_twitter' : 'no_social' },
  { cat: 'mcap_range', val: (l: LessonInput) => l.marketCapUsd < 500000 ? '100k-500k' : '500k-1m' },
  { cat: 'holder_range', val: (l: LessonInput) => l.holderCount < 500 ? '<500' : l.holderCount < 2000 ? '500-2k' : '2k+' },
];

export function recordLesson(input: LessonInput) {
  const isWin = input.pnlPercent >= 0;
  const db = getDb();

  db.prepare(`
    INSERT INTO lessons (position_id, mint, symbol, llm_verdict, launchpad, smart_degen_count,
      rug_ratio, volume_1m_usd, market_cap_usd, holder_count, twitter, creator_token_status,
      exit_reason, pnl_percent, pnl_sol, is_win, closed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.positionId, input.mint, input.symbol, input.llmVerdict, input.launchpad,
    input.smartDegenCount, input.rugRatio, input.volume1mUsd, input.marketCapUsd,
    input.holderCount, input.twitter, input.creatorTokenStatus,
    input.exitReason, input.pnlPercent, input.pnlSol, isWin ? 1 : 0, input.closedAtMs,
  );

  for (const { cat, val } of CATEGORIES) {
    const value = val(input);
    db.prepare(`
      INSERT INTO pattern_stats (category, value, wins, losses, total_pnl_sol, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(category, value) DO UPDATE SET
        wins = wins + ?, losses = losses + ?, total_pnl_sol = total_pnl_sol + ?, updated_at_ms = ?
    `).run(
      cat, value, isWin ? 1 : 0, isWin ? 0 : 1, input.pnlSol, input.closedAtMs,
      isWin ? 1 : 0, isWin ? 0 : 1, input.pnlSol, input.closedAtMs,
    );
  }

  evaluateAdaptiveThresholds();
}

function getPatternStats(minTrades = 3): PatternStat[] {
  const db = getDb();
  return db.prepare(`
    SELECT category, value, wins, losses, total_pnl_sol
    FROM pattern_stats
    WHERE wins + losses >= ?
    ORDER BY (CAST(wins AS REAL) / (wins + losses)) ASC
  `).all(minTrades) as PatternStat[];
}

function getRules(): LearnedRule[] {
  const stats = getPatternStats(3);
  return stats.map(s => ({
    label: `${s.category}=${s.value}`,
    winRate: s.wins / (s.wins + s.losses) * 100,
    avgPnlSol: (s.wins + s.losses) > 0 ? s.totalPnlSol / (s.wins + s.losses) : 0,
    totalTrades: s.wins + s.losses,
  }));
}

export function buildLearningContext(maxRules = 8): string {
  const rules = getRules();
  if (rules.length === 0) return '';

  const sorted = [...rules].sort((a, b) => a.winRate - b.winRate);
  const worst = sorted.slice(0, 3).filter(r => r.winRate < 40);
  const best = sorted.filter(r => r.winRate >= 60 && r.totalTrades >= 3).slice(0, 3);

  const lines: string[] = [];

  if (best.length > 0) {
    lines.push('── Patterns with HIGH WIN RATE ──');
    for (const r of best) {
      lines.push(`  ✅ ${r.label}: ${r.winRate.toFixed(0)}% win (${r.totalTrades} trades, avg ${r.avgPnlSol >= 0 ? '+' : ''}${r.avgPnlSol.toFixed(2)} SOL)`);
    }
  }

  if (worst.length > 0) {
    lines.push('── Patterns with LOW WIN RATE ──');
    for (const r of worst) {
      lines.push(`  ❌ ${r.label}: ${r.winRate.toFixed(0)}% win (${r.totalTrades} trades, avg ${r.avgPnlSol >= 0 ? '+' : ''}${r.avgPnlSol.toFixed(2)} SOL)`);
    }
  }

  return lines.join('\n');
}

export function getRecentTrades(limit = 3, isWin?: boolean): { symbol: string; launchpad: string; pnlPercent: number; pnlSol: number; exitReason: string; volume1mUsd: number; smartDegenCount: number; rugRatio: number }[] {
  const db = getDb();
  let query = 'SELECT symbol, launchpad, pnl_percent, pnl_sol, exit_reason, volume_1m_usd, smart_degen_count, rug_ratio FROM lessons';
  const params: unknown[] = [];
  if (isWin !== undefined) {
    query += ' WHERE is_win = ?';
    params.push(isWin ? 1 : 0);
  }
  query += ' ORDER BY closed_at_ms DESC LIMIT ?';
  params.push(limit);
  return db.prepare(query).all(...params) as any[];
}

function evaluateAdaptiveThresholds() {
  const worstPatterns = getPatternStats(5).filter(p => {
    const rate = p.wins / (p.wins + p.losses);
    return rate < 0.35;
  });

  for (const p of worstPatterns) {
    applyAutoTighten(p);
  }
}

function applyAutoTighten(pattern: PatternStat) {
  const rate = pattern.wins / (pattern.wins + pattern.losses);
  if (rate >= 0.35) return;

  const key = mapPatternToSetting(pattern.category, pattern.value);
  if (!key) return;

  const currentVal = Number(setting(key.key));
  if (currentVal === 0 || (key.invert && currentVal >= key.target) || (!key.invert && currentVal <= key.target)) return;

  const shouldNotify = setting('adaptive_alerted_' + key.key) !== '1';
  if (!shouldNotify) return;

  setSetting(key.key, String(key.target));
  setSetting('adaptive_alerted_' + key.key, '1');

  const original = setting(key.key + '_original');
  if (!original) {
    setSetting(key.key + '_original', String(currentVal));
  }

  const msg = [
    `🧠 <b>Adaptive threshold adjusted</b>`,
    ``,
    `Pattern: <b>${pattern.category} = ${pattern.value}</b>`,
    `Win rate: <b>${(rate * 100).toFixed(0)}%</b> (${pattern.wins}W / ${pattern.losses}L)`,
    `Avg PnL: <b>${pattern.totalPnlSol >= 0 ? '+' : ''}${pattern.totalPnlSol.toFixed(2)} SOL</b>`,
    ``,
    `Action: <b>${key.key}</b> set from <b>${currentVal}</b> → <b>${key.target}</b>`,
  ].join('\n');

  sendMessage(msg).catch(() => {});
  console.log(`[adaptive] ${key.key}: ${currentVal} → ${key.target} (${(rate * 100).toFixed(0)}% win rate)`);
}

interface SettingAdjustment {
  key: string;
  target: number;
  invert: boolean;
}

function mapPatternToSetting(category: string, value: string): SettingAdjustment | null {
  switch (category) {
    case 'rug_ratio':
      if (value === '0.1-0.2') return { key: 'max_rug_ratio', target: 0.1, invert: false };
      if (value === '>0.2') return { key: 'max_rug_ratio', target: 0.15, invert: false };
      return null;
    case 'smart_degen':
      if (value === '0') return { key: 'min_smart_degen', target: 1, invert: false };
      return null;
    case 'social':
      if (value === 'no_social') return { key: 'min_smart_degen', target: 2, invert: false };
      return null;
    case 'launchpad':
      return { key: 'skip_launchpad_' + value.toLowerCase(), target: 1, invert: true };
    default:
      return null;
  }
}

export function getLearningSummary(): string {
  const db = getDb();
  const totalTrades = (db.prepare('SELECT COUNT(*) as c FROM lessons').get() as any).c;
  const winTrades = (db.prepare('SELECT COUNT(*) as c FROM lessons WHERE is_win = 1').get() as any).c;
  const lossTrades = (db.prepare('SELECT COUNT(*) as c FROM lessons WHERE is_win = 0').get() as any).c;
  const totalPnl = (db.prepare('SELECT COALESCE(SUM(pnl_sol), 0) as s FROM lessons').get() as any).s;
  const winRate = totalTrades > 0 ? (winTrades / totalTrades * 100).toFixed(1) : 'N/A';
  const bestTrade = db.prepare('SELECT symbol, pnl_percent, pnl_sol FROM lessons ORDER BY pnl_sol DESC LIMIT 1').get() as any;
  const worstTrade = db.prepare('SELECT symbol, pnl_percent, pnl_sol FROM lessons ORDER BY pnl_sol ASC LIMIT 1').get() as any;

  const bestLine = bestTrade
    ? `Best trade: <b>$${bestTrade.symbol}</b> ${bestTrade.pnl_percent >= 0 ? '+' : ''}${bestTrade.pnl_percent.toFixed(0)}% (${bestTrade.pnl_sol >= 0 ? '+' : ''}${bestTrade.pnl_sol.toFixed(2)} SOL)`
    : '';
  const worstLine = worstTrade
    ? `Worst trade: <b>$${worstTrade.symbol}</b> ${worstTrade.pnl_percent >= 0 ? '+' : ''}${worstTrade.pnl_percent.toFixed(0)}% (${worstTrade.pnl_sol >= 0 ? '+' : ''}${worstTrade.pnl_sol.toFixed(2)} SOL)`
    : '';

  return [
    `📚 <b>Learning Summary</b>`,
    ``,
    `Total trades: <b>${totalTrades}</b> (${winTrades}W / ${lossTrades}L)`,
    `Win rate: <b>${winRate}%</b>`,
    `Net PnL: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(4)} SOL</b>`,
    bestLine || '',
    worstLine || '',
    ``,
    `Adaptive changes made: ${setting('max_rug_ratio_original') ? 'yes' : 'no'}`,
  ].filter(Boolean).join('\n');
}
