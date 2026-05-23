# Poly Trader operator runbook

Automated BTC 5m Polymarket trading with **blend fade 2** (`blend2_pnl_max`). Paper mode simulates fills; Live mode posts real CLOB market buys via [Polymarket.Net](https://www.nuget.org/packages/Polymarket.Net).

## Prerequisites

- .NET 10 SDK (local) or Docker (production)
- Polymarket account with USDC on Polygon (Live)
- Exported private key + correct wallet type (see env below)

## Environment

Copy [`.env.example`](.env.example) to `.env`.

| Variable | Purpose |
|----------|---------|
| `WEB_API_TOKEN` | Optional bearer token for `/api/*` and `/hubs/trading` (`access_token` query for SignalR) |
| `POLYMARKET_PRIVATE_KEY` | `0x…` signer (required for Live) |
| `POLYMARKET_FUNDER_ADDRESS` | Proxy/deposit address (required for signature types 1–3; optional for EOA) |
| `POLYMARKET_SIGNATURE_TYPE` | `0` EOA, `1` proxy, `2` Gnosis Safe (mapped to Proxy), `3` POLY_1271 |
| `POLYMARKET_POLYGON_RPC` | Optional Polygon RPC URL |
| `CORS_ORIGINS` | Comma-separated production UI origins (e.g. `https://trader.example.com`) |
| `VITE_API_URL` | Frontend API base (empty in Docker nginx proxy setup) |
| `VITE_API_TOKEN` | Optional dev-only: same as `WEB_API_TOKEN` baked into Vite (skips the connect screen). Leave empty in production Docker builds so operators enter the token in the browser. |
| `POLYTRADER_LOG_DIR` | Serilog file directory (default `logs`; Docker: `./logs` → `/app/logs`) |
| `POLYTRADER_LOG_LEVEL` | Optional minimum level (`Debug`, `Information`, …) |
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) (optional) |
| `TELEGRAM_ADMIN_CHAT_IDS` | Comma-separated numeric Telegram user IDs allowed to control the bot and receive trade alerts |

The API loads repo-root `.env` on `dotnet run` (same keys as Docker `env_file`). Restart the API after changing `WEB_API_TOKEN` or Telegram settings.

**Logs:** one daily file `polytrader-YYYYMMDD.log` under the log directory (see [README](README.md#logging-serilog)). Tail during live sessions: `Get-Content logs\polytrader-*.log -Wait` (PowerShell).

## Telegram bot

When `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_IDS` are set, the API hosts a Telegram bot (long polling) in the same process as the trading engine.

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`.
2. Message [@userinfobot](https://t.me/userinfobot) → copy your numeric **Id** into `TELEGRAM_ADMIN_CHAT_IDS` (comma-separated for multiple operators).
3. Restart the API, open your bot in Telegram, send `/help`.

| Command | Action |
|---------|--------|
| `/status` | Engine running state, mode, paper/live balances |
| `/balance` | Current balances |
| `/chart` | Balance history chart (PNG, same data as dashboard) |
| `/start_engine` or `/resume` | Start engine (`IsRunning=true`) |
| `/stop_engine` or `/pause` | Stop engine |
| `/help` | Command list |

**Push alerts** (to all admin chat IDs): engine start/stop, trade opened, trade closed (win/loss + PnL). These mirror SignalR trade events.

## Phased rollout

1. **Paper soak** — Engine on, Live off, run days/weeks; verify trades/skips in UI.
2. **Live dry-run** — Set keys, check `GET /api/engine/live-status` and connectivity `clob` = OK with USDC; keep engine **stopped**.
3. **Live micro** — `BetStakeMode=Fixed`, `$1` stake, 1–2 windows; confirm real `orderId` on Polymarket.
4. **Scale** — Only after fills and settlement match expectations.

## Local run

```bash
# API
cd src/PolyTrader.Api && dotnet run

# UI
cd client && npm install && npm run dev
```

Open http://localhost:5173

## Docker

```bash
cp .env.example .env
# Edit .env; leave VITE_API_URL empty for bundled nginx proxy

docker compose up --build
```

- API: http://localhost:5088  
- UI: http://localhost:8080 (proxies `/api` and `/hubs` to API)

SQLite DB: Docker volume `polytrader-data` at `/app/data/polytrader.db`.

## VPS production (Ubuntu 24.04)

See **[DEPLOY.ru.md](DEPLOY.ru.md)** for the full Russian deployment guide.

```bash
sudo bash deploy/setup-server.sh
cp .env.example .env
bash deploy/update.sh   # docker-compose.prod.yml: API internal only, web on 127.0.0.1:8081
```

Эксплуатация (перезапуск, git pull, логи): **[deploy/OPERATIONS.ru.md](deploy/OPERATIONS.ru.md)**

## systemd example (API only)

```ini
[Unit]
Description=PolyTrader API
After=network.target

[Service]
WorkingDirectory=/opt/poly-trader/src/PolyTrader.Api
EnvironmentFile=/opt/poly-trader/.env
ExecStart=/usr/bin/dotnet run --no-build
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Build once: `dotnet publish src/PolyTrader.Api -c Release -o /opt/poly-trader/publish` and set `ExecStart=/usr/bin/dotnet /opt/poly-trader/publish/PolyTrader.Api.dll`.

## Backups

Back up `polytrader.db` (and `-wal`/`-shm` if present) while the API is stopped or use SQLite backup API. WAL mode is enabled for concurrent access.

## Redeeming winners (automatic)

After markets resolve, winning outcome tokens are redeemed **on-chain** via the Polymarket CTF contract (`redeemPositions`), same as `references/poly-shine/apps/worker/src/ctf.ts`:

- **Every 2 minutes:** background scan of Data API `redeemable=true` positions (one HTTP request per poll when live is configured; on-chain redeem only when something is redeemable).
- **After a live win:** redeem is triggered ~15s after settlement (retries on the next poll if the market is not redeemable yet).
- **Requires:** `POLYMARKET_PRIVATE_KEY` and MATIC on the signing wallet for gas.
- **Optional:** `POLYMARKET_POLYGON_RPC` (defaults to public Polygon RPC).

Proxy/Safe wallets (`POLYMARKET_SIGNATURE_TYPE` 1–2): tokens may sit on the funder contract; if auto-redeem reverts, redeem once in the Polymarket UI and check logs.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `$0` live balance | Wrong `POLYMARKET_SIGNATURE_TYPE` or missing `POLYMARKET_FUNDER_ADDRESS` |
| Orders fail | USDC balance, min ~5 shares, market liquidity at entry |
| Settlement deferred | Gamma/Data API not resolved yet; wait for market resolution |
| Engine won’t start Live | `GET /api/engine/live-status` → `canTrade: false` |

## Security

- Never commit `.env` or private keys.
- Set `WEB_API_TOKEN` on any host exposed to the internet.
- SignalR accepts `Authorization: Bearer` or `?access_token=` when token is configured.
