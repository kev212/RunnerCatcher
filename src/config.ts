import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function num(key: string, fallback: number): number {
  const v = process.env[key];
  return v !== undefined ? Number(v) : fallback;
}

function str(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

function bool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export const APP_NAME = 'Blitz';

export const TELEGRAM_BOT_TOKEN = str('TELEGRAM_BOT_TOKEN');
export const TELEGRAM_CHAT_ID = str('TELEGRAM_CHAT_ID');

export const GMGN_API_KEY = str('GMGN_API_KEY');
export const GMGN_REQUEST_DELAY_MS = num('GMGN_REQUEST_DELAY_MS', 1200);

export const SOLANA_PRIVATE_KEY = str('SOLANA_PRIVATE_KEY');
export const TRADING_MODE = str('TRADING_MODE', 'dry_run') as 'dry_run' | 'confirm' | 'live';
export const BUY_AMOUNT_SOL = num('BUY_AMOUNT_SOL', 0.1);
export const LIVE_MIN_SOL_RESERVE = num('LIVE_MIN_SOL_RESERVE', 0.02);
export const JUPITER_SLIPPAGE_BPS = num('JUPITER_SLIPPAGE_BPS', 300);
export const JUPITER_API_KEY = str('JUPITER_API_KEY');
export const JUPITER_SWAP_BASE_URL = 'https://api.jup.ag/swap/v2';

export const TOKEN_MAX_AGE_SEC = num('TOKEN_MAX_AGE_SEC', 300);
export const MIN_VOL_1M_USD = num('MIN_VOL_1M_USD', 100000);
export const MIN_MCAP_USD = num('MIN_MCAP_USD', 100000);
export const MIN_FEES_SOL = num('MIN_FEES_SOL', 10);
export const MAX_RUG_RATIO = num('MAX_RUG_RATIO', 0.3);
export const SKIP_WASH_TRADING = bool('SKIP_WASH_TRADING', true);

export const TP1_PERCENT = num('TP1_PERCENT', 100);
export const TP1_SELL_PERCENT = num('TP1_SELL_PERCENT', 50);
export const TP2_PERCENT = num('TP2_PERCENT', 150);
export const TP2_SELL_PERCENT = num('TP2_SELL_PERCENT', 50);
export const TRAILING_PERCENT = num('TRAILING_PERCENT', 30);
export const SL_PERCENT = num('SL_PERCENT', -50);
export const MAX_HOLD_MINUTES = num('MAX_HOLD_MINUTES', 60);

export const ENABLE_LLM = bool('ENABLE_LLM', true);
export const LLM_BASE_URL = str('LLM_BASE_URL', 'https://api.deepseek.com/v1');
export const LLM_API_KEY = str('LLM_API_KEY');
export const LLM_MODEL = str('LLM_MODEL', 'deepseek-v4-flash');
export const LLM_TIMEOUT_MS = num('LLM_TIMEOUT_MS', 30000);
export const LLM_MIN_CONFIDENCE = num('LLM_MIN_CONFIDENCE', 75);

export const MAX_OPEN_POSITIONS = num('MAX_OPEN_POSITIONS', 3);
export const POSITION_CHECK_MS = num('POSITION_CHECK_MS', 5000);
export const POLL_INTERVAL_MS = num('POLL_INTERVAL_MS', 5000);
export const DB_PATH = str('DB_PATH', './runner.db');

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const SOL_DECIMALS = 1_000_000_000;

export const JSON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
};

export const GMGN_BASE = 'https://openapi.gmgn.ai';

export const TRENDING_PLATFORMS = [
  'Pump.fun',
  'meteora_virtual_curve',
  'bags',
];

export function validateConfig() {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (!TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID is required');
  if (!GMGN_API_KEY) throw new Error('GMGN_API_KEY is required');
  if (TRADING_MODE !== 'dry_run' && !SOLANA_PRIVATE_KEY) {
    throw new Error('SOLANA_PRIVATE_KEY is required for confirm/live mode');
  }
}
