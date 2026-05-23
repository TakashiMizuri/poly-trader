# Poly Trader

Automated BTC 5-minute Polymarket trading dashboard with **blend fade 2** strategy (`blend2_pnl_max` preset from [trading-cursor-models](docs/blend_fade2/STRATEGY.md)), Binance 5m data, and paper/live modes.

## Stack

- **Backend:** ASP.NET Core 10, SQLite, SignalR, hosted trading engine
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, [shadcn/ui](https://ui.shadcn.com) (Base UI), Lightweight Charts

## Prerequisites

- .NET 10 SDK
- Node.js 20+

## Setup

1. Copy environment template:

   ```bash
   cp .env.example .env
   ```

2. Optional: set `WEB_API_TOKEN` (API auth) and the same value in `VITE_API_TOKEN` only for local dev convenience. On first visit the UI prompts for the token when the API requires it. See [RUN_OPERATOR.md](RUN_OPERATOR.md).

3. For **Live** trading: set `POLYMARKET_PRIVATE_KEY`, `POLYMARKET_FUNDER_ADDRESS` (if using proxy/email wallet), and `POLYMARKET_SIGNATURE_TYPE`. See [RUN_OPERATOR.md](RUN_OPERATOR.md).

4. Optional **Telegram** operator bot: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_IDS` — engine control, balance chart, trade alerts. See [RUN_OPERATOR.md](RUN_OPERATOR.md#telegram-bot).

## Logging (Serilog)

The API writes one **daily rolling** log file under `logs/` (override with `POLYTRADER_LOG_DIR` or `Serilog:LogDirectory`):

- `polytrader-YYYYMMDD.log` — all backend logs (trades, redeem, CLOB, API, engine, etc.)

Set `POLYTRADER_LOG_LEVEL=Debug` for more detail (e.g. CLOB price fetches, redeem polls).

## Run

**API** (port 5088):

```bash
cd src/PolyTrader.Api
dotnet run
```

**Web** (port 5173):

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173

## Docker

```bash
cp .env.example .env
docker compose up --build
```

API on port **5088**, UI on **8080** (nginx proxies `/api` and `/hubs`). Details: [RUN_OPERATOR.md](RUN_OPERATOR.md).

## VPS production (Ubuntu 24.04)

Full deployment guide (Russian): **[DEPLOY.ru.md](DEPLOY.ru.md)**

```bash
sudo bash deploy/setup-server.sh
cp .env.example .env   # set WEB_API_TOKEN, Polymarket keys
bash deploy/update.sh  # uses docker-compose.prod.yml (API not exposed publicly)
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/engine` | Engine settings (mode, active paper account) |
| `PUT /api/engine` | Update mode, active paper account, stake, running |
| `GET /api/engine/live-status` | Live CLOB configured, USDC balance, can trade |
| `GET /api/paper-accounts` | List paper accounts |
| `POST /api/paper-accounts` | Create paper account |
| `POST /api/paper-accounts/{id}/reset` | Reset account balance |
| `GET /api/balance` | Active paper + live balance |
| `GET /api/balance/history` | Balance growth: `actual` (snapshots) + `expected` (strategy replay on 5m candles) |
| `GET /api/trades` | Trade history (filter by mode / paper account) |
| `GET /api/market/active` | Current 5m window + progress |
| `GET /api/health/connectivity` | Binance / Polymarket status |
| `WS /hubs/trading` | SignalR: trades, balance, market window (Bearer or `?access_token=` if `WEB_API_TOKEN` set) |
| Telegram bot | Engine start/stop, `/chart`, trade open/close alerts (see [RUN_OPERATOR.md](RUN_OPERATOR.md#telegram-bot)) |

## Live trading

Live mode uses **Polymarket.Net** for USDC balance and **two-wave post-only maker limits at the best bid** (0% fee): wave 1 on the full stake, wave 2 on the remainder with a refreshed bid — then the trade is recorded (partial total is OK; no taker top-up). Override with `POLYTRADER_LIVE_ENTRY_ORDER_MODE=Market` for legacy IOC taker orders. Tune `POLYTRADER_LIVE_MAKER_FILL_WAIT_SECONDS` / `POLYTRADER_LIVE_MAKER_REMAINDER_FILL_WAIT_SECONDS`. **Automatic CTF redeem** for winning positions (no manual cash-out in the Polymarket UI). Settlement prefers Polymarket Gamma/Data API resolution; Binance OHLC is fallback only. Start with paper, then follow the phased rollout in [RUN_OPERATOR.md](RUN_OPERATOR.md).

## Strategy

Backend runs **blend_fade2** via `BlendFade2Signals` + `BetResolver` (same logic as `client/src/utils/chart/blendFade2Signals.ts`). On each closed Binance 5m candle the engine: (1) settles the bet signaled at that bar’s open, (2) opens a new bet for the **next** candle when blend_fade2 signals.

Defaults: `blend2_pnl_max` preset, 3% compound stake capped at $500; live maker entries assume **0%** fee (set `CommissionPercent` in UI for paper/backtest). See [docs/blend_fade2/STRATEGY.md](docs/blend_fade2/STRATEGY.md).

## Project layout

```
src/PolyTrader.Api/          REST + SignalR
src/PolyTrader.Core/         Blend fade 2 strategy + domain
docs/blend_fade2/            Strategy spec (ported)
src/PolyTrader.Infrastructure/ EF, Binance WS, Polymarket
client/                      React UI
tests/PolyTrader.Core.Tests/ Strategy golden tests
references/                  poly-shine, shine-trader
```
