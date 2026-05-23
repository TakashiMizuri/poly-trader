import type { ChartBacktestParams, ChartDisplayPrefs } from '@/lib/chartDisplayPrefs'

import {

  CHART_MAX_CANDLES_MAX,

  CHART_MAX_CANDLES_MIN,

  normalizeChartBacktestParams,

  normalizeMaxCandles,

} from '@/lib/chartDisplayPrefs'

import type { BetStakeMode } from '@/types/trendBetStrategy'

import {

  Dialog,

  DialogBody,

  DialogContent,

  DialogDescription,

  DialogHeader,

  DialogTitle,

  DialogClose,

} from '@/components/ui/dialog'

import { Checkbox } from '@/components/ui/checkbox'

import { DraftNumberInput } from '@/components/ui/draft-number-input'

import { Label } from '@/components/ui/label'

import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from '@/components/ui/select'

import { cn } from '@/lib/utils'



interface ChartSettingsDialogProps {

  open: boolean

  prefs: ChartDisplayPrefs

  onPrefsChange: (prefs: ChartDisplayPrefs) => void

  onClose: () => void

}



function patchBacktest(

  prefs: ChartDisplayPrefs,

  patch: Partial<ChartBacktestParams>,

): ChartDisplayPrefs {

  return {

    ...prefs,

    backtest: normalizeChartBacktestParams({ ...prefs.backtest, ...patch }),

  }

}



function overlayLabel(className?: string) {

  return cn(

    'cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:border-muted-foreground/40',

    className,

  )

}



export function ChartSettingsDialog({

  open,

  prefs,

  onPrefsChange,

  onClose,

}: ChartSettingsDialogProps) {

  const bt = prefs.backtest

  const isPercent = bt.betStakeMode === 'percent'



  return (

    <Dialog

      open={open}

      onOpenChange={(next) => {

        if (!next) onClose()

      }}

    >

      <DialogContent className="max-w-md gap-0 p-0" showClose={false}>

        <DialogHeader>

          <div className="min-w-0 pr-10">

            <DialogTitle>Chart settings</DialogTitle>

            <DialogDescription>

              Overlays and BTCUSDT backtest simulation on the chart.

            </DialogDescription>

          </div>

          <DialogClose>Close</DialogClose>

        </DialogHeader>



        <DialogBody className="max-h-[min(70vh,32rem)] overflow-y-auto">

          <div className="flex flex-col gap-4">

            <section>

              <h3 className="text-sm font-medium text-foreground">Chart data</h3>

              <div className="mt-2 space-y-1.5">

                <Label htmlFor="chart-max-candles">Candles on chart</Label>

                <DraftNumberInput

                  id="chart-max-candles"

                  integer

                  value={prefs.maxCandles}

                  onCommit={(next) => {

                    if (next == null) return

                    const normalized = normalizeMaxCandles(next)

                    if (normalized !== prefs.maxCandles) {

                      onPrefsChange({ ...prefs, maxCandles: normalized })

                    }

                  }}

                />

                <p className="text-sm text-muted-foreground">

                  Recent BTCUSDT bars loaded from Binance ({CHART_MAX_CANDLES_MIN}–

                  {CHART_MAX_CANDLES_MAX.toLocaleString()}). Press Enter or click

                  away to apply; changing this reloads history.

                </p>

              </div>

            </section>



            <section className="border-t border-border pt-4">

              <h3 className="text-sm font-medium text-foreground">Overlays</h3>

              <div className="mt-2 flex flex-col gap-2">

                <Label className={overlayLabel()}>

                  <Checkbox

                    className="mt-0.5"

                    checked={prefs.showBetMarkers}

                    onCheckedChange={(checked) =>

                      onPrefsChange({

                        ...prefs,

                        showBetMarkers: checked === true,

                      })

                    }

                  />

                  <span>

                    <span className="block text-sm font-medium text-foreground">

                      Backtest (+/−)

                    </span>

                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">

                      Win/loss markers from the simulation below.

                    </span>

                  </span>

                </Label>



                <Label className={overlayLabel()}>

                  <Checkbox

                    className="mt-0.5"

                    checked={prefs.showEquityCurve}

                    onCheckedChange={(checked) =>

                      onPrefsChange({

                        ...prefs,

                        showEquityCurve: checked === true,

                      })

                    }

                  />

                  <span>

                    <span className="block text-sm font-medium text-foreground">

                      Backtest balance line

                    </span>

                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">

                      Equity curve on the left scale (USD).

                    </span>

                  </span>

                </Label>



                <Label className={overlayLabel()}>

                  <Checkbox

                    className="mt-0.5"

                    checked={prefs.showBacktestStats}

                    onCheckedChange={(checked) =>

                      onPrefsChange({

                        ...prefs,

                        showBacktestStats: checked === true,

                      })

                    }

                  />

                  <span>

                    <span className="block text-sm font-medium text-foreground">

                      Backtest stats panel

                    </span>

                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">

                      Max DD, win rate, and PnL for the loaded candle window.

                    </span>

                  </span>

                </Label>



                <Label className={overlayLabel()}>

                  <Checkbox

                    className="mt-0.5"

                    checked={prefs.showTrends}

                    onCheckedChange={(checked) =>

                      onPrefsChange({

                        ...prefs,

                        showTrends: checked === true,

                      })

                    }

                  />

                  <span>

                    <span className="block text-sm font-medium text-foreground">

                      Trends

                    </span>

                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">

                      Long / short segment highlights.

                    </span>

                  </span>

                </Label>



                <Label className={overlayLabel()}>

                  <Checkbox

                    className="mt-0.5"

                    checked={prefs.showBosOverlay}

                    onCheckedChange={(checked) =>

                      onPrefsChange({

                        ...prefs,

                        showBosOverlay: checked === true,

                      })

                    }

                  />

                  <span>

                    <span className="block text-sm font-medium text-foreground">

                      BoS levels

                    </span>

                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">

                      Bullish / bearish break lines.

                    </span>

                  </span>

                </Label>

              </div>

            </section>



            <section className="border-t border-border pt-4">

              <h3 className="text-sm font-medium text-foreground">

                Simulation parameters

              </h3>

              <p className="mt-0.5 text-sm text-muted-foreground">

                Used for the balance line and (+/−) markers. Strategy signals stay

                fixed (blend_fade2). Press Enter or click away to apply numeric

                fields.

              </p>



              <div className="mt-3 grid gap-3 sm:grid-cols-2">

                <div className="space-y-1.5 sm:col-span-2">

                  <Label htmlFor="chart-start-balance">Starting balance</Label>

                  <DraftNumberInput

                    id="chart-start-balance"

                    prefix="$"

                    value={bt.startBalance}

                    onCommit={(next) => {

                      if (next == null) return

                      onPrefsChange(patchBacktest(prefs, { startBalance: next }))

                    }}

                  />

                </div>



                <div className="space-y-1.5">

                  <Label htmlFor="chart-stake-mode">Stake mode</Label>

                  <Select

                    value={bt.betStakeMode}

                    onValueChange={(v) =>

                      onPrefsChange(

                        patchBacktest(prefs, {

                          betStakeMode: v as BetStakeMode,

                        }),

                      )

                    }

                  >

                    <SelectTrigger id="chart-stake-mode">

                      <SelectValue />

                    </SelectTrigger>

                    <SelectContent align="start">

                      <SelectItem value="percent">% of balance</SelectItem>

                      <SelectItem value="fixed">Fixed USD</SelectItem>

                    </SelectContent>

                  </Select>

                </div>



                <div className="space-y-1.5">

                  <Label htmlFor="chart-stake-amount">

                    {isPercent ? 'Stake per bet' : 'Fixed stake'}

                  </Label>

                  <DraftNumberInput

                    key={isPercent ? 'betStakePercent' : 'betStake'}

                    id="chart-stake-amount"

                    prefix={isPercent ? undefined : '$'}

                    suffix={isPercent ? '%' : undefined}

                    value={isPercent ? bt.betStakePercent : bt.betStake}

                    onCommit={(next) => {

                      if (next == null) return

                      onPrefsChange(

                        patchBacktest(

                          prefs,

                          isPercent

                            ? { betStakePercent: next }

                            : { betStake: next },

                        ),

                      )

                    }}

                  />

                </div>



                <div className="space-y-1.5">

                  <Label htmlFor="chart-max-stake">Max stake (cap)</Label>

                  <DraftNumberInput

                    id="chart-max-stake"

                    prefix="$"

                    placeholder="No cap"

                    allowEmpty

                    value={bt.maxBetStakeUsd}

                    onCommit={(next) =>

                      onPrefsChange(patchBacktest(prefs, { maxBetStakeUsd: next }))

                    }

                  />

                </div>



                <div className="space-y-1.5">

                  <Label htmlFor="chart-commission">Commission</Label>

                  <DraftNumberInput

                    id="chart-commission"

                    suffix="%"

                    value={bt.commissionPercent}

                    onCommit={(next) => {

                      if (next == null) return

                      onPrefsChange(

                        patchBacktest(prefs, { commissionPercent: next }),

                      )

                    }}

                  />

                </div>

              </div>

            </section>

          </div>

        </DialogBody>

      </DialogContent>

    </Dialog>

  )

}


