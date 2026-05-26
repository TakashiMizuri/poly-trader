# Развёртывание Poly Trader на VPS (Ubuntu 24.04)

Полная инструкция по установке торгового дашборда на арендованный Linux-сервер с HTTPS, Docker и автозапуском.

> Разработка и тест на своём ПК (без VPS после каждого коммита): **[DEV.ru.md](DEV.ru.md)**.

## Архитектура

```
Интернет → nginx (443, SSL) → Docker web (127.0.0.1:8080)
                                    ↓ proxy /api, /hubs
                              Docker api (внутренняя сеть, порт 5088 не наружу)
                                    ↓
                              SQLite (volume) + логи (volume)
```

- **API** (ASP.NET Core 10) — торговый движок, SignalR, Telegram-бот.
- **Web** (React + nginx) — UI; проксирует `/api` и `/hubs` на API.
- **nginx на хосте** — HTTPS (Let's Encrypt), единственная точка входа из интернета.

## Требования к серверу

| Параметр | Минимум | Рекомендуется |
|----------|---------|---------------|
| ОС | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| RAM | 1 GB | 2 GB |
| CPU | 1 vCPU | 2 vCPU |
| Диск | 10 GB | 20 GB |
| Домен | опционально* | да (для HTTPS) |

\* Без домена можно работать по IP на порту 8080 (только HTTP, не рекомендуется для продакшена).

## 1. Подключение к серверу

```bash
ssh root@ВАШ_IP
# или
ssh ubuntu@ВАШ_IP
```

Создайте пользователя (если заходите только под root):

```bash
adduser deploy
usermod -aG sudo deploy
rsync --version || apt install -y rsync
```

Дальше работайте под `deploy` с `sudo`.

## 2. Первичная настройка сервера

Скопируйте проект на сервер **или** клонируйте из Git:

```bash
# Вариант A: git
sudo mkdir -p /opt/poly-trader
sudo chown $USER:$USER /opt/poly-trader
git clone https://github.com/ВАШ_РЕПО/poly-trader.git /opt/poly-trader
cd /opt/poly-trader

# Вариант B: rsync с локальной машины (Windows PowerShell / Linux)
# rsync -avz --exclude node_modules --exclude bin --exclude obj --exclude .env \
#   ./ user@ВАШ_IP:/opt/poly-trader/
```

Запустите скрипт подготовки (Docker, nginx, UFW, fail2ban):

```bash
chmod +x deploy/*.sh
sudo bash deploy/setup-server.sh
```

Добавьте пользователя в группу docker (чтобы не писать `sudo` каждый раз):

```bash
sudo usermod -aG docker $USER
newgrp docker
```

## 3. Настройка переменных окружения

```bash
cd /opt/poly-trader
cp .env.example .env
nano .env
```

### Обязательно для продакшена

| Переменная | Значение |
|------------|----------|
| `WEB_API_TOKEN` | Длинный случайный пароль (Bearer-токен для UI и API). Пример: `openssl rand -hex 32` |
| `VITE_API_URL` | **Оставить пустым** — UI ходит на тот же origin через nginx |
| `VITE_API_TOKEN` | **Оставить пустым** — токен вводится в браузере, не вшивается в сборку |

### Для Live-торговли

| Переменная | Описание |
|------------|----------|
| `POLYMARKET_PRIVATE_KEY` | Приватный ключ `0x…` |
| `POLYMARKET_FUNDER_ADDRESS` | Адрес прокси-кошелька (для signature type 1–3) |
| `POLYMARKET_SIGNATURE_TYPE` | `0` EOA, `1` proxy, `2` Safe, `3` POLY_1271 |
| `POLYMARKET_POLYGON_RPC` | URL Polygon RPC (рекомендуется свой ключ Alchemy/Infura) |

### Опционально

| Переменная | Описание |
|------------|----------|
| `TELEGRAM_BOT_TOKEN` | Токен бота [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_ADMIN_CHAT_IDS` | ID админов через запятую ([@userinfobot](https://t.me/userinfobot)) |
| `POLYTRADER_LOG_LEVEL` | `Debug` для подробных логов |
| `CORS_ORIGINS` | Нужен только если UI на **другом** домене |

Пример минимального `.env` для VPS с доменом:

```env
WEB_API_TOKEN=ваш_случайный_токен_64_символа

POLYMARKET_PRIVATE_KEY=0x...
POLYMARKET_FUNDER_ADDRESS=
POLYMARKET_SIGNATURE_TYPE=0
POLYMARKET_POLYGON_RPC=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY

VITE_API_URL=
VITE_API_TOKEN=
```

## 4. Сборка и запуск

```bash
cd /opt/poly-trader
bash deploy/update.sh
```

Проверка на сервере:

```bash
curl -sf http://127.0.0.1:8080/health
# {"status":"ok"}

docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

Контейнеры должны быть `healthy` / `running`. API **не** слушает порт 5088 снаружи — только web на `127.0.0.1:8080`.

### Полезные команды

```bash
# Логи API
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api

# Логи UI (nginx)
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f web

# Перезапуск после изменения .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate api

# Остановка
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

## 5. HTTPS с доменом (рекомендуется)

### 5.1 DNS

Создайте A-запись:

```
trader.example.com  →  IP_ВАШЕГО_VPS
```

### 5.2 nginx на хосте

```bash
cd /opt/poly-trader
sudo cp deploy/nginx/poly-trader.conf /etc/nginx/sites-available/poly-trader
sudo sed -i 's/YOUR_DOMAIN/trader.example.com/g' /etc/nginx/sites-available/poly-trader
sudo ln -sf /etc/nginx/sites-available/poly-trader /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 5.3 SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d trader.example.com
```

Certbot настроит редирект HTTP→HTTPS и автообновление сертификата.

Откройте в браузере: **https://trader.example.com**

При первом входе UI запросит `WEB_API_TOKEN`.

## 6. Работа без домена (только IP)

Если домена нет, UI доступен по HTTP:

```
http://ВАШ_IP:8080
```

Для этого откройте порт в `docker-compose.prod.yml` (замените строку ports у `web`):

```yaml
ports:
  - "8080:80"
```

И добавьте правило UFW:

```bash
sudo ufw allow 8080/tcp
bash deploy/update.sh
```

**Внимание:** без HTTPS токен и трафик передаются открытым текстом. Используйте только для тестов.

## 7. Автозапуск

Docker Compose с `restart: unless-stopped` уже перезапускает контейнеры после reboot. Убедитесь, что Docker включён:

```bash
sudo systemctl enable docker nginx
```

## 8. Резервное копирование

База SQLite и логи хранятся в Docker volumes.

```bash
cd /opt/poly-trader
bash deploy/backup.sh
# Архив: backups/YYYYMMDD-HHMMSS/
```

Скопируйте бэкап на другой сервер:

```bash
scp -r backups/20260523-120000 user@backup-host:/backups/poly-trader/
```

**Восстановление** (API остановлен, данные заменены):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop api
DATA_VOL=$(docker volume ls --format '{{.Name}}' | grep '_polytrader-data$' | head -1)
docker run --rm -v "${DATA_VOL}:/data" -v "$PWD/backups/20260523-120000:/backup" \
  alpine sh -c 'cd /data && tar xzf /backup/polytrader-data.tar.gz'
docker compose -f docker-compose.yml -f docker-compose.prod.yml start api
```

## 9. Обновление приложения

```bash
cd /opt/poly-trader
git pull   # или rsync новой версии
bash deploy/backup.sh
bash deploy/update.sh
```

## 10. Безопасность

1. **WEB_API_TOKEN** — обязателен на любом сервере с доступом из интернета.
2. **Не коммитьте `.env`** — файл уже в `.gitignore`.
3. **UFW** — после `setup-server.sh` открыты только SSH (22), HTTP (80), HTTPS (443).
4. **API порт 5088** в prod не проброшен наружу.
5. **VITE_API_TOKEN** — не заполняйте в продакшене.
6. Рекомендуется **SSH-ключи** вместо пароля: `ssh-copy-id user@server`.
7. Для Live-режима на кошельке нужен **MATIC** на gas (redeem).

## 11. Проверка после деплоя

| Шаг | Команда / действие | Ожидание |
|-----|-------------------|----------|
| Health | `curl -sf https://trader.example.com/health` | `{"status":"ok"}` |
| UI | Открыть сайт, ввести токен | Дашборд загружается |
| API | В UI: connectivity | Binance / Polymarket OK |
| Paper | Запустить engine в Paper | Сделки в истории |
| Live | `GET /api/engine/live-status` | `canTrade: true` при настроенных ключах |

Подробнее по эксплуатации: [RUN_OPERATOR.md](RUN_OPERATOR.md).

## 12. Устранение неполадок

| Симптом | Решение |
|---------|---------|
| `502 Bad Gateway` | `docker compose ... ps` — контейнер `web`/`api` не running; смотрите `logs api` |
| UI открывается, API 401 | Неверный токен; проверьте `WEB_API_TOKEN` в `.env` и пересоздайте API |
| SignalR отключается | Проверьте блок `/hubs/` в nginx (WebSocket); см. `deploy/nginx/poly-trader.conf` |
| Нет Live-баланса | `POLYMARKET_SIGNATURE_TYPE`, `POLYMARKET_FUNDER_ADDRESS` |
| Мало места на диске | Логи: `./logs/` (retention 90 дней в `appsettings.json`) |
| Сборка Docker падает | `docker compose ... build --no-cache`; нужен ~2 GB RAM для .NET build |

## 13. Быстрая шпаргалка

```bash
# Первый деплой
sudo bash deploy/setup-server.sh
cp .env.example .env && nano .env
bash deploy/update.sh
# nginx + certbot — см. раздел 5

# Ежедневно
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api

# Обновление
git pull && bash deploy/backup.sh && bash deploy/update.sh
```

---

Вопросы по стратегии и Live-режиму: [RUN_OPERATOR.md](RUN_OPERATOR.md) · [README.md](README.md)
