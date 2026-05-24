import { validateConfig, POLL_INTERVAL_MS, TRADING_MODE, BUY_AMOUNT_SOL } from './config.js';
import { getDb, setting, setSetting } from './db/connection.js';
import { insertCandidate, insertPosition, updateCandidateStatus } from './db/queries.js';
import { fetchTrending5m } from './gmgn/trending.js';
import { fetchTokenInfo } from './gmgn/token.js';
import { buildCandidate } from './pipeline/candidate.js';
import { evaluateWithLlm } from './pipeline/llm.js';
import { executeBuy, initWallet } from './executor/buy.js';
import { startPositionMonitor } from './positions/manager.js';
import {
  initTelegram, sendMessage, notifyCandidate,
  notifyBuy, notifySell, notifyError, paused,
  requestConfirmApproval,
} from './notify/telegram.js';

export async function start() {
  validateConfig();
  console.log('=== Blitz v1.0 ===');
  console.log(`Mode: ${TRADING_MODE}`);

  getDb();
  initWallet();
  initTelegram();
  startPositionMonitor((pos, reason, pnlPercent, pnlSol, signature) => {
    notifySell(pos.mint, pos.symbol, reason, pnlPercent, pnlSol, signature);
    // Update simulated dry balance on close
    const bal = Number(setting('dry_run_balance_sol', '0'));
    setSetting('dry_run_balance_sol', String(bal + pos.sizeSol + pnlSol));
    console.log(`[balance] sell closed: +${(pos.sizeSol + pnlSol).toFixed(3)} SOL, balance now ${(bal + pos.sizeSol + pnlSol).toFixed(3)} SOL`);
  });

  await sendMessage(`⚡ <b>Blitz started</b>\nMode: ${TRADING_MODE}`);

  // Seed default settings into DB if not set
  seedDefaults();

  // Main poll loop
  while (true) {
    try {
      await pollCycle();
    } catch (err) {
      console.error(`[cycle] error: ${(err as Error).message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function pollCycle() {
  if (paused) return;

  // Fetch trending 5m tokens
  const tokens = await fetchTrending5m();
  if (tokens.length === 0) {
    console.log('[cycle] 0 trending tokens (maybe no pump.fun activity)');
    return;
  }

  console.log(`[cycle] ${tokens.length} trending tokens`);

  for (const token of tokens) {
    // Fast in-memory dedup (also done in gates with DB check)
    if (seenMints.has(token.address)) continue;
    seenMints.add(token.address);

    // Build candidate with just trending data first (gates 1-3 + pre-filters)
    let candidate = buildCandidate(token, null);

    // Log candidate
    const candidateId = insertCandidate(candidate);

    if (!candidate.gatesPassed) {
      console.log(`  filtered ${token.symbol}: ${candidate.gatesDetail.join('; ')}`);
      continue;
    }

    // Enrichment: fetch token info for fees
    const tokenInfo = await fetchTokenInfo(token.address);
    if (!tokenInfo) {
      console.log(`  skip ${token.symbol}: failed to fetch token info`);
      updateCandidateStatus(candidateId, 'skipped');
      continue;
    }

    // Re-evaluate gates with fees
    candidate = buildCandidate(token, tokenInfo);
    if (!candidate.gatesPassed) {
      console.log(`  fee filtered ${token.symbol}: ${candidate.gatesDetail.join('; ')}`);
      updateCandidateStatus(candidateId, 'skipped');
      continue;
    }

    candidate.status = 'passed';
    console.log(`  PASSED ${token.symbol}: MC=$${fmt(candidate.marketCapUsd)} Vol=$${fmt(candidate.volume1mUsd)} Fees=${candidate.totalFeeSol.toFixed(1)}SOL`);

    // LLM final gate
    const llmDecision = await evaluateWithLlm(candidate);
    if (llmDecision) {
      candidate.llmVerdict = llmDecision.verdict;
      candidate.llmConfidence = llmDecision.confidence;
      candidate.llmReason = llmDecision.reason;
      candidate.status = llmDecision.verdict.toLowerCase() as any;
      updateCandidateStatus(candidateId, llmDecision.verdict.toLowerCase());
    }

    // Notify
    notifyCandidate(candidate);

    // Execute if BUY
    if (llmDecision?.verdict === 'BUY' && (llmDecision.confidence ?? 0) >= 75) {
      // Dry run balance check
      const buyAmount = Number(setting('buy_amount_sol', String(BUY_AMOUNT_SOL)));
      if (TRADING_MODE === 'dry_run') {
        const bal = Number(setting('dry_run_balance_sol', '0'));
        if (bal < buyAmount) {
          console.log(`  skip $${candidate.symbol}: dry balance ${bal.toFixed(3)} SOL < ${buyAmount} SOL`);
          updateCandidateStatus(candidateId, 'skipped');
          notifyError(`Insufficient dry balance: ${bal.toFixed(3)} SOL (need ${buyAmount} SOL for $${candidate.symbol})`);
          continue;
        }
      }

      // Confirm mode: ask user before executing
      if (TRADING_MODE === 'confirm') {
        const approved = await requestConfirmApproval(candidate);
        if (!approved) {
          console.log(`  skip $${candidate.symbol}: user rejected or timeout`);
          updateCandidateStatus(candidateId, 'skipped');
          continue;
        }
      }

      const buyResult = await executeBuy(candidate);

      if (buyResult.success) {
        // Deduct from dry balance
        if (TRADING_MODE === 'dry_run') {
          const bal = Number(setting('dry_run_balance_sol', '0'));
          setSetting('dry_run_balance_sol', String(bal - buyAmount));
          console.log(`[balance] buy ${candidate.symbol}: -${buyAmount} SOL, balance now ${(bal - buyAmount).toFixed(3)} SOL`);
        }

        notifyBuy(candidate, buyResult.signature);

        // Save position if successful
        if (TRADING_MODE !== 'dry_run' || buyResult.signature === 'dry_run') {
          const positionId = insertPosition({
            candidateId,
            mint: candidate.mint,
            symbol: candidate.symbol,
            name: candidate.name,
            entryPriceUsd: candidate.priceUsd,
            entryMcapUsd: candidate.marketCapUsd,
            sizeSol: buyAmount,
            tokenAmount: '0',
            executionMode: TRADING_MODE,
            tp1Percent: Number(setting('tp1_percent', '100')),
            tp1SellPercent: Number(setting('tp1_sell_percent', '50')),
            tp2Percent: Number(setting('tp2_percent', '150')),
            tp2SellPercent: Number(setting('tp2_sell_percent', '50')),
            trailingPercent: Number(setting('trailing_percent', '30')),
            slPercent: Number(setting('sl_percent', '-50')),
            maxHoldMinutes: Number(setting('max_hold_minutes', '60')),
            openedAtMs: Date.now(),
          });

          console.log(`[position] created #${positionId} for $${candidate.symbol}`);
        }
      } else {
        notifyError(`Buy failed for $${candidate.symbol}: ${buyResult.error}`);
      }
    }
  }
}

const seenMints = new Set<string>();

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function seedDefaults() {
  const defaults: [string, string][] = [
    ['tp1_percent', '100'],
    ['tp1_sell_percent', '50'],
    ['tp2_percent', '150'],
    ['tp2_sell_percent', '50'],
    ['trailing_percent', '30'],
    ['sl_percent', '-50'],
    ['max_hold_minutes', '60'],
    ['buy_amount_sol', String(BUY_AMOUNT_SOL)],
    ['token_max_age_sec', '300'],
    ['min_vol_1m_usd', '100000'],
    ['min_mcap_usd', '100000'],
    ['min_fees_sol', '10'],
    ['max_rug_ratio', '0.3'],
    ['max_open_positions', '3'],
    ['llm_min_confidence', '75'],
    ['dry_run_balance_sol', '0.5'],
  ];
  for (const [key, value] of defaults) {
    if (!setting(key)) setSetting(key, value);
  }
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
