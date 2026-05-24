import type { GmgnTrendingToken, GmgnTokenInfo, Candidate } from '../types/index.js';
import { evaluateGates } from './gates.js';

export function buildCandidate(
  token: GmgnTrendingToken,
  tokenInfo: GmgnTokenInfo | null,
): Candidate {
  const gates = evaluateGates(token, tokenInfo);
  const nowMs = Date.now();
  const createdAtMs = token.creation_timestamp
    ? token.creation_timestamp * 1000
    : nowMs;

  return {
    mint: token.address,
    symbol: token.symbol || '',
    name: token.name || '',
    launchpad: token.launchpad_platform || '',
    ageSec: gates.ageSec,
    marketCapUsd: gates.marketCapUsd,
    volume1mUsd: gates.volumeUsd,
    totalFeeSol: gates.totalFeeSol,
    holderCount: token.holder_count || 0,
    smartDegenCount: token.smart_degen_count || 0,
    renownedCount: token.renowned_count || 0,
    rugRatio: token.rug_ratio || 0,
    top10HolderRate: token.top_10_holder_rate || 0,
    bundlerRate: token.bundler_rate || 0,
    isWashTrading: token.is_wash_trading === true || token.is_wash_trading === 1,
    creatorTokenStatus: token.creator_token_status || '',
    creatorClose: token.creator_close === true || token.creator_close === 1,
    ctoFlag: token.cto_flag || 0,
    twitter: token.twitter_username || '',
    website: token.website || '',
    telegram: token.telegram || '',
    liquidity: token.liquidity || 0,
    hotLevel: token.hot_level || 0,
    priceUsd: token.price || 0,
    createdAtMs,
    scannedAtMs: nowMs,
    gatesPassed: gates.passed,
    gatesDetail: gates.failures,
    status: gates.passed ? 'passed' : 'scanned',
    rawTrending: token,
    rawTokenInfo: tokenInfo || undefined,
  };
}
