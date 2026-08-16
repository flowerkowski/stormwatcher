import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { DailyForecast } from '@/types/weather'
import { codeInfo, formatDay } from '@/lib/weather'

function DayIcon({ kind }: { kind: string }) {
  const cls = 'h-6 w-6'
  const props = { className: cls, strokeWidth: 1.5 as const }
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
  return (
    <div className="app-enter [animation-delay:250ms]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {daily.map((d, i) => {
          const info = codeInfo(d.code)
          const wet = d.precipProbMax >= 40
          return (
            <Card
              key={i}
              className={`border-white/10 text-white backdrop-blur-xl transition-colors ${
                wet ? 'bg-sky-500/[0.08]' : 'bg-white/[0.04]'
              }`}
            >
              <CardContent className="flex flex-col items-center gap-1.5 p-4">
                <p className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
                  {i === 0 ? 'Today' : formatDay(d.date, timeZone)}
                </p>
                <DayIcon kind={info.kind} />
                <p className="text-sm font-semibold tabular-nums">
                  {Math.round(d.tempMax)}°
                  <span className="ml-1.5 font-normal text-slate-400">{Math.round(d.tempMin)}°</span>
                </p>
                <p
                  className={`text-[11px] font-medium tabular-nums ${
                    d.precipProbMax >= 60
                      ? 'text-sky-300'
                      : d.precipProbMax >= 30
                        ? 'text-slate-300'
                        : 'text-slate-500'
                  }`}
                >
                  💧 {d.precipProbMax}%
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
