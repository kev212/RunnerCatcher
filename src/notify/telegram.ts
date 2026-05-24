import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TRADING_MODE } from '../config.js';
import { setting, setSetting } from '../db/connection.js';
import type { Candidate } from '../types/index.js';

let bot: TelegramBot;

export function initTelegram() {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  registerCommands();
  console.log('[telegram] bot started');
}

export function sendMessage(text: string, extra: Record<string, unknown> = {}) {
  return bot.sendMessage(TELEGRAM_CHAT_ID, text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

function registerCommands() {
  bot.onText(/\/status/, handleStatus);
  bot.onText(/\/positions/, handlePositions);
  bot.onText(/\/settings(\s+.+)?/, handleSettings);
  bot.onText(/\/learn/, handleLearn);
  bot.onText(/\/pause/, () => { paused = true; sendMessage('⏸️ Bot paused'); });
  bot.onText(/\/resume/, () => { paused = false; sendMessage('▶️ Bot resumed'); });
  bot.onText(/\/mode (.+)/, (msg, match) => {
    const mode = match![1].trim();
    if (['dry_run', 'confirm', 'live'].includes(mode)) {
      setSetting('trading_mode', mode);
      sendMessage(`✅ Mode changed to <b>${mode}</b>`);
    } else {
      sendMessage(`Invalid mode. Use: dry_run, confirm, or live`);
    }
  });
}

export let paused = false;

async function handleStatus(msg: TelegramBot.Message) {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  sendMessage([
    `🤖 <b>RunnerCatcher Status</b>`,
    ``,
    `Mode: <b>${TRADING_MODE}</b>`,
    `Uptime: <b>${fmtDuration(uptime)}</b>`,
    `Paused: <b>${paused ? 'Yes' : 'No'}</b>`,
  ].join('\n'));
}

async function handlePositions(msg: TelegramBot.Message) {
  try {
    const { getOpenPositions } = await import('../db/queries.js');
    const positions = getOpenPositions();
    if (positions.length === 0) {
      sendMessage('No open positions.');
      return;
    }
    const lines = [`📊 <b>Open Positions (${positions.length})</b>\n`];
    for (const p of positions) {
      const pnl = p.entryPriceUsd > 0 ? ((p.entryPriceUsd / p.entryPriceUsd) - 1) * 100 : 0;
      lines.push(
        `<b>$${p.symbol || p.mint.slice(0, 8)}</b>`,
        `  Entry: $${fmt(p.entryPriceUsd)} | Size: ${p.sizeSol} SOL`,
        `  Status: ${p.status} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`,
        '',
      );
    }
    sendMessage(lines.join('\n'));
  } catch (err) {
    sendMessage(`Error: ${(err as Error).message}`);
  }
}

async function handleLearn(msg: TelegramBot.Message) {
  const { getLearningSummary } = await import('../learning/advisor.js');
  const summary = getLearningSummary();
  sendMessage(summary);
}

async function handleSettings(msg: TelegramBot.Message, match: RegExpMatchArray | null) {
  if (!match || !match[1]?.trim()) {
    const keys = [
      'token_max_age_sec', 'min_vol_1m_usd', 'min_mcap_usd', 'min_fees_sol',
      'max_rug_ratio', 'buy_amount_sol', 'tp1_percent', 'tp2_percent',
      'sl_percent', 'trailing_percent', 'max_hold_minutes', 'max_open_positions',
    ];
    const lines = ['⚙️ <b>Settings</b>\n'];
    for (const key of keys) {
      const val = setting(key);
      lines.push(`<b>${key}</b> = ${val || '(default)'}`);
    }
    lines.push('\nUse: /settings key value to update');
    sendMessage(lines.join('\n'));
    return;
  }

  const parts = match[1].trim().split(/\s+/);
  if (parts.length < 2) {
    sendMessage('Usage: /settings key value');
    return;
  }
  const [key, ...valParts] = parts;
  const value = valParts.join(' ');
  setSetting(key, value);
  sendMessage(`✅ <b>${key}</b> set to <b>${value}</b>`);
}

export async function notifyCandidate(c: Candidate) {
  if (!c.gatesPassed) return;
  sendMessage([
    `🔍 <b>Candidate Passed Gates</b>`,
    ``,
    `Token: <b>$${c.symbol}</b> (${c.mint.slice(0, 8)}...)`,
    `Launchpad: ${c.launchpad}`,
    `Age: ${c.ageSec}s | MC: $${fmt(c.marketCapUsd)} | Vol 1m: $${fmt(c.volume1mUsd)}`,
    `Fees: ${c.totalFeeSol.toFixed(1)} SOL | Holders: ${c.holderCount}`,
    `Smart Degens: ${c.smartDegenCount} | Rug: ${(c.rugRatio * 100).toFixed(0)}%`,
    `Social: ${c.twitter ? '✅' : '❌'} | Web: ${c.website ? '✅' : '❌'} | TG: ${c.telegram ? '✅' : '❌'}`,
    c.llmVerdict ? `LLM: <b>${c.llmVerdict}</b> (${c.llmConfidence}%) ${c.llmReason || ''}` : '',
  ].join('\n'));
}

export async function notifyBuy(c: Candidate, signature?: string) {
  sendMessage([
    `🟢 <b>BUY EXECUTED</b>`,
    ``,
    `Token: <b>$${c.symbol}</b> (${c.mint.slice(0, 8)}...)`,
    `MC: $${fmt(c.marketCapUsd)} | Vol: $${fmt(c.volume1mUsd)}`,
    `Fees: ${c.totalFeeSol.toFixed(1)} SOL`,
    `Launchpad: ${c.launchpad}`,
    signature && signature !== 'dry_run' ? `Tx: <code>${signature}</code>` : 'Mode: dry_run',
  ].join('\n'));
}

export async function notifySell(mint: string, symbol: string, reason: string, pnlPercent: number, pnlSol: number, signature?: string | null) {
  const emoji = pnlPercent >= 0 ? '🟢' : '🔴';
  sendMessage([
    `${emoji} <b>SELL: ${reason}</b>`,
    ``,
    `Token: <b>$${symbol}</b> (${mint.slice(0, 8)}...)`,
    `PnL: <b>${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%</b> (${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL)`,
    signature && signature !== 'dry_run' ? `Tx: <code>${signature}</code>` : 'Mode: dry_run',
  ].join('\n'));
}

export async function notifyError(msg: string) {
  sendMessage(`🔴 <b>Error</b>\n${msg}`);
}

const startTime = Date.now();

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}
