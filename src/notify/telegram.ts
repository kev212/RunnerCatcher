import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TRADING_MODE } from '../config.js';
import { setting, setSetting } from '../db/connection.js';
import type { Candidate } from '../types/index.js';

let bot: TelegramBot;

// Pending approvals for confirm mode
interface PendingApproval {
  candidate: Candidate;
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
}
const pendingApprovals = new Map<string, PendingApproval>();

export function initTelegram() {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  registerCommands();
  registerCallbacks();
  bot.setMyCommands([
    { command: 'status', description: 'Bot status + uptime' },
    { command: 'positions', description: 'Open positions + PnL' },
    { command: 'settings', description: 'View all settings' },
    { command: 'learn', description: 'Learning summary' },
    { command: 'pause', description: 'Pause bot' },
    { command: 'resume', description: 'Resume bot' },
    { command: 'mode', description: 'Change mode: dry_run/confirm/live' },
    { command: 'balance', description: 'Dry run balance' },
  ]).catch(err => console.log(`[telegram] setMyCommands error: ${err.message}`));
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
  bot.onText(/\/balance/, handleBalance);
}

export let paused = false;

async function handleStatus(msg: TelegramBot.Message) {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  sendMessage([
    `⚡ <b>Blitz Status</b>`,
    ``,
    `Mode: <b>${TRADING_MODE}</b>`,
    `Uptime: <b>${fmtDuration(uptime)}</b>`,
    `Paused: <b>${paused ? 'Yes' : 'No'}</b>`,
  ].join('\n'));
}

async function handlePositions(msg: TelegramBot.Message) {
  try {
    const { getOpenPositions } = await import('../db/queries.js');
    const { fetchCurrentPrice } = await import('../positions/manager.js');
    const positions = getOpenPositions();
    if (positions.length === 0) {
      sendMessage('No open positions.');
      return;
    }
    const lines = [`📊 <b>Open Positions (${positions.length})</b>\n`];
    for (const p of positions) {
      // Fetch live price for estimated PnL
      const livePrice = await fetchCurrentPrice(p.mint);
      const pnl = livePrice && p.entryPriceUsd > 0
        ? ((livePrice / p.entryPriceUsd) - 1) * 100
        : 0;
      lines.push(
        `<b>$${p.symbol || p.mint.slice(0, 8)}</b>`,
        `  Entry: $${fmt(p.entryPriceUsd)} | Size: ${p.sizeSol} SOL`,
        `  ${pnl !== 0 ? `Est PnL: <b>${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%</b> | ` : ''}Status: ${p.status}`,
        `  TP1: +${p.tp1Percent}% | TP2: +${p.tp2Percent}% | SL: ${p.slPercent}% | Hold: ${p.maxHoldMinutes}m`,
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

async function handleBalance() {
  const bal = Number(setting('dry_run_balance_sol', '0'));
  const buyAmount = Number(setting('buy_amount_sol', '0.1'));
  const maxPos = Number(setting('max_open_positions', '3'));
  const maxBuy = Math.floor(bal / buyAmount);
  const lines = [
    '💰 <b>Dry Run Balance</b>',
    '',
    `Balance: <b>${bal.toFixed(3)} SOL</b>`,
    `Buy amount: ${buyAmount} SOL per position`,
    `Can open: <b>${maxBuy > maxPos ? maxPos : maxBuy}</b> / ${maxPos} positions`,
  ];
  if (bal < buyAmount) lines.push('', '⚠️ <b>Insufficient balance</b> \u2014 waiting for positions to close');
  sendMessage(lines.join('\n'));
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

/**
 * Send approval request for confirm mode with inline keyboard
 * Returns a promise that resolves to true (approved) or false (rejected/timeout)
 */
export async function requestConfirmApproval(candidate: Candidate): Promise<boolean> {
  const id = `${candidate.mint}:${Date.now()}`;
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(id);
      resolve(false);
    }, 60_000);

    pendingApprovals.set(id, { candidate, resolve, timeout });

    bot.sendMessage(TELEGRAM_CHAT_ID,
      `🤔 <b>Confirm BUY?</b>\n\n` +
      `Token: <b>$${candidate.symbol}</b> (${candidate.mint.slice(0, 8)}...)\n` +
      `MC: $${fmt(candidate.marketCapUsd)} | Vol: $${fmt(candidate.volume1mUsd)}\n` +
      `Fees: ${candidate.totalFeeSol.toFixed(1)} SOL\n` +
      `Confidence: ${candidate.llmConfidence}%\n` +
      `Reason: ${candidate.llmReason || ''}\n` +
      `\nApprove or reject within 60s`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ BUY', callback_data: `approve:${id}` },
              { text: '❌ SKIP', callback_data: `reject:${id}` },
            ],
          ],
        },
      },
    ).catch(() => {
      clearTimeout(timeout);
      pendingApprovals.delete(id);
      resolve(false);
    });
  });
}

function registerCallbacks() {
  bot.on('callback_query', async (query) => {
    if (!query.data || !query.message) return;

    const [action, id] = query.data.split(':');
    const pending = pendingApprovals.get(id);
    if (!pending) {
      bot.answerCallbackQuery(query.id, { text: 'Expired or already processed' });
      return;
    }

    clearTimeout(pending.timeout);
    pendingApprovals.delete(id);

    if (action === 'approve') {
      bot.answerCallbackQuery(query.id, { text: '✅ BUY approved!' });
      bot.editMessageText(
        `✅ <b>BUY approved</b>\nToken: <b>$${pending.candidate.symbol}</b>`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML' },
      ).catch(() => {});
      pending.resolve(true);
    } else {
      bot.answerCallbackQuery(query.id, { text: '❌ Skipped' });
      bot.editMessageText(
        `❌ <b>BUY rejected</b>\nToken: <b>$${pending.candidate.symbol}</b>`,
        { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML' },
      ).catch(() => {});
      pending.resolve(false);
    }
  });
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
