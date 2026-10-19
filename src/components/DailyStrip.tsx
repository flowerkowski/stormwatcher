import {
  CalendarDays,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Sun,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { DailyForecast } from '@/types/weather'
import { codeInfo, formatDay } from '@/lib/weather'

function DayIcon({ kind }: { kind: string }) {
  const cls = 'h-5 w-5 shrink-0'
  const props = { className: cls, strokeWidth: 1.6 as const }
  switch (kind) {
    case 'clear':
      return <Sun {...props} className={`${cls} text-yellow-300`} />
    case 'partly':
      return <CloudSun {...props} className={`${cls} text-amber-200`} />
    case 'cloud':
      return <Cloud {...props} className={`${cls} text-slate-300`} />
    case 'fog':
      return <CloudFog {...props} className={`${cls} text-slate-400`} />
    case 'drizzle':
      return <CloudDrizzle {...props} className={`${cls} text-sky-300`} />
    case 'rain':
    case 'freezing':
    case 'showers':
      return <CloudRain {...props} className={`${cls} text-sky-400`} />
    case 'snow':
      return <CloudSnow {...props} className={`${cls} text-cyan-200`} />
    case 'storm':
      return <CloudLightning {...props} className={`${cls} text-violet-300`} />
    default:
      return <Cloud {...props} className={`${cls} text-slate-300`} />
  }
}

export default function DailyStrip({
  daily,
  timeZone,
}: {
  daily: DailyForecast[]
  timeZone: string
}) {
  const weekMin = daily.length ? Math.min(...daily.map((d) => d.tempMin)) : 0
  const weekMax = daily.length ? Math.max(...daily.map((d) => d.tempMax)) : 20
  const span = Math.max(1, weekMax - weekMin)

  return (
    <section aria-label="7-day forecast" className="app-enter space-y-2.5 [animation-delay:250ms]">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-display flex items-center gap-2 text-sm font-semibold tracking-tight text-slate-200">
          <CalendarDays className="h-4 w-4 text-sky-400" />
          7-Day Synoptic Outlook
        </h2>
        <span className="font-mono text-[11px] text-slate-400">
          Week range {Math.round(weekMin)}°C → {Math.round(weekMax)}°C
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {daily.map((d, i) => {
          const info = codeInfo(d.code)
          const isStorm = info.kind === 'storm'
          const wet = d.precipProbMax >= 40
          const dateNum = d.date.toLocaleDateString([], {
            day: 'numeric',
            month: 'short',
            timeZone,
          })
          const leftPct = Math.max(0, Math.min(100, ((d.tempMin - weekMin) / span) * 100))
          const widthPct = Math.max(10, Math.min(100 - leftPct, ((d.tempMax - d.tempMin) / span) * 100))

          return (
            <Card
              key={i}
              className={`instrument-panel rounded-xl border text-white backdrop-blur-xl transition-colors ${
                isStorm
                  ? 'border-violet-400/40 bg-violet-500/[0.08]'
                  : wet
                    ? 'border-sky-400/30 bg-sky-500/[0.07]'
                    : 'border-white/10'
              }`}
            >
              <CardContent className="flex flex-col justify-between gap-2.5 p-3.5">
                <div className="flex items-center justify-between gap-1">
                  <div>
                    <p className="font-display text-xs font-bold tracking-wide text-white uppercase">
                      {i === 0 ? 'Today' : formatDay(d.date, timeZone)}
                    </p>
                    <p className="font-mono text-[10px] text-slate-400">{dateNum}</p>
                  </div>
                  <DayIcon kind={info.kind} />
                </div>

                <p className="truncate text-[11px] text-slate-300" title={info.label}>
                  {info.label}
                </p>

                {/* Normalized temperature bar */}
                <div className="space-y-1">
                  <div className="font-mono flex items-center justify-between text-xs tabular-nums">
                    <span className="text-slate-400">{Math.round(d.tempMin)}°</span>
                    <span className="font-semibold text-white">{Math.round(d.tempMax)}°</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900/90">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 via-teal-300 to-amber-300"
                      style={{ marginLeft: `${leftPct}%`, width: `${widthPct}%` }}
                    />
                  </div>
                </div>

                {/* Precipitation probability + daily mm sum */}
                <div className="flex items-center justify-between border-t border-white/10 pt-2 font-mono text-[11px] tabular-nums">
                  <span
                    className={`flex items-center gap-1 font-medium ${
                      d.precipProbMax >= 60
                        ? 'text-sky-300'
                        : d.precipProbMax >= 30
                          ? 'text-slate-300'
                          : 'text-slate-500'
                    }`}
                  >
                    <Droplets className="h-3 w-3 shrink-0" />
                    {d.precipProbMax}%
                  </span>
                  <span className="text-[10px] text-cyan-300/90">
                    {d.precipSum >= 0.1 ? `${d.precipSum.toFixed(1)}mm` : '0mm'}
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
