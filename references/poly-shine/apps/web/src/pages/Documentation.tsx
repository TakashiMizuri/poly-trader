import type { ReactNode } from "react";
import { Page } from "@/components/Page";
import { cn } from "@/lib/utils";

function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-8 rounded-xl border border-border/80 bg-card/50 p-5 shadow-sm sm:p-7"
    >
      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</h2>
      <DocBody className="mt-5 space-y-5 text-[0.9375rem] leading-[1.65] text-muted-foreground">
        {children}
      </DocBody>
    </section>
  );
}

function DocBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className}>{children}</div>;
}

function DocH3({ children }: { children: ReactNode }) {
  return (
    <h3 className="border-b border-border/60 pb-2 text-sm font-semibold text-foreground">{children}</h3>
  );
}

function DocP({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={className}>{children}</p>;
}

function DocUl({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-primary/60">{children}</ul>;
}

function DocTable({
  headers,
  rows,
  monoFirstCol = false,
}: {
  headers: string[];
  rows: string[][];
  monoFirstCol?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-muted/10">
      <table className="w-full min-w-[28rem] text-left text-[0.8125rem]">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {headers.map((h) => (
              <th key={h} className="px-3.5 py-2.5 font-medium text-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={cn("border-b border-border/50 last:border-0", i % 2 === 1 && "bg-muted/15")}
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-3.5 py-2.5 align-top",
                    monoFirstCol && j === 0 && "font-mono text-[0.75rem] text-foreground"
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocPre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border border-l-[3px] border-l-primary/40 bg-muted/25 px-4 py-3.5 font-mono text-[0.75rem] leading-relaxed text-foreground sm:text-xs">
      {children}
    </pre>
  );
}

function DocCallout({
  variant = "note",
  title,
  children,
}: {
  variant?: "note" | "warn" | "danger";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-l-[3px] p-4 sm:p-5",
        variant === "note" && "border-border border-l-primary/50 bg-muted/25",
        variant === "warn" && "border-amber-500/25 border-l-amber-500 bg-amber-500/5",
        variant === "danger" && "border-red-500/25 border-l-red-500 bg-red-500/5"
      )}
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-2.5 space-y-2.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

const TOC_GROUPS = [
  {
    label: "Basics",
    items: [
      { id: "overview", label: "Overview" },
      { id: "architecture", label: "Architecture" },
      { id: "engine", label: "Engine modes" },
      { id: "sizing", label: "Sizing modes" },
      { id: "ctf", label: "Merge & CTF" },
    ],
  },
  {
    label: "Proportional",
    items: [
      { id: "proportional", label: "Following" },
      { id: "follow-line", label: "Position line" },
    ],
  },
  {
    label: "Critical cases",
    items: [
      { id: "critical-buy", label: "Entries (BUY)" },
      { id: "critical-sell", label: "Exits (SELL)" },
      { id: "critical-system", label: "System" },
    ],
  },
  {
    label: "Reference",
    items: [
      { id: "limits", label: "Limits & rounding" },
      { id: "ui", label: "Console & API" },
      { id: "skip-codes", label: "Skip codes" },
      { id: "scope", label: "Known limitations" },
    ],
  },
] as const;

function DocTocNav() {
  return (
    <nav aria-label="Table of contents" className="space-y-5">
      {TOC_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {group.label}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {group.items.map(({ id, label }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function DocTocChips() {
  return (
    <nav aria-label="Table of contents" className="flex flex-wrap gap-2 lg:hidden">
      {TOC_GROUPS.map((group) =>
        group.items.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {label}
          </a>
        ))
      )}
    </nav>
  );
}

export function DocumentationPage() {
  return (
    <Page
      title="Documentation"
      description="How poly-shine copies leader activity (CLOB trades and CTF merge/split/redeem), sizes mirrors, tracks position lines, and reacts when something goes wrong."
    >
      <DocTocChips />

      <div className="-mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-4">
        <aside className="sticky top-6 z-10 hidden w-52 shrink-0 self-start lg:block xl:w-56">
          <div className="w-full max-h-[calc(100dvh-3rem)] rounded-xl border border-border bg-card/60 p-4 shadow-sm">
            <p className="px-3 text-sm font-semibold text-foreground">On this page</p>
            <div className="mt-3 max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain pr-1">
              <DocTocNav />
            </div>
          </div>
        </aside>

        <article className="min-w-0 flex-1 space-y-5 pb-8">
        <DocSection id="overview" title="Overview">
          <DocP>
            poly-shine watches one or more <strong className="text-foreground">leader wallets</strong> on
            Polymarket. When the leader acts — <strong className="text-foreground">CLOB trades</strong> (BUY/SELL)
            or <strong className="text-foreground">CTF operations</strong> (merge, split, redeem) — the worker
            records the event and, for each active <strong className="text-foreground">subscription</strong>,
            plans a mirror on your account. Live mode posts limit orders for trades and on-chain CTF txs for
            merge/split/redeem; shadow writes the plan only; read-only ingests without mirroring.
          </DocP>
          <DocP>
            A subscription is not a generic “strategy” object — it is a binding between{" "}
            <em>one leader address</em>, <em>one sizing mode</em>, and optional limits. You can follow the
            same leader with multiple subscriptions (each keeps its own position-follow memory).
          </DocP>
          <DocCallout variant="note" title="Who this is for">
            <DocP>
              Use this page when interpreting Dashboard skips, Subscription ratio previews, or Engine mode
              behavior. The worker loop runs about every 2.5 seconds from leader activity ingestion through
              CLOB or CTF execution.
            </DocP>
          </DocCallout>
        </DocSection>

        <DocSection id="architecture" title="Architecture & pipeline">
          <DocH3>Main database entities</DocH3>
          <DocTable
            monoFirstCol
            headers={["Entity", "Role"]}
            rows={[
              ["subscriptions", "Leader wallet + sizing mode + per-subscription limits"],
              [
                "leader_events",
                "Leader activity from Data API /activity: TRADE (BUY/SELL) or MERGE / SPLIT / REDEEM",
              ],
              ["mirror_intents", "Planned mirror for one leader event — status and skip reason"],
              ["executions", "CLOB order result or CTF transaction (merge / split / redeem)"],
              ["position_follow_state", "Memory per (subscription, token) for proportional mode only"],
              ["engine_state", "Global mode: read_only / shadow / live, pause, kill-switch"],
            ]}
          />

          <DocH3>End-to-end pipeline</DocH3>
          <DocPre>{`Poll leader /activity (TRADE, MERGE, SPLIT, REDEEM) → leader_events
       ↓
Create mirror_intents (pending) when mode ≠ read_only
       ↓
Recover stale processing → pending; reconcile posted → filled
       ↓
Claim pending FIFO (oldest first, atomic)
       ↓
Position line check (proportional_equity only)
       ↓
Compute size + cash/notional caps (all modes)
       ↓
Live TRADE: slippage / exposure / daily-loss → GTC limit
Live CTF: merge/split/redeem on Polygon (no slippage check)
       ↓
Shadow → planned + shadow_mode skip
       ↓
Update position_follow_state (filled / CTF success → active; shadow → shadow_active)`}</DocPre>
          <DocP>
            Leader events arrive first; mirroring is always derived. CTF operations share one mirror intent per
            transaction and condition (even if the API emits one row per outcome token). If the engine is
            paused, pending intents are not processed, but existing follow-line state is not wiped.
          </DocP>
        </DocSection>

        <DocSection id="ctf" title="Merge, split & redeem (CTF)">
          <DocP>
            On Polymarket, not every portfolio change is a CLOB trade. The Conditional Token Framework (CTF)
            supports collateral operations that the worker ingests from{" "}
            <code className="text-foreground">GET /activity</code> alongside trades.
          </DocP>
          <DocTable
            monoFirstCol
            headers={["Activity type", "Stored side", "What it does"]}
            rows={[
              ["TRADE", "BUY / SELL", "Order book trade — mirrored with a CLOB limit order"],
              ["MERGE", "MERGE", "Burn equal Yes + No sets → USDC (inverse of split)"],
              ["SPLIT", "SPLIT", "USDC → mint Yes + No pairs"],
              ["REDEEM", "REDEEM", "After resolution — burn tokens for collateral"],
            ]}
          />
          <DocH3>Empty asset on MERGE rows</DocH3>
          <DocP>
            Polymarket’s activity API often returns <code className="text-foreground">asset: ""</code> for
            MERGE/SPLIT/REDEEM. The worker resolves both outcome token IDs from{" "}
            <code className="text-foreground">conditionId</code> via Gamma so rows still appear in the live feed
            and position math stays correct.
          </DocP>
          <DocH3>Why merge matters for copy trading</DocH3>
          <DocP>
            If the leader merges pairs to free cash, their token position drops without a SELL. Ignoring MERGE
            would overstate <code className="text-foreground">leaderPositionBefore</code> and break proportional
            sell/merge fractions. The worker subtracts MERGE (and REDEEM) and adds SPLIT when reconstructing the
            leader book.
          </DocP>
          <DocH3>Live execution</DocH3>
          <DocUl>
            <li>
              <strong className="text-foreground">MERGE</strong> — proportional sets, capped by{" "}
              <code className="text-foreground">min(yesBalance, noBalance)</code>; on-chain{" "}
              <code className="text-foreground">mergePositions</code> on the Polymarket CTF contract.
            </li>
            <li>
              <strong className="text-foreground">SPLIT</strong> — proportional sets from cash ratio;{" "}
              <code className="text-foreground">splitPosition</code> (requires USDC and CTF approval).
            </li>
            <li>
              <strong className="text-foreground">REDEEM</strong> —{" "}
              <code className="text-foreground">redeemPositions</code> for the market condition (contract
              redeems all outcome tokens for that condition; not a partial CLOB sell).
            </li>
          </DocUl>
          <DocCallout variant="warn" title="Neg-risk & approvals">
            <DocP>
              Standard binary markets use the CTF at{" "}
              <code className="text-foreground">0x4D97DCd97eC945f40cF65F87097ACe5EA0476045</code>. Neg-risk
              markets may need the Neg Risk Adapter instead — direct CTF calls can revert until adapter support
              is added.
            </DocP>
            <DocP>
              Ensure your follower wallet has granted the approvals Polymarket expects for split/merge; otherwise
              live CTF mirrors fail with an on-chain error in executions.
            </DocP>
          </DocCallout>
        </DocSection>

        <DocSection id="engine" title="Engine modes (global)">
          <DocTable
            monoFirstCol
            headers={["Mode", "Behavior"]}
            rows={[
              [
                "read_only",
                "Ingest leader activity only. No new mirror_intents. Existing pending intents are marked read_only_mode.",
              ],
              [
                "shadow",
                "Full sizing and planned JSON are written. Orders are not sent — intents end as shadow_mode. Proportional lines use shadow_active (paper only); switching to live resets shadow_active → watching.",
              ],
              [
                "live",
                "Limit orders (GTC) at the leader’s price. Proportional line becomes active only after a confirmed CLOB fill (status filled), not merely posted.",
              ],
            ]}
          />
          <DocH3>Pause and kill-switch</DocH3>
          <DocP>
            When the engine is <strong className="text-foreground">paused</strong>, pending mirror processing
            stops. If <strong className="text-foreground">cancel all on kill</strong> is enabled, entering
            pause also calls <code className="text-foreground">cancelAll</code> on the CLOB to pull open
            orders. Position-follow line state survives pause and read-only — you do not lose “watching” or
            “active” memory unless the line logic itself transitions.
          </DocP>
        </DocSection>

        <DocSection id="sizing" title="Sizing modes (per subscription)">
          <DocTable
            monoFirstCol
            headers={["Mode", "Meaning"]}
            rows={[
              ["fixed_usd", "Fixed USD notional per trade: shares = fixedUsd ÷ price"],
              ["pct_balance", "Fraction of your USDC cash per trade: shares = (balance × pct) ÷ price"],
              ["pct_leader_notional", "Manual % of the leader’s trade size in shares"],
              [
                "proportional_equity",
                "Automatic proportional copy — cash ratio on buys, position fraction on sells (see below)",
              ],
            ]}
          />
          <DocP>
            Subscriptions may also store risk limits. The worker enforces these on{" "}
            <strong className="text-foreground">live</strong> mirrors before posting:
          </DocP>
          <DocUl>
            <li>
              <code className="text-foreground">maxNotionalPerTrade</code> — caps each mirror size (all modes).
            </li>
            <li>
              <code className="text-foreground">maxOrdersPerSecond</code> — per subscription; over limit leaves
              intent <code className="text-foreground">pending</code> for the next tick (not skipped).
            </li>
            <li>
              <code className="text-foreground">maxSlippageBps</code> — compares leader price to CLOB midpoint;
              skips if deviation exceeds cap (default 150 bps).
            </li>
            <li>
              <code className="text-foreground">maxOpenExposureUsd</code> — on BUY, blocks if follower{" "}
              positions value + new notional would exceed cap (Polymarket equity snapshot).
            </li>
            <li>
              <code className="text-foreground">maxDailyLossUsd</code> — on BUY, blocks if follower equity fell
              by at least this amount since UTC midnight (in-memory day start per process).
            </li>
          </DocUl>
          <DocP>
            All sizing modes also share cash caps (~98% of USDC on BUY), $1 minimum BUY notional, and 2-decimal
            share rounding.
          </DocP>
        </DocSection>

        <DocSection id="proportional" title="Proportional following (proportional_equity)">
          <DocCallout variant="note" title="Core idea">
            <DocP>
              If the leader has $1,000 cash and you have $100 cash, your target ratio on{" "}
              <strong className="text-foreground">entries and add-ons</strong> is 10%. On{" "}
              <strong className="text-foreground">exits</strong>, cash ratio is not used — you mirror the
              fraction of the leader’s position they are closing, applied to your position in the same token.
            </DocP>
          </DocCallout>

          <DocH3>BUY — open and add to a position</DocH3>
          <DocP>
            Basis: cash only — leader Polymarket snapshot cash and your USDC collateral on the CLOB.
          </DocP>
          <DocPre>{`ratio = (followerCash × scale) / leaderCash
mirrorShares = leaderBuyShares × ratio`}</DocPre>
          <DocUl>
            <li>
              <code className="text-foreground">scale</code> is stored in the subscription’s pct_balance
              field (default 1, allowed roughly 0.01–10).
            </li>
            <li>
              Then: cap by maxNotionalPerTrade, cap by available cash (~98%), round shares down to 2 decimals.
            </li>
            <li>Minimum ~$1 notional on BUY or the trade is skipped (below_min_notional).</li>
            <li>
              <strong className="text-foreground">Add-on BUY</strong> while the line is already active uses
              the same formula. A failed add-on only skips that trade — the line stays active (not abandoned).
            </li>
          </DocUl>

          <DocH3>SELL — partial or full exit</DocH3>
          <DocPre>{`closeFraction = min(1, leaderSellShares / leaderPositionBefore)
mirrorSellShares = followerPosition × closeFraction`}</DocPre>
          <DocUl>
            <li>
              <code className="text-foreground">leaderPositionBefore</code> — leader net position in this
              token reconstructed from leader_events before the current event (BUY/SPLIT minus
              SELL/MERGE/REDEEM).
            </li>
            <li>
              <code className="text-foreground">followerPosition</code> — your conditional token balance from
              the CLOB.
            </li>
            <li>
              If the leader fully closes (<code className="text-foreground">closeFraction → 1</code>), you
              sell all available position (after rounding and caps).
            </li>
          </DocUl>

          <DocH3>Worked example</DocH3>
          <DocTable
            headers={["Step", "Leader", "You (10% cash ratio)"]}
            rows={[
              ["Buy 100 shares", "100 sh", "10 sh"],
              ["Sell 20 shares", "−20 (20% of book)", "−2 sh (20% of your 10)"],
              ["Close rest", "−80", "−8 sh → follow line closed"],
            ]}
          />

          <DocH3>MERGE, SPLIT, REDEEM (proportional)</DocH3>
          <DocTable
            headers={["Leader side", "Sizing basis", "Live action"]}
            rows={[
              ["MERGE", "Position fraction (like SELL)", "mergePositions — cap by paired token balances"],
              ["REDEEM", "Position fraction (like SELL)", "redeemPositions for conditionId"],
              ["SPLIT", "Cash ratio (like BUY)", "splitPosition — USDC into Yes+No"],
            ]}
          />

          <DocH3>What appears in planned JSON (Dashboard / feed)</DocH3>
          <DocP>
            For audit and UI: activityType, conditionId, sizingBasis (cash_ratio | position_fraction),
            balanceRatio, closeFraction, leaderCash, followerCash, leaderPositionBefore, followerPosition,
            followLineState, cappedBy, rawShares, roundedShares.
          </DocP>
        </DocSection>

        <DocSection id="follow-line" title="Position follow line (proportional only)">
          <DocP>
            For <code className="text-foreground">proportional_equity</code> only, each pair{" "}
            <code className="text-foreground">(subscriptionId, asset)</code> has a line state in{" "}
            <code className="text-foreground">position_follow_state</code>.
          </DocP>

          <DocH3>States</DocH3>
          <DocTable
            monoFirstCol
            headers={["State", "Meaning"]}
            rows={[
              ["untracked", "No follow line for this token yet"],
              ["watching", "Leader opened a BUY; waiting for your successful entry"],
              ["active", "Your entry filled on CLOB; follow add-ons and sells"],
              ["shadow_active", "Shadow only — paper entry; reset when engine goes live"],
              ["abandoned", "Entry failed or impossible — line is not followed until reset"],
              ["closed", "Your position in the token is ~0 after a SELL, MERGE, or REDEEM"],
            ]}
          />

          <DocH3>Transitions (simplified)</DocH3>
          <DocPre>{`untracked/closed + leader BUY       → watching
watching + BUY filled (live)        → active
watching + BUY posted, no fill yet  → stays watching (reconciled each tick)
watching + BUY skip/fail*           → abandoned
watching + shadow_mode (shadow)     → shadow_active (paper)
shadow → live transition            → shadow_active reset to watching
active + SELL/MERGE/REDEEM filled   → active or closed (if remainder ~0)
abandoned + event while leader long → line_abandoned
abandoned + leader flat + BUY       → watching (new line)
untracked/closed/watching + SELL/MERGE/REDEEM → entry_not_established

* rate_limited keeps intent pending; shadow_mode does not abandon`}</DocPre>

          <DocCallout variant="danger" title="Rule: no entry → no line">
            <DocP>
              If your <strong className="text-foreground">first entry</strong> fails while the line is{" "}
              <code className="text-foreground">watching</code> (e.g. size too small, no USDC, leader cash
              zero, below $1 min, CLOB reject), the line becomes <code className="text-foreground">abandoned</code>.
            </DocP>
            <DocP>
              While the leader still holds a position in that token, every later BUY and SELL for that
              subscription is skipped with <code className="text-foreground">line_abandoned</code> — you do not
              copy add-ons or exits on a line you never entered.
            </DocP>
            <DocP>
              Reset: when reconstructed leader position before the trade is ≤ 0 (leader flat) and a new leader
              BUY arrives, the line goes to watching again and a new cycle can start.
            </DocP>
          </DocCallout>

          <DocH3>Late subscription</DocH3>
          <DocP>
            If you create a subscription while the leader is already in a position, the first leader SELL may
            get <code className="text-foreground">entry_not_established</code>. After the leader goes flat, the
            next BUY starts a fresh line.
          </DocP>
        </DocSection>

        <DocSection id="critical-buy" title="Critical situations — entries (BUY)">
          <DocTable
            headers={["Situation", "Reaction"]}
            rows={[
              ["Size too small after rounding", "Skip; if watching → abandoned"],
              ["No follower USDC", "Skip; watching → abandoned"],
              ["Missing or zero leader cash in snapshot", "Skip; watching → abandoned"],
              ["Rate limit", "Intent stays pending; line stays watching (retries next tick)"],
              [
                "Shadow mode",
                "Plan written, skip shadow_mode; proportional → shadow_active (paper line)",
              ],
              ["CLOB rejects order", "failed; watching → abandoned"],
              [
                "Subscription created while leader already in position",
                "First SELL → entry_not_established; after flat, new BUY opens line",
              ],
              ["Add-on fails while active", "Skip only that trade; line stays active"],
            ]}
          />
        </DocSection>

        <DocSection id="critical-sell" title="Critical situations — exits (SELL / MERGE / REDEEM)">
          <DocTable
            headers={["Situation", "Reaction"]}
            rows={[
              ["Line abandoned", "line_abandoned"],
              ["No entry yet (untracked / watching)", "entry_not_established"],
              ["No follower position", "no_position_to_sell"],
              ["Leader position before event = 0", "invalid_leader_position"],
              ["Computed sell larger than your position", "Capped to followerPosition (cappedBy: position)"],
              ["Books out of sync", "Fraction applied to your position; check logs / Dashboard"],
              ["MERGE: missing conditionId", "missing_condition_id"],
              ["MERGE: cannot load outcome token pair", "merge_tokens_unavailable"],
              ["MERGE: pair balances unknown", "merge_pair_balance_unavailable"],
              ["MERGE: not enough Yes and No", "insufficient_merge_pair"],
            ]}
          />
        </DocSection>

        <DocSection id="critical-system" title="Critical situations — system">
          <DocTable
            headers={["Situation", "Reaction"]}
            rows={[
              [
                "Ingestion lag / missed leader activity",
                "leaderPositionBefore can be wrong (including missed MERGE) — monitor feed and reconcile",
              ],
              [
                "posted vs filled",
                "Intent may be posted (on book) or filled. Proportional active only on filled; worker reconciles posted orders each tick",
              ],
              [
                "Stale processing",
                "Intents in processing longer than ~60s return to pending automatically",
              ],
              [
                "Pending queue order",
                "Oldest leader trades processed first (FIFO), up to 40 per tick",
              ],
              ["Pause / read_only", "Follow line state is preserved"],
              ["Multiple subscriptions on same leader", "Independent position_follow_state"],
            ]}
          />
        </DocSection>

        <DocSection id="limits" title="Limits & rounding">
          <DocUl>
            <li>CLOB client rounds size down to 2 decimal places and price to the market tick.</li>
            <li>Worker uses the same round-down so planned JSON matches the order sent.</li>
            <li>Minimum share increment: 0.01 (MIN_SHARES).</li>
            <li>BUY requires at least about $1 notional (below_min_notional otherwise).</li>
            <li>BUY uses up to ~98% of available USDC after sizing (insufficient_cash_for_buy if capped to zero).</li>
            <li>SELL does not enforce the $1 minimum as strictly as BUY.</li>
            <li>Live BUY checks slippage (midpoint vs leader price), open exposure, and daily loss caps when set.</li>
          </DocUl>
          <DocCallout variant="warn" title="Before going live">
            <DocUl>
              <li>Run shadow until planned sizes look correct; shadow line state does not carry into live.</li>
              <li>Set small maxNotionalPerTrade first; enable cancel-all-on-pause.</li>
              <li>Verify POLYMARKET_SIGNATURE_TYPE and funder — wrong values show $0 balance and skips.</li>
              <li>Run exactly one worker process per SQLite file to avoid duplicate orders.</li>
            </DocUl>
          </DocCallout>
        </DocSection>

        <DocSection id="ui" title="Console & API">
          <DocUl>
            <li>
              <strong className="text-foreground">Dashboard</strong> — live feed of leader trades with mirror
              volume, ratio (% cash or % position), result, and skip labels.
            </li>
            <li>
              <strong className="text-foreground">Subscriptions</strong> — create leaders, choose Proportional
              (cash ratio), preview ratio from cash balances.
            </li>
            <li>
              <strong className="text-foreground">Engine</strong> — switch read_only / shadow / live, pause,
              kill-switch options.
            </li>
            <li>
              <strong className="text-foreground">GET /api/feed</strong> — trades with planned payload and
              intent status for the UI.
            </li>
          </DocUl>
          <DocP>
            Telegram (if configured): <code className="text-foreground">/addsub &lt;addr&gt; prop [scale]</code>{" "}
            for proportional subscriptions.
          </DocP>
        </DocSection>

        <DocSection id="skip-codes" title="Skip reason codes (Dashboard)">
          <DocP>When a mirror is skipped or fails, the feed shows a short label. Full list:</DocP>
          <DocTable
            monoFirstCol
            headers={["Code", "Meaning"]}
            rows={[
              ["shadow_mode", "Engine in shadow — planned but not sent"],
              ["read_only_mode", "Engine read-only or intent cancelled on mode change"],
              ["rate_limited", "maxOrdersPerSecond — intent stays pending, retries next tick"],
              ["filled", "CLOB reports size_matched — proportional line may go active"],
              ["max_slippage_exceeded", "Midpoint moved beyond maxSlippageBps vs leader price"],
              ["max_open_exposure_exceeded", "positionsValue + buy would exceed maxOpenExposureUsd"],
              ["max_daily_loss_exceeded", "Equity down more than maxDailyLossUsd since UTC day start"],
              ["equity_snapshot_failed", "Could not load follower equity for risk checks"],
              ["size_too_small", "Below minimum shares after rounding"],
              ["below_min_notional", "BUY under ~$1 notional"],
              ["missing_follower_balance", "Could not read your USDC / cash"],
              ["insufficient_cash_for_buy", "Not enough cash after caps"],
              ["missing_leader_cash", "No leader cash snapshot"],
              ["leader_cash_zero", "Leader cash is zero — ratio undefined"],
              ["line_abandoned", "Proportional line abandoned — not copying until leader flat + new BUY"],
              ["entry_not_established", "SELL or action before a successful proportional entry"],
              ["no_position_to_sell", "Nothing to sell on your side"],
              ["invalid_leader_position", "Leader had no position before this SELL"],
              ["invalid_leader_price", "Bad or missing leader price"],
              ["max_notional_too_small_for_tick", "Cap leaves size below tick/min"],
              ["missing_trading_client", "CLOB client not configured for live"],
              ["unknown_sizing_mode", "Unsupported sizing mode value"],
              ["missing_condition_id", "CTF event without conditionId — cannot merge/split/redeem"],
              ["merge_tokens_unavailable", "Gamma did not return both outcome token IDs"],
              ["merge_pair_balance_unavailable", "Could not read both sides for merge cap"],
              ["insufficient_merge_pair", "Follower lacks paired Yes+No for merge"],
              ["merge_amount_too_small", "Merge sets zero after cap/rounding"],
            ]}
          />
        </DocSection>

        <DocSection id="scope" title="Known limitations">
          <DocUl>
            <li>
              Ingestion polls <code className="text-foreground">/activity</code> (last 100 events, ~2.5s).
              Extended downtime can miss trades or CTF ops and distort position fractions.
            </li>
            <li>
              Daily loss uses follower equity at first live BUY check each UTC day per worker process (not
              persisted across restarts).
            </li>
            <li>Open exposure uses Polymarket positionsValue snapshot, not per-token marks on every market.</li>
            <li>Posted orders that never fill stay posted; line stays watching until fill or manual cancel.</li>
            <li>No portfolio rebalance between leader trades.</li>
            <li>Proportional entries use cash only, not total equity (positions + cash).</li>
            <li>Pause cancelAll runs in the worker only — if the worker is stopped, open orders may remain.</li>
            <li>
              Neg-risk markets may not work with direct CTF merge/split — adapter flow not implemented yet.
            </li>
            <li>
              Live REDEEM calls the contract’s full-condition redeem, not a fractional mirror of leader redeem
              size.
            </li>
          </DocUl>
          <DocP className="text-xs text-muted-foreground/80">
            See also <code className="text-foreground">docs/MEHANIZMY-SLEDOVANIYA.md</code> (Russian, same
            mechanics). Updated for /activity ingestion, MERGE/SPLIT/REDEEM, CTF on-chain mirrors, and
            fill-aware proportional lines.
          </DocP>
        </DocSection>
        </article>
      </div>
    </Page>
  );
}
