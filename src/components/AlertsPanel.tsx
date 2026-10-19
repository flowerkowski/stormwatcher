import { CloudLightning, CloudRain, CloudSun, ShieldAlert, Umbrella } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AlertEvent, AlertSettings, HourPoint } from '@/types/weather'
import { formatEta, formatHour } from '@/lib/weather'

const LEVEL_META = {
  storm: {
    icon: CloudLightning,
    chip: 'bg-violet-500/15 text-violet-300 border-violet-400/35',
    label: 'STORM',
    bar: 'bg-violet-400',
  },
  heavy: {
    icon: CloudRain,
    chip: 'bg-amber-500/15 text-amber-300 border-amber-400/35',
    label: 'HEAVY RAIN',
    bar: 'bg-amber-400',
  },
  rain: {
    icon: Umbrella,
    chip: 'bg-sky-500/15 text-sky-300 border-sky-400/35',
    label: 'RAIN',
    bar: 'bg-sky-400',
  },
} as const

export default function AlertsPanel({
  events,
  timeZone,
  hours,
  settings,
}: {
  events: AlertEvent[]
  timeZone: string
  hours?: HourPoint[]
  settings?: AlertSettings
}) {
  const maxProb48h =
    hours && hours.length > 0 ? Math.round(Math.max(...hours.map((h) => h.precipProb))) : null

  return (
    <div className="app-enter h-full [animation-delay:150ms]">
      <Card className="instrument-panel flex h-full flex-col rounded-2xl border-white/10 text-white backdrop-blur-xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base font-semibold">
            <span className="font-display flex items-center gap-2 tracking-tight">
              <ShieldAlert className="h-4 w-4 text-sky-400" />
              Forecast alerts
            </span>
            <span className="font-mono rounded-md border border-white/10 bg-slate-950/70 px-2.5 py-0.5 text-xs font-semibold text-slate-300 tabular-nums">
              {events.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-80 flex-1 space-y-2.5 overflow-y-auto pr-2">
          {events.length === 0 && (
            <div className="instrument-well flex flex-col items-center gap-2.5 rounded-xl border border-white/10 px-4 py-8 text-center">
              <CloudSun className="h-9 w-9 text-emerald-300/80" strokeWidth={1.5} />
              <p className="font-display text-sm font-semibold text-slate-200">
                No enabled forecast alerts
              </p>
              <p className="max-w-56 text-xs leading-relaxed text-slate-400">
                No events match your enabled alert types and thresholds. We'll keep watching.
              </p>
              {maxProb48h !== null && settings && (
                <div className="mt-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-slate-300">
                  48h peak prob <strong className="text-sky-300">{maxProb48h}%</strong> · threshold{' '}
                  <strong className="text-amber-300">≥ {settings.rainThreshold}%</strong>
                </div>
              )}
            </div>
          )}
          {events.map((e, i) => {
            const meta = LEVEL_META[e.level]
            const Icon = meta.icon
            return (
              <div
                key={e.id}
                className="app-enter instrument-well relative overflow-hidden rounded-xl border border-white/10 p-3.5 transition-colors hover:border-white/20"
                style={{ animationDelay: `${200 + i * 60}ms` }}
              >
                <div className={`absolute inset-y-0 left-0 w-1 ${meta.bar}`} />
                <div className="flex items-start justify-between gap-3 pl-1.5">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${meta.chip}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-sm leading-tight font-semibold text-white">
                        {e.level === 'storm'
                          ? 'Thunderstorm'
                          : e.level === 'heavy'
                            ? 'Heavy rain'
                            : 'Rain'}
                        <span className="font-mono ml-2 text-xs font-normal text-slate-400">
                          {e.ongoing ? 'now' : formatEta(e.startsInMin)}
                        </span>
                      </p>
                      <p className="font-mono mt-1 text-[11px] text-slate-400">
                        {e.ongoing ? 'Started' : formatHour(e.start, timeZone)} →{' '}
                        {formatHour(e.end, timeZone)}
                        {e.hours > 1 && ` · ~${e.hours} h`}
                      </p>
                      <div className="font-mono mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-300">
                        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
                          {e.peakProb}% peak
                        </span>
                        {e.totalMm > 0.1 && (
                          <span className="rounded border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-200">
                            {e.totalMm.toFixed(1)} mm
                          </span>
                        )}
                        {e.maxGusts >= 40 && (
                          <span className="rounded border border-amber-400/25 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
                            gusts {Math.round(e.maxGusts)} km/h
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`font-mono shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${meta.chip}`}
                  >
                    {meta.label}
                  </span>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
