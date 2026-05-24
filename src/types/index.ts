export interface GmgnTrendingToken {
  address: string;
  symbol: string;
  name: string;
  chain: string;
  launchpad_platform: string;
  exchange: string;
  creation_timestamp: number;
  open_timestamp: number;
  price: number;
  market_cap: number;
  liquidity: number;
  volume: number;
  price_change_percent: number;
  price_change_percent1m: number;
  price_change_percent5m: number;
  price_change_percent1h: number;
  swaps: number;
  buys: number;
  sells: number;
  holder_count: number;
  smart_degen_count: number;
  renowned_count: number;
  hot_level: number;
  rug_ratio: number;
  is_wash_trading: boolean | number;
  bundler_rate: number;
  rat_trader_amount_rate: number;
  top_10_holder_rate: number;
  sniper_count: number;
  creator_token_status: string;
  creator_close: boolean | number;
  dev_team_hold_rate: number;
  cto_flag: number;
  twitter_username: string;
  website: string;
  telegram: string;
  total_supply: string;
  creator: string;
  is_honeypot: string;
  is_open_source: boolean | number;
  is_renounced: boolean | number;
  renounced_mint: boolean | number;
}

export interface GmgnTokenInfo {
  address: string;
  name: string;
  symbol: string;
  chain: string;
  price: number;
  market_cap: number;
  liquidity: number;
  total_supply: string;
  holder_count: number;
  total_fee: number;
  trade_fee: number;
  top_10_holder_rate: number;
  rug_ratio: number;
  is_wash_trading: boolean | number;
  creator_token_status: string;
  creator_close: boolean | number;
  dev_team_hold_rate: number;
  cto_flag: number;
  smart_degen_count: number;
  renowned_count: number;
  twitter_username: string;
  website: string;
  telegram: string;
}

export interface LlmContext {
  mint: string;
  symbol: string;
  name: string;
  launchpad: string;
  ageSec: number;
  marketCapUsd: number;
  volume1mUsd: number;
  totalFeeSol: number;
  holderCount: number;
  smartDegenCount: number;
  renownedCount: number;
  rugRatio: number;
  top10HolderRate: number;
  bundlerRate: number;
  isWashTrading: boolean;
  creatorTokenStatus: string;
  creatorClose: boolean;
  ctoFlag: number;
  twitter: string;
  website: string;
  telegram: string;
  liquidity: number;
  hotLevel: number;
}

export interface LlmDecision {
  verdict: 'BUY' | 'WATCH' | 'SKIP';
  confidence: number;
  reason: string;
}

export interface Candidate {
  id?: number;
  mint: string;
  symbol: string;
  name: string;
  launchpad: string;
  ageSec: number;
  marketCapUsd: number;
  volume1mUsd: number;
  totalFeeSol: number;
  holderCount: number;
  smartDegenCount: number;
  renownedCount: number;
  rugRatio: number;
  top10HolderRate: number;
  bundlerRate: number;
  isWashTrading: boolean;
  creatorTokenStatus: string;
  creatorClose: boolean;
  ctoFlag: number;
  twitter: string;
  website: string;
  telegram: string;
  liquidity: number;
  hotLevel: number;
  priceUsd: number;
  createdAtMs: number;
  scannedAtMs: number;
  gatesPassed: boolean;
  gatesDetail: string[];
  llmVerdict?: string;
  llmConfidence?: number;
  llmReason?: string;
  status: 'scanned' | 'passed' | 'bought' | 'skipped';
  rawTrending: GmgnTrendingToken;
  rawTokenInfo?: GmgnTokenInfo;
}

export interface Position {
  id: number;
  candidateId: number;
  mint: string;
  symbol: string;
  name: string;
  entryPriceUsd: number;
  entryMcapUsd: number;
  sizeSol: number;
  tokenAmount: string;
  executionMode: string;
  status: string;
  tp1Hit: number;
  tp1Done: number;
  tp2Hit: number;
  tp2Done: number;
  slHit: number;
  highWaterPrice: number;
  highWaterMcap: number;
  trailingArmed: number;
  openedAtMs: number;
  closedAtMs: number | null;
  exitReason: string | null;
  exitPriceUsd: number | null;
  exitMcapUsd: number | null;
  pnlPercent: number | null;
  pnlSol: number | null;
  buySignature: string | null;
  sellSignature: string | null;
  strategyId: string;
  tp1Percent: number;
  tp1SellPercent: number;
  tp2Percent: number;
  tp2SellPercent: number;
  trailingPercent: number;
  slPercent: number;
  maxHoldMinutes: number;
}

export type TradingMode = 'dry_run' | 'confirm' | 'live';
