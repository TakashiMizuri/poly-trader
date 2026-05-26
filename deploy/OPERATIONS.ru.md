# Эксплуатация на VPS

Краткая шпаргалка для сервера `/opt/poly-trader`. Полный деплой: [DEPLOY.ru.md](../DEPLOY.ru.md).

Все команды — из корня проекта на сервере:

```bash
cd /opt/poly-trader
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
```

---

## Перезапуск после изменения `.env`

| Что меняли | Действие |
|------------|----------|
| `WEB_API_TOKEN`, `POLYMARKET_*`, `TELEGRAM_*`, `POLYTRADER_*`, `CORS_ORIGINS` | Пересоздать **api** (см. ниже) |
| `WEB_PUBLISH` | Пересоздать **web** |
| `VITE_API_URL`, `VITE_API_TOKEN` | **Пересобрать web** (`build --no-cache web`) — значения вшиваются в UI при сборке |

### Только API (бэкенд)

```bash
$COMPOSE up -d --force-recreate api
```

### API + Web (без пересборки)

```bash
$COMPOSE up -d --force-recreate
```

### Web после смены `VITE_*`

```bash
$COMPOSE build --no-cache web
$COMPOSE up -d web
```

### Полный перезапуск (без пересборки)

```bash
$COMPOSE restart
```

### Остановка / запуск

```bash
$COMPOSE stop          # остановить
$COMPOSE start         # запустить снова
$COMPOSE down          # остановить и удалить контейнеры (данные в volumes сохранятся)
```

---

## Обновление с Git

```bash
cd /opt/poly-trader

# 1. Бэкап БД (рекомендуется)
bash deploy/backup.sh

# 2. Подтянуть изменения
git pull

# 3. Сборка и запуск (скрипт делает build + up)
bash deploy/update.sh
```

Если менялись только `.env` или конфиги без кода — достаточно `$COMPOSE up -d --force-recreate api`.

Если менялся **frontend** (`client/`) — `update.sh` пересоберёт всё автоматически.

---

## Логи и статус

```bash
# Статус контейнеров
$COMPOSE ps

# Логи API (торговля, CLOB, redeem, Telegram)
$COMPOSE logs -f api

# Логи UI (nginx внутри web)
$COMPOSE logs -f web

# Последние 100 строк API
$COMPOSE logs --tail=100 api

# Health
curl -sf http://127.0.0.1:8081/health
curl -sf http://127.0.0.1/api/health        # через host nginx
```

Файлы логов API (bind mount): `./logs/` в корне репозитория → `polytrader-YYYYMMDD.log` (в контейнере `/app/logs`).

```bash
ls -la logs/
tail -f logs/polytrader-$(date +%Y%m%d).log
```

**Миграция со старого Docker volume** (если раньше был `polytrader-logs`):

```bash
cd /opt/poly-trader
mkdir -p logs
LOGS_VOL="$(docker volume ls --format '{{.Name}}' | grep '_polytrader-logs$' | head -1 || true)"
if [[ -n "$LOGS_VOL" ]]; then
  docker run --rm -v "${LOGS_VOL}:/from:ro" -v "$PWD/logs:/to" alpine cp -a /from/. /to/
  echo "Copied from volume $LOGS_VOL"
fi
bash deploy/update.sh
```

---

## Бэкап и восстановление

```bash
bash deploy/backup.sh                    # → backups/YYYYMMDD-HHMMSS/
bash deploy/backup.sh /path/to/backup    # свой путь
```

---

## Скачать SQLite на локальный ПК

БД — файл SQLite в Docker volume, внутри контейнера `/app/data/polytrader.db` (+ `-wal`, `-shm`). Через `scp` с хоста **напрямую не скачать** — сначала выгрузить на диск сервера.

**На сервере** (`cd /opt/poly-trader`):

```bash
mkdir -p db-export
$COMPOSE stop api

DATA_VOL="$(docker volume ls --format '{{.Name}}' | grep '_polytrader-data$' | head -1)"
docker run --rm -v "${DATA_VOL}:/data:ro" -v "$PWD/db-export:/out" alpine cp -a /data/. /out/

$COMPOSE start api
ls -la db-export/    # должны быть polytrader.db, polytrader.db-wal, polytrader.db-shm
```

**На Windows** (PowerShell), все три файла:

```powershell
scp root@ВАШ_IP:/opt/poly-trader/db-export/polytrader.db C:\Users\nexte\Desktop\FX_DATA\
scp root@ВАШ_IP:/opt/poly-trader/db-export/polytrader.db-wal C:\Users\nexte\Desktop\FX_DATA\
scp root@ВАШ_IP:/opt/poly-trader/db-export/polytrader.db-shm C:\Users\nexte\Desktop\FX_DATA\
```

Или папку целиком: `scp -r root@ВАШ_IP:/opt/poly-trader/db-export C:\Users\nexte\Desktop\FX_DATA\`

Альтернатива: `bash deploy/backup.sh` → скачать `backups/YYYYMMDD-HHMMSS/polytrader-data.tar.gz`.

Открыть локально: DB Browser for SQLite (все три файла в одной папке). Не коммитить в git.

---

## Типичные сценарии

**Сменил API-токен:**
```bash
nano .env
$COMPOSE up -d --force-recreate api
```

**Сменил ключи Polymarket / Telegram:**
```bash
nano .env
$COMPOSE up -d --force-recreate api
```

**UI ходит на localhost:5088** — в `.env` должно быть `VITE_API_URL=` (пусто), затем:
```bash
$COMPOSE build --no-cache web && $COMPOSE up -d web
```

**502 от nginx** — проверить, что web слушает 8081:
```bash
grep WEB_PUBLISH .env    # должно быть: WEB_PUBLISH=127.0.0.1:8081:80
ss -tlnp | grep 8081
$COMPOSE up -d --force-recreate web
```

**После reboot сервера** — контейнеры поднимутся сами (`restart: unless-stopped`). Проверка:
```bash
$COMPOSE ps
curl -sf http://127.0.0.1:8081/health
```

---

## Обновление с локальной машины (без Git)

С Windows (PowerShell), из папки проекта:

```powershell
scp -r .\src root@62.3.12.207:/opt/poly-trader/
scp -r .\client root@62.3.12.207:/opt/poly-trader/
scp .\docker-compose.yml .\docker-compose.prod.yml root@62.3.12.207:/opt/poly-trader/
```

На сервере: `bash deploy/update.sh`

---

## Документация

- [Механизм входа в сделку (волны, patience, коридоры цен)](../docs/ENTRY_MECHANISM.ru.md)

---

## Полезные переменные `.env` (prod)

```env
WEB_API_TOKEN=...
WEB_PUBLISH=127.0.0.1:8081:80
VITE_API_URL=
VITE_API_TOKEN=
POLYMARKET_PRIVATE_KEY=0x...
POLYTRADER_LIVE_MAKER_FILL_WAIT_SECONDS=45
POLYTRADER_LIVE_MAKER_REMAINDER_FILL_WAIT_SECONDS=20
```

`VITE_*` в prod **всегда пустые** — UI ходит на `/api` через nginx.

Тайминги maker-волн: см. [ENTRY_MECHANISM.ru.md](../docs/ENTRY_MECHANISM.ru.md).
