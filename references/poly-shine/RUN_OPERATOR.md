# poly-shine operator runbook

Single-operator Polymarket mirror stack: **SQLite** (file DB), **worker** (ingestion + execution), and **Telegram bot** (all configuration, stats, and alerts).

## Processes

Run **both** on the same host (or share the SQLite file over a reliable FS — not recommended; prefer one machine):

1. **Worker** — `npm run start -w @poly-shine/worker` (or `npm run dev -w @poly-shine/worker`)
2. **Telegram bot** — `npm run start -w @poly-shine/bot` (or `npm run dev -w @poly-shine/bot`)

Use the **same** `SQLITE_PATH` for both.

## Environment

Copy [.env.example](.env.example) to `.env` in the repo root (or export variables in your process manager).

| Variable | Purpose |
|----------|---------|
| `SQLITE_PATH` | Path to SQLite file (default `./data/polyshine.sqlite`) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_ADMIN_CHAT_IDS` | Comma-separated Telegram **numeric user IDs** allowed to control the bot |
| `TELEGRAM_CHAT_ID` | Optional legacy single chat id for worker alerts if `TELEGRAM_ADMIN_CHAT_IDS` is unset |
| `POLYMARKET_PRIVATE_KEY` | `0x…` signer for CLOB (required for `live` + `/balance`) |
| `POLYMARKET_FUNDER_ADDRESS` | Funder per Polymarket account setup |
| `POLYMARKET_SIGNATURE_TYPE` | `0` EOA, `1` proxy, `2` Gnosis Safe, `3` POLY_1271 |

Polymarket still requires **local order signing** with a private key for automation; a browser-only wallet cannot run the worker unattended.

## Database setup

```bash
npm install
npm run db:migrate
```

`db:migrate` creates the parent directory for `SQLITE_PATH` if needed.

## Phased rollout

Use the bot:

- `/mode read_only` — ingest leader trades only (no mirror intents).
- `/mode shadow` — plan mirrors, **no** orders posted.
- `/mode live` — post orders (start tiny caps via `/addsub` limits).

`/pause` stops posting; with `cancelAll on` (`/cancelall on`), open orders are cancelled when you pause.

## SQLite notes

- **WAL** mode and `busy_timeout` are enabled for concurrent bot + worker access.
- Prefer **one server**; avoid NFS/SMB for the DB file.

## Bot commands

Send `/help` in Telegram for the full command list (subscriptions, engine, events, balance).

## Upgrading ingestion

The worker polls the Polymarket Data API. For lower latency, add the authenticated CLOB **User WebSocket** later and keep polling as reconciliation.

## Compliance

Personal use only; follow Polymarket ToS and applicable law.
