import { CloudLightning, CloudRain, CloudSun, Umbrella } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AlertEvent } from '@/types/weather'
import { formatEta, formatHour } from '@/lib/weather'

const LEVEL_META = {
  storm: {
    icon: CloudLightning,
    chip: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
    label: 'STORM',
    bar: 'bg-violet-400',
  },
  heavy: {
    icon: CloudRain,
    chip: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
    label: 'HEAVY RAIN',
    bar: 'bg-amber-400',
  },
  rain: {
    icon: Umbrella,
    chip: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
    label: 'RAIN',
    bar: 'bg-sky-400',
  },
} as const

export default function AlertsPanel({
  events,
  timeZone,
}: {
  events: AlertEvent[]
  timeZone: string
}) {
  return (
    <div className="app-enter h-full [animation-delay:150ms]">
      <Card className="h-full border-white/10 bg-white/[0.04] text-white backdrop-blur-xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base font-semibold">
            <span>Forecast alerts</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-slate-300">
              {events.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-80 space-y-3 overflow-y-auto pr-2">
          {events.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CloudSun className="h-10 w-10 text-emerald-300/70" strokeWidth={1.4} />
              <p className="text-sm font-medium text-slate-200">Nothing on the radar</p>
              <p className="max-w-52 text-xs leading-relaxed text-slate-400">
                No rain or storms expected in the next 48 hours. We'll keep watching.
              </p>
            </div>
          )}
          {events.map((e, i) => {
            const meta = LEVEL_META[e.level]
            const Icon = meta.icon
            return (
              <div
                key={e.id}
                className="app-enter relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-3.5"
                style={{ animationDelay: `${200 + i * 60}ms` }}
              >
                <div className={`absolute inset-y-0 left-0 w-1 ${meta.bar}`} />
                <div className="flex items-start justify-between gap-3 pl-1.5">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${meta.chip}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm leading-tight font-semibold text-white">
                        {e.level === 'storm'
                          ? 'Thunderstorm'
                          : e.level === 'heavy'
                            ? 'Heavy rain'
                            : 'Rain'}
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          {e.ongoing ? 'now' : formatEta(e.startsInMin)}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {e.ongoing ? 'Started' : formatHour(e.start, timeZone)} →{' '}
                        {formatHour(e.end, timeZone)}
                        {e.hours > 1 && ` · ~${e.hours} h`}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-300">
                        <span>{e.peakProb}% peak</span>
                        {e.totalMm > 0.1 && <span>{e.totalMm.toFixed(1)} mm</span>}
                        {e.maxGusts >= 40 && <span>gusts {Math.round(e.maxGusts)} km/h</span>}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${meta.chip}`}
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
