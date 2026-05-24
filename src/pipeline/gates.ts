import type { GmgnTrendingToken, GmgnTokenInfo } from '../types/index.js';
import {
  TOKEN_MAX_AGE_SEC, MIN_VOL_1M_USD, MIN_MCAP_USD,
  MIN_FEES_SOL, MAX_RUG_RATIO, SKIP_WASH_TRADING,
} from '../config.js';
import { seenMint, setting } from '../db/queries.js';

function numSetting(key: string, fallback: number): number {
  const v = setting(key);
  return v ? Number(v) : fallback;
}

function boolSetting(key: string, fallback: boolean): boolean {
  const v = setting(key);
  return v ? v === 'true' || v === '1' : fallback;
}

export interface GateResult {
  passed: boolean;
  failures: string[];
  ageSec: number;
  volumeUsd: number;
  marketCapUsd: number;
  totalFeeSol: number;
}

export function evaluateGates(
  token: GmgnTrendingToken,
  tokenInfo: GmgnTokenInfo | null,
): GateResult {
  const failures: string[] = [];

  const maxAge = numSetting('token_max_age_sec', TOKEN_MAX_AGE_SEC);
  const minVol = numSetting('min_vol_1m_usd', MIN_VOL_1M_USD);
  const minMcap = numSetting('min_mcap_usd', MIN_MCAP_USD);
  const minFees = numSetting('min_fees_sol', MIN_FEES_SOL);
  const maxRug = numSetting('max_rug_ratio', MAX_RUG_RATIO);
  const skipWash = boolSetting('skip_wash_trading', SKIP_WASH_TRADING);

  const now = Math.floor(Date.now() / 1000);
  const ageSec = token.creation_timestamp ? now - token.creation_timestamp : Infinity;
  const volumeUsd = token.volume || 0;
  const marketCapUsd = token.market_cap || 0;

  // Pre-filter: rug ratio
  if (token.rug_ratio != null && token.rug_ratio > maxRug) {
    failures.push(`rug_ratio: ${token.rug_ratio.toFixed(2)} > ${maxRug}`);
  }

  // Pre-filter: wash trading
  if (skipWash && (token.is_wash_trading === true || token.is_wash_trading === 1)) {
    failures.push('wash_trading detected');
  }

  // Gate 1: age
  if (ageSec > maxAge) {
    failures.push(`age: ${ageSec.toFixed(0)}s > ${maxAge}s`);
  }

  // Gate 2: volume
  if (volumeUsd < minVol) {
    failures.push(`volume: $${fmt(volumeUsd)} < $${fmt(minVol)}`);
  }

  // Gate 3: market cap
  if (marketCapUsd < minMcap) {
    failures.push(`mcap: $${fmt(marketCapUsd)} < $${fmt(minMcap)}`);
  }

  // Dedup: already seen this mint
  if (seenMint(token.address)) {
    failures.push('already seen');
  }

  // Gate 4: fees (from token info enrichment)
  const totalFeeSol = tokenInfo?.total_fee ?? 0;
  if (totalFeeSol < minFees) {
    failures.push(`fees: ${totalFeeSol.toFixed(1)} SOL < ${minFees} SOL`);
  }

  return {
    passed: failures.length === 0,
    failures,
    ageSec,
    volumeUsd,
    marketCapUsd,
    totalFeeSol,
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
