# Отчёт: расхождение PnL между Trades.json (прод-БД) и балансом Polymarket

**Дата отчёта:** 2026-05-26  
**Контекст:** разбор переписки в репозитории `trading-cursor-models` (анализ выгрузки с прода, сверка с Polymarket Data API).  
**Цель документа:** передать в смежный проект (бот / прод-БД) полный контекст для исправления учёта PnL, `Won`, `RedeemedAt` и отчётности.

---

## 1. Исходная проблема

Пользователь выгрузил сделки с прода в файл:

- **Путь:** `C:\Users\nexte\Desktop\FX_DATA\Trades.json`
- **Профиль Polymarket:** `0x8d42ed7cbb0763c033668c05cceacce092657ccd`

**Наблюдение:**

| Метрика | Значение |
|---------|----------|
| `Sum(PnlUsd)` по всем сделкам в JSON | **≈ +$12.97** (~$12 вручную) |
| Изменение баланса USDC на Polymarket за тот же период | **≈ +$50** |
| Внешние депозиты / выводы (по словам пользователя) | **нет** |

**Вопрос:** почему сумма `PnlUsd` не совпадает с ростом кошелька?

**Краткий ответ:** `Sum(PnlUsd)` отражает **логику учёта бота в БД**, а не полный денежный поток USDC на Polymarket. Сверка с on-chain Activity показала **~+$50–67** реального движения USDC при **~+$13** в JSON. Расхождение **не из-за депозитов** (в Activity их не было), а из‑за **ошибок/асимметрии полей `Won`, `PnlUsd`, `RedeemedAt`** относительно фактических BUY/REDEEM.

---

## 2. Данные и период

### 2.1. Выгрузка Trades.json

| Параметр | Значение |
|----------|----------|
| Всего записей | **169** |
| Режим | все `Mode == "Live"` |
| Период `CreatedAt` | **2026-05-24** … **2026-05-26** |
| Первая сделка | `2026-05-24 11:25:05` |
| Сумма `StakeUsd` | **$663.42** |
| Сумма `PnlUsd` | **+$12.9709** |
| Win rate (`Won == 1`) | **81 / 169** (≈ 47.9%) |

### 2.2. Модель сделки (C# / JSON)

```csharp
public class Trade
{
    public long CandleTime { get; set; }
    public string CreatedAt { get; set; }
    public double EntryPrice { get; set; }
    public string EntryWavesJson { get; set; }   // волны входа, orderId, fill
    public int Id { get; set; }
    public int MarketId { get; set; }
    public string Mode { get; set; }
    public int PaperAccountId { get; set; }
    public double PnlUsd { get; set; }
    public string PolymarketOrderId { get; set; }
    public string RedeemedAt { get; set; }       // null = не заполнено
    public double RequestedStakeUsd { get; set; }
    public string Side { get; set; }             // "Up" / "Down"
    public double StakeUsd { get; set; }
    public string Trend { get; set; }            // "Long" / "Short"
    public int Won { get; set; }                 // 1 = win, 0 = loss
}
```

### 2.3. Формула `PnlUsd` в JSON (проверена — сходится)

Для всех 169 сделок расхождений с формулой **нет** (порог ±$0.02):

| Исход | `PnlUsd` |
|-------|----------|
| Победа (`Won == 1`) | `StakeUsd / EntryPrice - StakeUsd` (выплата $1 за share минус стоимость входа) |
| Проигрыш (`Won == 0`) | `-StakeUsd` |

**Пример победы:** `StakeUsd = 3.35`, `EntryPrice = 0.5` → shares = 6.7 → payout = 6.7 → `PnlUsd = 3.35`.

**Пример проигрыша:** `PnlUsd = -3.29`, `RedeemedAt = null`.

### 2.4. Polymarket Data API

- **Endpoint:** `GET https://data-api.polymarket.com/activity`
- **Параметры:** `user`, `start` (unix), `limit` (до 500), `offset`, `sortBy=TIMESTAMP`, `sortDirection=ASC`
- **Заголовки:** нужен `User-Agent` (без него возможен HTTP 403)
- **Скрипт сверки в этом репо:** `scripts/reconcile_polymarket_activity.py`

**Привязка к 5m-рынкам BTC:** slug вида `btc-updown-5m-{CandleTime}` (поле `eventSlug` / `slug` в Activity). `CandleTime` в JSON совпадает с суффиксом slug.

---

## 3. Сверка с Polymarket Activity (on-chain)

Запрос Activity с `start` = за 1 час до первой сделки в JSON.

### 3.1. Сводка Activity (352 события)

| Тип | Кол-во | USDC (знак с точки зрения кошелька) |
|-----|--------|--------------------------------------|
| `TRADE` (все `BUY`) | 239 | **−$697.88** |
| `TRADE` `SELL` | 0 | $0 |
| `REDEEM` | 111 | **+$760.80** |
| `MAKER_REBATE` | 2 | **+$4.30** |
| Депозиты / выводы / transfer | 0 | — |

| Метрика | USD |
|---------|-----|
| **Net USDC (TRADE + REDEEM)** | **+$62.92** |
| **+ maker rebates** | **+$4.30** |
| **Итого on-chain** | **+$67.23** |

**Диапазон Activity (UTC):** 2026-05-24 10:25:22 … 2026-05-26 11:15:33.

### 3.2. Сопоставление по рынкам (169 JSON ↔ slug по `CandleTime`)

| Метрика | USD |
|---------|-----|
| Сумма `PnlUsd` (JSON) | **+$12.97** |
| Net USDC по Activity на те же `CandleTime` | **+$45.86** |
| Maker rebates (глобально за период) | **+$4.30** |
| **≈ как «баланс по рынкам бота»** | **+$50.16** |

**Вывод:** **~+$50 изменения кошелька** пользователя согласуется с **on-chain по рынкам бота (+ rebates)**, а **не** с `Sum(PnlUsd)`.

### 3.3. Activity до первой записи в JSON

До `CreatedAt` первой сделки (11:25 UTC) есть **13 событий**, net **+$13.15** USDC (покупки + redeem по более ранним 5m-слотам).  
Если сравнивать баланс с «момента первой строки в JSON», полный Activity за весь fetch даёт до **~+$67**; если только пост-сделки бота — **~+$54**.

---

## 4. Разбивка Trades.json по `RedeemedAt` и `Won`

Критическая таблица для понимания бага учёта:

| Группа | Кол-во | `RedeemedAt` | `Won` | Sum `PnlUsd` |
|--------|--------|--------------|-------|--------------|
| Закрыты в БД | **81** | заполнен | **все 1** | **+$362.27** |
| Не закрыты в БД | **88** | `null` | **все 0** | **−$349.30** |
| **Итого** | **169** | | | **+$12.97** |

### 4.1. Семантика полей (как есть сейчас в проде)

| Поле | Фактическое поведение |
|------|------------------------|
| `Won` | Исход по логике бота (свеча BTC 5m vs сторона ставки) |
| `PnlUsd` | Записывается при определении исхода; для лосса сразу `−StakeUsd` |
| `RedeemedAt` | Заполняется при **успешном redeem победы**; для проигрышей обычно **остаётся `null`** |
| `RedeemedAt == null` | **Не означает** «сделка открыта / исход неизвестен». В выгрузке = **проигрыш без timestamp redeem в БД**. |

### 4.2. On-chain vs БД по redeem

| Источник | Кол-во redeem |
|----------|----------------|
| JSON с `RedeemedAt != null` | **81** |
| Activity `REDEEM` | **111** |

Из 111 redeem: **20** с `usdcSize ≈ 0` (закрытие проигрышных / нулевых позиций), **91** ненулевых.

**Следствие:** часть проигрышей **имеет redeem on-chain**, но в БД **`RedeemedAt` не проставляется** (и/или не обновляется `PnlUsd` после chain).

---

## 5. Почему `Sum(PnlUsd) ≈ $13`, а кошелёк ≈ +$50

### 5.1. Арифметика JSON (сходится)

```
+$362.27  (81 победа с RedeemedAt)
−$349.30  (88 "проигрышей" с RedeemedAt = null)
─────────
≈ +$12.97
```

Пользователь **правильно** суммирует `PnlUsd`. Проблема не в LINQ, а в том, что **−$349 по 88 строкам завышены** относительно реального USDC.

### 5.2. Корзина «88 проигрышей с null»

| Метрика | USD |
|---------|-----|
| Sum `PnlUsd` (JSON) | **−$349.30** |
| Net USDC on-chain на те же `CandleTime` | **≈ −$297.91** |
| **Занижение итога JSON vs chain** | **≈ +$51** |

Это почти полностью объясняет разрыв **$50 кошелёк vs $13 JSON**.

### 5.3. Подтверждённые расхождения исхода (`Won = 0`, но chain > 0)

Минимум **6 сделок**: в JSON проигрыш, `RedeemedAt = null`, по BUY+REDEEM на том же рынке — **положительный** net USDC.

| Id | JSON `PnlUsd` | Chain net (USDC) | Примечание |
|----|---------------|------------------|------------|
| 191 | −$4.00 | **+$7.97** | `has_redeem` on-chain |
| 161 | −$4.15 | **+$4.32** | |
| 226 | −$3.90 | **+$3.90** | |
| 234 | −$3.88 | **+$3.88** | |
| 212 | −$3.85 | **+$3.85** | |
| 247 | −$3.85 | **+$3.85** | |

**Интерпретация:** бот записал `Won = 0` (часто по свече BTC), Polymarket выплатил как за победу → `PnlUsd` должен был быть положительным.

### 5.4. Примеры перекрёстного учёта (slug / соседние 5m)

Не все строки 1:1 совпадают по одному `CandleTime` (redeem может относиться к соседнему слоту). Примеры больших расхождений:

| Id | `Won` | JSON `PnlUsd` | Chain | `RedeemedAt` (БД) |
|----|-------|---------------|-------|-------------------|
| 251 | 1 | +$7.72 | **−$4.16** | заполнен |
| 223 | 1 | +$4.27 | **−$3.95** | заполнен |
| 257 | 1 | +$7.20 | **+$12.34** | заполнен |

Для отчётности по рынкам нужна привязка по `conditionId` / `transactionHash` из `EntryWavesJson`, а не только по `CandleTime`.

### 5.5. Отклонённая гипотеза

**Внешний приток USDC** за период Activity **не обнаружен** (нет типов deposit/withdrawal/transfer). Расхождение **не объясняется депозитами**.

---

## 6. Как считать PnL (инструкция для разработчиков)

### 6.1. Три уровня метрик (не смешивать)

| Цель | Что использовать | Комментарий |
|------|------------------|-------------|
| **Деньги (кошелёк USDC)** | Polymarket Activity: Σ(REDEEM) − Σ(BUY) + rebates | **Источник правды для баланса** |
| **Учёт бота (как в БД)** | `Sum(PnlUsd)`, `Won`, win rate | Корректна только если `Won` совпадает с Polymarket |
| **«Открытые сделки»** | Не `RedeemedAt == null` | В текущей схеме `null` ≈ проигрыш в БД, не pending |

### 6.2. Что можно считать в C# по JSON

```csharp
// Книжный PnL бота (у вас ~ +$13) — НЕ равен кошельку
var bookPnl = trades.Where(t => t.Mode == "Live").Sum(t => t.PnlUsd);

// Винрейт по решениям бота
var live = trades.Where(t => t.Mode == "Live").ToList();
var winRate = (double)live.Count(t => t.Won == 1) / live.Count;

// Средняя доходность на выигрыше (не entry price)
var avgWinReturn = live.Where(t => t.Won == 1).Average(t => t.PnlUsd / t.StakeUsd);

// ОШИБКА: это не "незакрытые", а проигрыши в вашей БД
var lossesWithNullRedeem = live.Where(t => string.IsNullOrEmpty(t.RedeemedAt));

// Контроль качества: побед без redeem быть не должно
var bugUnredeemedWins = live.Where(t => t.Won == 1 && string.IsNullOrEmpty(t.RedeemedAt));
```

### 6.3. Денежный PnL (псевдокод)

```text
cash_pnl = 0
for each activity in polymarket_activity(user, start, end):
    if type == TRADE and side == BUY:  cash_pnl -= usdcSize
    if type == TRADE and side == SELL: cash_pnl += usdcSize
    if type == REDEEM:                 cash_pnl += usdcSize
    if type in (MAKER_REBATE, REWARD, REFERRAL_REWARD): cash_pnl += usdcSize
```

Для сверки с конкретной сделкой бота — группировать Activity по `eventSlug == $"btc-updown-5m-{trade.CandleTime}"` или по `conditionId` из ордера.

---

## 7. Рекомендуемые правки в прод-проекте

### 7.1. Приоритет P0 — корректность исхода

1. **`Won` должен совпадать с исходом рынка Polymarket**, а не только с направлением свечи BTC (если сейчас только BTC — зафиксировать расхождения).
2. После финального исхода **пересчитывать `PnlUsd`**:
   - win: `StakeUsd / EntryPrice - StakeUsd` (или фактический fill из `EntryWavesJson`);
   - loss: `−StakeUsd` (или фактический USDC loss по chain).
3. **Алерт:** `Won == 1` и `RedeemedAt == null` дольше N минут.

### 7.2. Приоритет P1 — `RedeemedAt` и redeem

1. **Разделить понятия:**
   - `OutcomeDeterminedAt` — когда известен исход;
   - `RedeemedAt` — когда выполнен redeem on-chain (в т.ч. $0).
2. Для проигрышей: по желанию вызывать redeem $0 и **всё равно писать `RedeemedAt`** для полноты lifecycle.
3. Сверять с Activity: на каждый `conditionId` должен быть согласованный набор TRADE/REDEEM.

### 7.3. Приоритет P2 — отчётность и аналитика

1. В UI/отчётах показывать **два столбца:**
   - `BookPnlUsd` (из БД);
   - `ChainPnlUsd` (из Activity или внутреннего ledger).
2. Хранить **`ChainPnlUsd`** / `LastReconciledAt` после nightly reconcile.
3. Для `EntryWavesJson` с несколькими `orderId` — агрегировать fills; один `PolymarketOrderId` на trade недостаточен (в JSON до **191** уникальных order id на **169** trades).

### 7.4. Опционально — новые поля в таблице Trade

| Поле | Назначение |
|------|------------|
| `OutcomeSource` | `BtcCandle` / `Polymarket` / `Manual` |
| `RedeemUsdc` | фактическая сумма redeem с chain |
| `ChainPnlUsd` | net BUY+REDEEM по рынку |
| `ReconciledAt` | последняя успешная сверка |

---

## 8. Пример записи JSON (для разработчика)

**Победа (redeemed):**

```json
{
  "Id": 114,
  "CandleTime": 1779621900,
  "Won": 1,
  "StakeUsd": 3.35,
  "EntryPrice": 0.5,
  "PnlUsd": 3.35,
  "RedeemedAt": "2026-05-24 11:30:36.0068947",
  "PolymarketOrderId": "0x362e..."
}
```

**Проигрыш (в БД, без RedeemedAt):**

```json
{
  "Id": 115,
  "CandleTime": 1779622200,
  "Won": 0,
  "StakeUsd": 3.29,
  "PnlUsd": -3.29,
  "RedeemedAt": null,
  "PolymarketOrderId": "0xf60d..."
}
```

**Типичный баг (по сверке — как id 191):** `Won: 0`, `RedeemedAt: null`, `PnlUsd: -4`, но on-chain после REDEEM **положительный** net.

---

## 9. Воспроизведение сверки

### 9.1. Python (этот репозиторий)

```bash
python scripts/reconcile_polymarket_activity.py
```

Скрипт читает `C:\Users\nexte\Desktop\FX_DATA\Trades.json` (путь захардкожен — поменять при необходимости), качает Activity, печатает сводку.

### 9.2. API вручную

```http
GET https://data-api.polymarket.com/activity?user=0x8d42ed7cbb0763c033668c05cceacce092657ccd&start=1779618305&limit=500&offset=0&sortBy=TIMESTAMP&sortDirection=ASC
Header: User-Agent: Mozilla/5.0 (compatible; reconcile/1.0)
```

Пагинация: увеличивать `offset` на `limit`, пока массив не пустой.

### 9.3. Проверки после фиксов

- [ ] `Sum(PnlUsd)` ≈ chain net по тем же `CandleTime` (допуск ±$1 на комиссии/округление).
- [ ] `Won == 1` ⟹ был ненулевой REDEEM (или явный SELL) на том же `conditionId`.
- [ ] Нет строк с `Won == 0` и положительным chain net > $0.50.
- [ ] `UnredeemedWins` (победа без `RedeemedAt`) = 0.
- [ ] Activity не содержит необъяснённых DEPOSIT за торговые дни.

---

## 10. Краткие ответы на частые вопросы (из переписки)

**«Все `RedeemedAt = null` — это проигрыши?»**  
→ **Да, в этой выгрузке** (88 шт., все `Won = 0`). Но это **не значит**, что Polymarket согласен с проигрышем или что сделка «ещё открыта».

**«Почему тогда `Sum(PnlUsd)` не равен балансу?»**  
→ Потому что часть из 88 строк — **неверный `Won`** или **несовпадение stake/redeem с chain**; JSON занижает результат примерно на **$37–51** относительно USDC.

**«Были депозиты?»**  
→ **Нет** в Activity за период.

**«Что использовать для „сколько заработал“?»**  
→ **Activity (BUY/REDEEM + rebates)**, не `Sum(PnlUsd)` до исправления бота.

**«Что использовать для win rate стратегии?»**  
→ `Won` из БД **после** исправления исхода; иначе win rate тоже смещён.

---

## 11. Итоговая таблица-шпаргалка

| Метрика | Значение |
|---------|----------|
| JSON `Sum(PnlUsd)` | **+$12.97** |
| On-chain TRADE+REDEEM | **+$62.92** |
| On-chain + rebates | **+$67.23** |
| On-chain по 169 `CandleTime` + rebates | **≈ +$50.16** |
| Побед с `RedeemedAt` | 81, **+$362.27** |
| «Проигрышей» с `null` | 88, **−$349.30** |
| REDEEM on-chain | **111** (20 нулевых) |
| Подтверждённых ошибок `Won` | **≥ 6** |
| Депозиты | **0** |

---

## 12. Связанные файлы

| Файл | Описание |
|------|----------|
| `C:\Users\nexte\Desktop\FX_DATA\Trades.json` | Исходная выгрузка (вне репо) |
| `scripts/reconcile_polymarket_activity.py` | Скрипт сверки с Data API |
| `docs/polymarket-trades-pnl-reconciliation-report.md` | Этот отчёт |

---

## 13. Контакты / контекст

- **Wallet:** `0x8d42ed7cbb0763c033668c05cceacce092657ccd`
- **Репозиторий анализа:** `trading-cursor-models`
- **Инструмент:** Cursor agent, май 2026

*Документ подготовлен для передачи в проект бота / прод-БД. При изменении схемы Trade или логики redeem — обновить разделы 4, 7 и 9.*
