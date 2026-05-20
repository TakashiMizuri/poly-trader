# Poly Trader

Automated BTC 5-minute Polymarket trading dashboard with **BoS flow** strategy (`flow_active` preset from [trading-cursor-models](docs/bos_flow/STRATEGY.md)), Binance 5m data, and paper/live modes.

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

2. Optional: set `POLYMARKET_PRIVATE_KEY` for live CLOB orders (paper mode works without it).

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

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/engine` | Engine settings (mode, active paper account) |
| `PUT /api/engine` | Update mode, active paper account, stake, running |
| `GET /api/paper-accounts` | List paper accounts |
| `POST /api/paper-accounts` | Create paper account |
| `POST /api/paper-accounts/{id}/reset` | Reset account balance |
| `GET /api/balance` | Active paper + live balance |
| `GET /api/balance/history` | Balance snapshots (per paper account) |
| `GET /api/trades` | Trade history (filter by mode / paper account) |
| `GET /api/market/active` | Current 5m window + progress |
| `GET /api/health/connectivity` | Binance / Polymarket status |
| `WS /hubs/trading` | SignalR: trades, balance, market window |

## Strategy

Backend runs **bos_flow** via `BosFlowSignals` + `BetResolver` (same logic as `client/src/utils/chart/bosFlowSignals.ts`). On each closed Binance 5m candle the engine: (1) settles the bet signaled at that bar’s open, (2) opens a new bet for the **next** candle when bos_flow signals.

Defaults: `flow_active` preset, 1% compound stake capped at $500, 1.8% entry fee. See [docs/bos_flow/STRATEGY.md](docs/bos_flow/STRATEGY.md).

## Project layout

```
src/PolyTrader.Api/          REST + SignalR
src/PolyTrader.Core/         Bos flow strategy + domain
docs/bos_flow/               Strategy spec (ported)
src/PolyTrader.Infrastructure/ EF, Binance WS, Polymarket
client/                      React UI
tests/PolyTrader.Core.Tests/ Strategy golden tests
references/                  poly-shine, shine-trader
```
