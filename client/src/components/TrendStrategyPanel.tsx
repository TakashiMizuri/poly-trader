import { useMemo, useState } from 'react'
import type { BetStakeMode, TrendBetStrategyParams } from '@/types/trendBetStrategy'
import {
  computeBetPnl,
  type TrendBetSimulation,
} from '@/utils/chart/simulateTrendBetStrategy'
import { resolveRequestedBetStake } from '@/utils/chart/safeBetStake'
import { cn } from '@/lib/utils'

export interface ChartLayerVisibility {
  bosOverlay: boolean
  betMarkers: boolean
  equityCurve: boolean
  engineMarkers: boolean
}

export const DEFAULT_CHART_LAYERS: ChartLayerVisibility = {
  bosOverlay: true,
  betMarkers: true,
  equityCurve: true,
  engineMarkers: true,
}

const LAYERS_STORAGE_KEY = 'poly-trader-chart-layers'

const inputClass =
  'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground'

const formatMoney = (value: number) =>
  `${value >= 0 ? '' : '-'}$${Math.abs(value).toFixed(2)}`

const formatSigned = (value: number) =>
  `${value >= 0 ? '+' : ''}$${value.toFixed(2)}`

const EXHAUSTION_FADE_DESCRIPTION =
  'Bet when BoS trend is long and last N closed bars are bullish (short), or mirror for short trend.'

export function loadChartLayers(): ChartLayerVisibility {
  try {
    const raw = localStorage.getItem(LAYERS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CHART_LAYERS }
    const parsed = JSON.parse(raw) as Partial<ChartLayerVisibility>
    return { ...DEFAULT_CHART_LAYERS, ...parsed }
  } catch {
    return { ...DEFAULT_CHART_LAYERS }
  }
}

export function saveChartLayers(layers: ChartLayerVisibility): void {
  try {
    localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(layers))
  } catch {
    // ignore
  }
}

interface TrendStrategyPanelProps {
  simulation: TrendBetSimulation
  candleCount: number
  params: TrendBetStrategyParams
  onParamsChange: (params: TrendBetStrategyParams) => void
  layers: ChartLayerVisibility
  onLayersChange: (layers: ChartLayerVisibility) => void
}

export function TrendStrategyPanel({
  simulation,
  candleCount,
  params,
  onParamsChange,
  layers,
  onLayersChange,
}: TrendStrategyPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const isProfit = simulation.netPnl >= 0

  const exampleStake = useMemo(
    () => resolveRequestedBetStake(params.startBalance, params),
    [params],
  )

  const feePerBet = useMemo(
    () => exampleStake * (params.commissionPercent / 100),
    [exampleStake, params.commissionPercent],
  )

  const exampleWin = useMemo(
    () => computeBetPnl(true, exampleStake, params.commissionPercent).pnl,
    [exampleStake, params.commissionPercent],
  )

  const patchParam = <K extends keyof TrendBetStrategyParams>(
    key: K,
    raw: string,
  ) => {
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value)) return
    onParamsChange({ ...params, [key]: value })
  }

  const patchBool = (key: 'bosBodyBreakOnly', checked: boolean) => {
    onParamsChange({ ...params, [key]: checked })
  }

  const patchBetStakeMode = (mode: BetStakeMode) => {
    onParamsChange({ ...params, betStakeMode: mode })
  }

  const patchBetStakeValue = (raw: string) => {
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value)) return
    if (params.betStakeMode === 'percent') {
      onParamsChange({ ...params, betStakePercent: value })
    } else {
      onParamsChange({ ...params, betStake: value })
    }
  }

  const patchLayer = (key: keyof ChartLayerVisibility, checked: boolean) => {
    onLayersChange({ ...layers, [key]: checked })
  }

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-3 left-3 z-20 flex max-h-[min(88vh,780px)] w-[min(calc(100%-1.5rem),520px)] flex-col overflow-hidden rounded-xl border border-border/80 bg-card/97 text-card-foreground shadow-xl backdrop-blur-md',
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-foreground">
            Exhaustion fade · 5m
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {candleCount} bars · bet at open → win if close vs open matches side
          </p>
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
            Causal: signal uses only prior closed bars; bar high/low/close are not
            used until settlement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          aria-expanded={!collapsed}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <section className="mt-3 rounded-lg border border-border/60 bg-muted/25 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Chart layers
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(
                [
                  ['bosOverlay', 'BoS & trend bands'],
                  ['betMarkers', 'Backtest bets (+/−)'],
                  ['equityCurve', 'Equity curve'],
                  ['engineMarkers', 'Engine trades (L/S)'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(e) => patchLayer(key, e.target.checked)}
                    className="size-3.5 accent-primary"
                  />
                  <span className="text-xs text-foreground">{label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="mt-3 rounded-lg border border-border/60 bg-muted/25 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Simulation parameters
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs text-muted-foreground">
                Initial balance ($)
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={params.startBalance}
                  onChange={(e) => patchParam('startBalance', e.target.value)}
                  className={inputClass}
                />
              </label>
              <div className="block text-xs text-muted-foreground sm:col-span-2">
                <span className="block">Bet size</span>
                <div className="mt-1 flex gap-2">
                  <select
                    value={params.betStakeMode}
                    onChange={(e) => patchBetStakeMode(e.target.value as BetStakeMode)}
                    className="w-[min(42%,9rem)] shrink-0 rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
                  >
                    <option value="fixed">Fixed $</option>
                    <option value="percent">% balance</option>
                  </select>
                  <input
                    type="number"
                    min={params.betStakeMode === 'percent' ? 0.01 : 0.01}
                    max={params.betStakeMode === 'percent' ? 100 : undefined}
                    step={params.betStakeMode === 'percent' ? 0.1 : 0.01}
                    value={
                      params.betStakeMode === 'percent'
                        ? params.betStakePercent
                        : params.betStake
                    }
                    onChange={(e) => patchBetStakeValue(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
                  />
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {params.betStakeMode === 'percent' ? (
                    <>
                      Compound: {params.betStakePercent}% of current balance each bet
                      (e.g. ${exampleStake.toFixed(2)} at start balance).
                    </>
                  ) : (
                    <>Fixed ${params.betStake.toFixed(2)} per bet.</>
                  )}
                </p>
              </div>
              <label className="block text-xs text-muted-foreground">
                Structure lookback (bars)
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={params.structureLookback}
                  onChange={(e) => patchParam('structureLookback', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Consecutive bars (exhaustion)
                <input
                  type="number"
                  min={2}
                  max={20}
                  step={1}
                  value={params.exhaustionConsecutiveBars}
                  onChange={(e) =>
                    patchParam('exhaustionConsecutiveBars', e.target.value)
                  }
                  className={inputClass}
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Min bars between BoS flips
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={params.bosMinBarsBetweenFlips}
                  onChange={(e) =>
                    patchParam('bosMinBarsBetweenFlips', e.target.value)
                  }
                  className={inputClass}
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Min bars in segment before flip
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={params.bosMinSegmentBars}
                  onChange={(e) => patchParam('bosMinSegmentBars', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-xs text-muted-foreground sm:col-span-2">
                Commission (% of stake)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={params.commissionPercent}
                  onChange={(e) => patchParam('commissionPercent', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                <input
                  type="checkbox"
                  checked={params.bosBodyBreakOnly}
                  onChange={(e) => patchBool('bosBodyBreakOnly', e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                BoS break on body only (not wick)
              </label>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Fee per bet: {formatMoney(feePerBet)} · Example win net:{' '}
              {formatSigned(exampleWin)}
            </p>
          </section>

          <section className="mt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Backtest statistics
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Start</p>
                <p className="font-medium tabular-nums">
                  ${simulation.startBalance.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">End</p>
                <p
                  className={cn(
                    'font-semibold tabular-nums',
                    isProfit ? 'text-primary' : 'text-destructive',
                  )}
                >
                  ${simulation.endBalance.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net P/L</p>
                <p
                  className={cn(
                    'font-semibold tabular-nums',
                    isProfit ? 'text-primary' : 'text-destructive',
                  )}
                >
                  {formatSigned(simulation.netPnl)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Win rate</p>
                <p className="font-medium tabular-nums">
                  {simulation.winRate.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Bets</p>
                <p className="tabular-nums">
                  {simulation.totalBets}{' '}
                  <span className="text-muted-foreground">
                    ({simulation.wins}W / {simulation.losses}L)
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Max drawdown</p>
                <p className="tabular-nums text-destructive">
                  {formatMoney(simulation.maxDrawdown)} (
                  {simulation.maxDrawdownPct.toFixed(1)}%)
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Skipped bars</p>
                <p className="tabular-nums">{simulation.skippedBars}</p>
              </div>
            </div>
          </section>

          <div className="mt-3 rounded-lg border border-border/50 bg-muted/30 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              By trend side
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-primary">Long (bet up)</p>
                <p className="tabular-nums">
                  {simulation.longStats.wins}W / {simulation.longStats.losses}L ·{' '}
                  {formatSigned(simulation.longStats.netPnl)}
                </p>
              </div>
              <div>
                <p className="text-destructive">Short (bet down)</p>
                <p className="tabular-nums">
                  {simulation.shortStats.wins}W / {simulation.shortStats.losses}L ·{' '}
                  {formatSigned(simulation.shortStats.netPnl)}
                </p>
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {EXHAUSTION_FADE_DESCRIPTION} Settles at bar close; next entry only when
            the strategy signals.
          </p>

          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent bets
            </p>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-border/50">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-2 py-1.5">Trend</th>
                    <th className="px-2 py-1.5">O→C</th>
                    <th className="px-2 py-1.5">P/L</th>
                    <th className="px-2 py-1.5">Bal</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.bets.slice(-16).map((bet) => (
                    <tr key={bet.time} className="border-t border-border/30">
                      <td className="px-2 py-1">
                        <span
                          className={
                            bet.trend === 'long' ? 'text-primary' : 'text-destructive'
                          }
                        >
                          {bet.trend === 'long' ? '↑' : '↓'}
                        </span>
                      </td>
                      <td className="px-2 py-1 tabular-nums text-muted-foreground">
                        {bet.open.toFixed(2)}→{bet.close.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-1 tabular-nums',
                          bet.won ? 'text-primary' : 'text-destructive',
                        )}
                      >
                        {formatSigned(bet.pnl)}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        ${bet.balanceAfter.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
