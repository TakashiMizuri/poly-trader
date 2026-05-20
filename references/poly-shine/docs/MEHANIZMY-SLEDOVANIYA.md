# Механизмы следования за лидером (poly-shine)

Документ описывает, как система копирует сделки лидера Polymarket по подпискам: архитектуру, режимы размера, пропорциональное следование, состояние «линии позиции» и реакции на критические ситуации.

---

## 1. Общая архитектура

### 1.1. Сущности

| Сущность | Назначение |
|----------|------------|
| **Подписка** (`subscriptions`) | Один кошелёк лидера + режим размера + лимиты |
| **Событие лидера** (`leader_events`) | Активность лидера из Data API `/activity`: CLOB **TRADE** (BUY/SELL) и CTF **MERGE** / **SPLIT** / **REDEEM** |
| **Намерение зеркала** (`mirror_intents`) | План и статус копирования одного события (сделка или CTF-операция) |
| **Исполнение** (`executions`) | Результат: ордер CLOB или on-chain tx CTF (`merge` / `split` / `redeem`) |
| **Состояние линии** (`position_follow_state`) | Память по паре `(подписка, токен)` для пропорционального режима |
| **Движок** (`engine_state`) | Глобально: `read_only` / `shadow` / `live`, пауза, kill-switch |

### 1.2. Конвейер (worker, ~2.5 с)

```text
Опрос /activity лидера (TRADE, MERGE, SPLIT, REDEEM) → leader_events
       ↓
Создание mirror_intents (pending), если режим ≠ read_only
       ↓
Проверка линии позиции (только proportional_equity)
       ↓
Расчёт размера (BUY / SELL / MERGE / SPLIT / REDEEM)
       ↓
Лимиты, округление
       ↓
Live: CLOB (TRADE) или CTF on-chain (MERGE/SPLIT/REDEEM); shadow → planned + shadow_mode
       ↓
Обновление position_follow_state
```

Подписка **не** равна «стратегии» в классическом смысле: это привязка к одному адресу лидера и правилу размера.

---

## 2. Режимы движка (глобально)

| Режим | Поведение |
|-------|-----------|
| `read_only` | Только ingestion; новые `mirror_intents` не создаются; pending при переключении в read_only помечаются `read_only_mode` |
| `shadow` | Размер считается, `planned` пишется в БД; ордер **не** отправляется (`shadow_mode`); линия `shadow_active` (бумажная), при переходе в `live` сбрасывается в `watching` |
| `live` | TRADE: лимитный GTC по цене лидера; CTF: `mergePositions` / `splitPosition` / `redeemPositions` на Polygon; линия `active` только после fill / успешной CTF tx |

**Пауза:** обработка pending останавливается; при `cancelAllOnKill` при переходе в паузу вызывается `cancelAll` на CLOB.

---

## 3. Режимы размера (на подписку)

| `sizingMode` | Смысл |
|--------------|--------|
| `fixed_usd` | Фиксированная сумма USD на сделку: `shares = fixedUsd / price` |
| `pct_balance` | Доля **вашего** USDC на сделку: `shares = (balance × pct) / price` |
| `pct_leader_notional` | Ручной % от **размера сделки** лидера в шерах |
| `proportional_equity` | **Автоматическое** пропорциональное следование (см. ниже) |

Дополнительно в БД (enforced в worker на **live** для **TRADE**): `maxNotionalPerTrade`, `maxOrdersPerSecond`, `maxSlippageBps`, `maxOpenExposureUsd`, `maxDailyLossUsd`. На всех режимах sizing: cap по USDC (~98%), min $1 на BUY (не на SPLIT), округление вниз. CTF-операции **не** проходят проверку slippage / exposure / daily loss (это не CLOB BUY).

---

## 4. Ingestion: сделки и CTF-активность

### 4.0. Источник данных

Worker опрашивает **Data API** `GET /activity` (не только `/trades`), с фильтром типов:

| Тип API | `side` в `leader_events` | Смысл на Polymarket |
|---------|-------------------------|---------------------|
| `TRADE` | `BUY` / `SELL` | Сделка на CLOB |
| `MERGE` | `MERGE` | Сжигание пары Yes+No → USDC (обратно split) |
| `SPLIT` | `SPLIT` | USDC → пара Yes+No |
| `REDEEM` | `REDEEM` | Погашение после резолва рынка |

Лимит: последние **100** событий на тик (~1.25 с). Dedupe событий: `тип:tx:asset:side:size:price:timestamp`. Для CTF **одно** `mirror_intent` на операцию: ключ `m:{sub}:ctf:{side}:{tx}:{conditionId}:{size}:{ts}` (даже если API отдаёт две строки по исходам).

**Важно:** у MERGE/SPLIT/REDEEM Polymarket часто присылает `asset: ""`. Worker подставляет оба `clobTokenId` по `conditionId` (Gamma); если токены не найдены — псевдо-asset `condition:0x…` (в feed видно, merge on-chain может не сработать без реальных id).

В `raw` сохраняется полный payload activity; в `planned` — поле `activityType` и `conditionId`.

### 4.0.1. Восстановление позиции лидера

Нетто-позиция по токену из `leader_events` **до** текущего события:

```text
+BUY, +SPLIT
−SELL, −MERGE, −REDEEM
```

Без учёта MERGE/SPLIT/REDEEM книга лидера искажается (лидер «вышел» через merge, а мы всё ещё считаем шеры).

---

## 5. Пропорциональное следование (`proportional_equity`)

### 5.1. Идея

Лидер с $1000 cash, вы с $100 cash → целевое соотношение **10%** на **вход** и **докупку**.

На **выход** соотношение cash **не** используется: важна доля **позиции в токене**.

### 5.2. BUY (открытие и докупка)

**База:** только cash (Polymarket snapshot `cashBalance` лидера и USDC collateral на CLOB у фолловера).

```text
ratio = (followerCash × scale) / leaderCash
mirrorShares = leaderBuyShares × ratio
```

- `scale` хранится в поле `pct_balance` подписки (по умолчанию `1`, диапазон 0.01–10).
- После расчёта: cap по `maxNotionalPerTrade`, cap по доступному cash (98%), округление вниз до 2 знаков, минимум ~$1 notional на BUY.

**Докупка** (лидер снова BUY, когда линия уже `active`): та же формула по cash; **неудачная докупка не переводит линию в `abandoned`** (только пропуск этой сделки).

### 5.3. SELL (частичное и полное закрытие)

**База:** доля закрытия позиции лидера × ваша позиция в том же токене.

```text
closeFraction = min(1, leaderSellShares / leaderPositionBefore)
mirrorSellShares = followerPosition × closeFraction
```

- `leaderPositionBefore` — восстановленная нетто-позиция лидера по `leader_events` **до** текущего события (BUY/SPLIT минус SELL/MERGE/REDEEM).
- `followerPosition` — баланс conditional token через CLOB.
- Полное закрытие лидера (`closeFraction → 1`) → продаёте всю доступную позицию (с округлением и cap).

Пример:

| Шаг | Лидер | Вы (цель) |
|-----|-------|-----------|
| Buy 100 | 100 sh | 10 sh |
| Sell 20 | −20 (20% книги) | −2 sh (20% от 10) |
| Close all | −80 | −8 sh → линия `closed` |

### 5.4. MERGE, SPLIT, REDEEM (пропорциональный режим)

Для **линии позиции** CTF-операции маппятся на «торговые» стороны:

| `side` | Логика gate | Расчёт размера (как у) |
|--------|-------------|-------------------------|
| `MERGE` | как SELL | `position_fraction` — доля от книги лидера × ваша позиция |
| `REDEEM` | как SELL | то же (погашение уменьшает позицию) |
| `SPLIT` | как BUY | `cash_ratio` — доля от merge-размера лидера по cash |

**MERGE (live):** после расчёта `sets` cap по `min(баланс Yes, баланс No)` на обоих токенах рынка (Gamma → `clobTokenIds` по `conditionId`). On-chain: `mergePositions` на CTF `0x4D97…6045`, collateral USDC.e.

**SPLIT (live):** `splitPosition` с тем же `conditionId`; нужны USDC и approve на CTF.

**REDEEM (live):** `redeemPositions` по `conditionId` (сжигает все токены условия по index sets; отдельный amount не передаётся). Пропорциональный размер в `planned` отражает намерение; фактическое погашение — полное по контракту.

**Shadow:** план пишется, intent → `shadow_mode`; для MERGE в shadow балансы пары считаются из бумажных mirror-планов.

### 5.5. Метаданные в `planned`

Для UI и аудита в JSON намерения попадают, в том числе:

- `sizingBasis`: `cash_ratio` | `position_fraction`
- `balanceRatio`, `closeFraction`, `leaderCash`, `followerCash`
- `leaderPositionBefore`, `followerPosition`
- `followLineState`, `cappedBy`, `rawShares`, `roundedShares`

---

## 6. Состояние линии позиции (`position_follow_state`)

Применяется **только** к `proportional_equity`, ключ: `(subscriptionId, asset)`.

### 6.1. Состояния

| Состояние | Значение |
|-----------|----------|
| `untracked` | Линия по токену ещё не велась |
| `watching` | Лидер открыл BUY; ждём успешный вход фолловера |
| `active` | Вход **исполнен** на CLOB (`filled`); следуем докупкам и продажам |
| `shadow_active` | Только shadow — бумажная линия; при `live` сбрасывается |
| `abandoned` | Вход невозможен/провален — **линия не ведётся** |
| `closed` | Позиция фолловера ~0 после SELL / MERGE / REDEEM |

### 6.2. Диаграмма переходов

```text
untracked/closed + leader BUY → watching
watching + BUY filled (live)  → active
watching + BUY posted only    → watching (reconcile каждый тик)
watching + shadow_mode        → shadow_active
shadow → live                 → shadow_active → watching
watching + BUY skip/fail*     → abandoned
active + SELL/MERGE/REDEEM (успех) → active или closed (если остаток ~0)
abandoned + любое событие     → skip line_abandoned (пока у лидера есть позиция)
abandoned + leader flat + BUY → watching (новая линия)
untracked/closed/watching + SELL/MERGE/REDEEM → skip entry_not_established
```

\*Не переводят в `abandoned`: `shadow_mode` (→ `shadow_active` в shadow), `rate_limited` (intent остаётся `pending`, повтор на следующем тике).

### 6.3. Правило «не вошли — не следуем за линией»

Если **первый вход** (состояние `watching`) не удался по причинам вроде:

- `size_too_small`, `below_min_notional`
- `missing_follower_balance`, `missing_leader_cash`, `leader_cash_zero`
- `max_notional_too_small_for_tick`, `invalid_leader_price`
- ошибка поста ордера (`failed`)

→ линия → **`abandoned`**.

Пока у лидера по этому токену **есть позиция**, все последующие BUY/SELL фолловера по этой подписке получают **`line_abandoned`** (не копируем ни закрытие, ни докупку).

**Сброс `abandoned`:** когда восстановленная позиция лидера до сделки ≤ 0 (лидер «вышел в ноль» по токену) и приходит новый **BUY** — снова `watching` и попытка новой линии.

Это ровно сценарий: «пропорциональный вход невозможен → пропускаем всю линию до нового цикла лидера».

---

## 7. Критические ситуации и реакции

### 7.1. Вход (BUY / SPLIT)

| Ситуация | Реакция |
|----------|---------|
| Слишком малый размер после округления | Skip; при `watching` → `abandoned` |
| Нет USDC у фолловера | Skip; `watching` → `abandoned` |
| Нет/нулевой cash лидера в snapshot | Skip; `watching` → `abandoned` |
| Rate limit | Intent `pending`; остаётся `watching` |
| Shadow mode | План в `planned`, skip; остаётся `watching` |
| Ордер отклонён CLOB | `failed`; `watching` → `abandoned` |
| Подписка создана, лидер уже в позиции | Первый SELL → `entry_not_established`; первый BUY после flat → новая линия |
| Докупка при `active` не прошла | Только skip сделки; линия остаётся `active` |

### 7.2. Выход (SELL / MERGE / REDEEM)

| Ситуация | Реакция |
|----------|---------|
| Линия `abandoned` | `line_abandoned` |
| Нет входа (`untracked` / `watching`) | `entry_not_established` |
| Нет позиции у фолловера | `no_position_to_sell` |
| Позиция лидера до события = 0 | `invalid_leader_position` |
| Расчёт > вашей позиции | Cap до `followerPosition` (`cappedBy: position`) |
| Десинхрон книг | Доля от **вашей** позиции; алерт по логам / UI |

### 7.3. CTF (MERGE / SPLIT / REDEEM)

| Ситуация | Реакция |
|----------|---------|
| Нет `conditionId` в событии | `missing_condition_id` |
| Не удалось получить пару token id (Gamma) | `merge_tokens_unavailable` |
| Нет балансов пары для cap | `merge_pair_balance_unavailable` |
| Меньше пары, чем нужно для merge | `insufficient_merge_pair` |
| Sets после cap = 0 | `merge_amount_too_small` / `size_too_small` |
| CTF tx revert (нет approve, neg-risk и т.д.) | `failed` + текст ошибки в `executions.raw` |
| Neg-risk рынки | Прямой CTF может не подойти — нужен Neg Risk Adapter (пока не реализован) |

### 7.4. Системные

| Ситуация | Реакция |
|----------|---------|
| Ingestion lag / пропуск activity | Искажение `leaderPositionBefore`; риск — мониторинг feed (в т.ч. MERGE) |
| `posted` vs `filled` | `active` только на `filled`; reconcile `posted` каждый тик |
| Stale `processing` | >60s → снова `pending` |
| Очередь pending | FIFO (старые сначала), до 40 за тик |
| Пауза / read_only | Состояние линии не сбрасывается |
| Несколько подписок на одного лидера | Независимые `position_follow_state` |

---

## 8. Ограничения и округление

- CLOB клиент округляет **size вниз до 2 decimals** и цену до tick.
- Worker заранее делает `roundSharesDown` для согласованности `planned` и ордера.
- Минимум: `MIN_SHARES = 0.01`, BUY notional ≥ **$1** (`below_min_notional`).
- SELL не проверяет $1 min notional так же строго, как BUY.

---

## 9. API и UI

- **Feed** `GET /api/feed` — TRADE и CTF (MERGE/SPLIT/REDEEM в колонке side) + `planned` + статус.
- **Подписки** — выбор `Proportional (cash ratio)`, превью ratio по cash.
- **Dashboard** — колонки Mirror vol., Ratio (`% cash` или `% pos`), Result.
- Коды skip отображаются в `SKIP_LABELS` (в т.ч. `line_abandoned`, `entry_not_established`).

Telegram bot: `/addsub <addr> prop [scale]`.

---

## 10. Миграция БД

Таблица `position_follow_state` — миграция `0002_position_follow_state.sql`:

```bash
npm run db:migrate
```

---

## 11. Файлы реализации

| Область | Файлы |
|---------|--------|
| Схема БД | `packages/db/src/schema.ts` |
| Activity API | `apps/worker/src/dataApi.ts` |
| CTF типы / dedupe | `apps/worker/src/leaderActivity.ts` |
| On-chain CTF | `apps/worker/src/ctf.ts` |
| Размер | `apps/worker/src/sizing.ts` |
| Линия позиции | `apps/worker/src/positionState.ts`, `lineStateHooks.ts` |
| Оркестрация | `apps/worker/src/main.ts` |
| CLOB | `apps/worker/src/clob.ts` |
| Equity/cash лидера | `packages/shared/src/polymarket-equity.ts` |
| Тесты | `sizing.test.ts`, `positionState.test.ts`, `leaderActivity.test.ts` |
| UI / доки | `apps/web/src/pages/Documentation.tsx`, `lib/tradeDisplay.ts` |

---

## 12. Осознанно вне scope / ограничения

- Ingestion: poll `/activity` (100 событий), без WebSocket — риск пропусков при долгом простое.
- Daily loss: day-start equity в памяти процесса worker (UTC), не переживает рестарт.
- Exposure: snapshot `positionsValue`, не помарочный лимит на каждый токен.
- Ордер `posted` без fill: линия остаётся `watching` до fill или ручного cancel.
- Ребаланс портфеля между сделками.
- Следование по total equity (только **cash** на вход).
- Один worker на SQLite (иначе риск дубля ордеров).
- Neg-risk merge/split/redeem через Neg Risk Adapter — не покрыто прямым CTF.
- CTF на live требует approve USDC (split) и баланса пары токенов (merge).
- REDEEM on-chain погашает все токены условия, не дробный «%» как у SELL на CLOB.

---

*Версия документа: ingestion `/activity` (TRADE + MERGE + SPLIT + REDEEM), пропорциональный BUY (cash) / SELL·MERGE·REDEEM (position fraction), CTF on-chain в live, `position_follow_state`.*
