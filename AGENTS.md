# RunnerCatcher — Arch Plan

## Stack
- **Runtime**: Node.js + TypeScript (tsx)
- **Data**: GMGN API (trending 1m + token info)
- **Execution**: Jupiter Ultra (swap/v2)
- **LLM**: DeepSeek v4 Flash (OpenAI-compatible, final gate only)
- **Persistence**: SQLite (better-sqlite3)
- **Notif**: Telegram Bot API

## Flow
```
GMGN trending 1m poll (5s) 
  → pre-filter (rug > 0.3? wash trading? dedup?)
  → gates (age < 5min, vol ≥ $100k, MC ≥ $100k)
  → enrich (/v1/token/info → fees ≥ 10 SOL)
  → LLM final gate (DeepSeek)
  → Jupiter Ultra buy (if verdict BUY + confidence ≥ 75)
  → Position monitor (5s loop):
      - TP1 +100% → sell 50%
      - TP2 +150% → sell remaining 50%
      - Trailing 30% from high
      - SL -50%
      - Max hold 60 min
```

## Structure
- `src/index.ts` — entry, poll loop
- `src/config.ts` — .env + consts
- `src/gmgn/` — client, trending poll, token info
- `src/pipeline/` — gates, candidate builder, LLM
- `src/executor/` — Jupiter buy/sell
- `src/positions/` — TP/SL monitor
- `src/notify/` — Telegram bot
- `src/db/` — SQLite connection + queries
- `src/types/` — shared types
- `src/utils/` — wallet, constants

## GMGN API
- `GET /v1/market/rank` — trending 1m
- `GET /v1/token/info` — token detail + fees
- Auth: `X-APIKEY` header
- Rate: ~20 req/s sustained, 2500ms delay enforced

## TP/SL
- TP1: +100% → partial sell 50%
- TP2: +150% → sell remaining 50%
- Trailing: 30% from high (armed after TP1)
- SL: -50%
- Max hold: 60 min

## Modes
- `dry_run` — no real tx, full logic test (default)
- `confirm` — Telegram approval needed
- `live` — fully automated

## Commands
- `/status` — bot uptime, mode
- `/positions` — open positions + PnL
- `/settings` — list config
- `/settings <key> <value>` — update at runtime
- `/pause` / `/resume`
- `/mode <dry_run|confirm|live>`
