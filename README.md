# Blitz

Solana memecoin sniper bot — detects high-volume runners within 5 minutes of launch via GMGN trending 1m, validates with LLM (DeepSeek), executes via Jupiter Ultra, and manages TP/SL positions automatically.

## Prerequisites

| API | Required | Get it at |
|-----|----------|-----------|
| GMGN API Key | ✅ | https://gmgn.ai/ai |
| Jupiter API Key | ✅ | https://api.jup.ag |
| Telegram Bot Token | ✅ | https://t.me/BotFather |
| DeepSeek API Key | LLM gate | https://platform.deepseek.com |
| Solana Private Key | live mode | Phantom / Solflare export |

## Quick Start

```bash
git clone https://github.com/kev212/RunnerCatcher.git
cd RunnerCatcher
npm install
cp .env.example .env
```

Edit `.env` with your keys, then:

```bash
npm run dry     # dry_run mode (no real tx)
npm start       # confirm / live mode
```

## How It Works

```
Poll GMGN trending 1m (every 5s)
  → pre-filter (rug_ratio > 0.3? wash trading? dedup?)
  → gates: age < 5min AND volume 1m ≥ $100k AND MC ≥ $100k
  → enrich: GMGN token info → total fees ≥ 10 SOL
  → LLM final gate (DeepSeek) — injected with learned patterns
  → Jupiter Ultra swap → Position monitor → TP / SL
```

## TP/SL Strategy

| Trigger | Action | Default |
|---------|--------|---------|
| TP1 | +100% → sell 50% | 100% |
| TP2 | +150% → sell remaining 50% | 150% |
| Trailing | 30% from high (armed after TP1) | 30% |
| SL | -50% | -50% |
| Max hold | auto-sell after N minutes | 60 min |

## Learning System

Bot learns from every trade outcome:

- **Level 1**: Patterns extracted across 8 categories (launchpad, rug_ratio, smart_degen, volume, social, MC, holders). Injected into LLM prompt as few-shot context.
- **Level 2 (Adaptive)**: Win rate evaluated per pattern. If <35% on ≥5 trades, matching setting auto-tightened. Telegram alert sent.

## Modes

| Mode | Description |
|------|-------------|
| `dry_run` | Full logic simulation, no real transactions (default) |
| `confirm` | Send trade intent to Telegram for manual approval |
| `live` | Fully automated execution |

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/status` | Bot uptime, mode, status |
| `/positions` | Open positions + PnL |
| `/settings` | List all configurable settings |
| `/settings key value` | Update setting at runtime |
| `/learn` | Learning summary (win rate, best/worst, adaptive changes) |
| `/pause` | Pause auto-buy |
| `/resume` | Resume auto-buy |
| `/mode dry_run\|confirm\|live` | Switch execution mode |

## Config

Key settings (all configurable via `/settings`):

```
token_max_age_sec = 300       # max token age (5 min)
min_vol_1m_usd = 100000       # 1-min volume threshold
min_mcap_usd = 100000         # market cap threshold
min_fees_sol = 10             # total fees threshold
max_rug_ratio = 0.3           # max rug pull risk
buy_amount_sol = 0.1          # position size
tp1_percent = 100             # TP1 trigger
tp2_percent = 150             # TP2 trigger
sl_percent = -50              # stop loss
trailing_percent = 30         # trailing stop from high
max_hold_minutes = 60         # max position duration
max_open_positions = 3        # concurrent position limit
```

## Tech Stack

- **Runtime**: Node.js + TypeScript (tsx)
- **Data**: GMGN API (trending + token info)
- **Execution**: Jupiter Ultra (swap/v2)
- **LLM**: DeepSeek V4 Flash (OpenAI-compatible)
- **Persistence**: SQLite (better-sqlite3)
- **Notifications**: Telegram Bot API
