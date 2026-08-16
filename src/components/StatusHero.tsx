import {
  CloudLightning,
  CloudRain,
  Droplets,
  ShieldCheck,
  Thermometer,
  Wind,
} from 'lucide-react'
import type { AlertEvent, SkyStatus, WeatherBundle } from '@/types/weather'
import { codeInfo, formatEta, formatHour } from '@/lib/weather'

const STATUS_STYLE: Record<
  SkyStatus,
  { ring: string; glow: string; iconBg: string; accent: string }
> = {
  storm: {
    ring: 'border-violet-400/40',
    glow: 'shadow-[0_0_80px_-20px_rgba(167,139,250,0.5)]',
    iconBg: 'bg-violet-500/20 text-violet-200',
    accent: 'text-violet-300',
  },
  rain: {
    ring: 'border-amber-400/40',
    glow: 'shadow-[0_0_80px_-20px_rgba(251,191,36,0.4)]',
    iconBg: 'bg-amber-500/20 text-amber-200',
    accent: 'text-amber-300',
  },
  clear: {
    ring: 'border-emerald-400/30',
    glow: 'shadow-[0_0_80px_-20px_rgba(52,211,153,0.35)]',
    iconBg: 'bg-emerald-500/15 text-emerald-200',
    accent: 'text-emerald-300',
  },
}

function headline(
  status: SkyStatus,
  next: AlertEvent | undefined,
  timeZone: string,
): { title: string; sub: string } {
  if (status === 'storm' && next) {
    return next.ongoing
      ? { title: 'Thunderstorm overhead', sub: 'Storm conditions right now — stay indoors and away from windows.' }
      : {
          title: 'Storm approaching',
          sub: `Thunderstorm expected ${formatEta(next.startsInMin)} (around ${formatHour(next.start, timeZone)}).`,
        }
  }
  if (status === 'rain' && next) {
    return next.ongoing
      ? {
          title: 'Raining now',
          sub: `Wet conditions ongoing — expected to ease around ${formatHour(next.end, timeZone)}.`,
        }
      : {
          title: 'Rain on the way',
          sub: `${next.level === 'heavy' ? 'Heavy rain' : 'Rain'} expected ${formatEta(next.startsInMin)} (around ${formatHour(next.start, timeZone)}).`,
        }
  }
  return {
    title: 'All clear',
    sub: 'No rain or storms expected in the next 48 hours.',
  }
}

export default function StatusHero({ data, status }: { data: WeatherBundle; status: SkyStatus }) {
  const style = STATUS_STYLE[status]
  const next = status === 'storm' ? data.events.find((event) => event.level === 'storm') : data.events[0]
  const { title, sub } = headline(status, next, data.timeZone)
  const info = codeInfo(data.current.code)

  const Icon = status === 'storm' ? CloudLightning : status === 'rain' ? CloudRain : ShieldCheck

  const chips = [
    { icon: Thermometer, label: `${Math.round(data.current.temp)}°C`, sub: `feels ${Math.round(data.current.feelsLike)}°` },
    { icon: Wind, label: `${Math.round(data.current.windGusts)} km/h`, sub: 'wind gusts' },
    { icon: Droplets, label: `${Math.round(data.current.humidity)}%`, sub: 'humidity' },
  ]

  return (
    <section
      aria-live="polite"
      className={`app-enter relative overflow-hidden rounded-3xl border bg-white/[0.04] backdrop-blur-xl ${style.ring} ${style.glow}`}
    >
      <div className="flex flex-col gap-8 p-8 md:flex-row md:items-center md:justify-between md:p-10">
        <div className="flex items-start gap-5">
          <div
            key={status}
            className={`app-pop flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl md:h-20 md:w-20 ${style.iconBg}`}
          >
            <Icon className="h-9 w-9 md:h-11 md:w-11" strokeWidth={1.6} />
          </div>
          <div>
            <p className={`text-xs font-semibold tracking-[0.25em] uppercase ${style.accent}`}>
              {info.label} · live status
            </p>
            <h1 className="mt-1 text-4xl font-bold tracking-tight text-white md:text-5xl">
              {title}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300/90 md:text-base">
              {sub}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 md:w-80">
          {chips.map((c) => (
            <div
              key={c.sub}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-center backdrop-blur"
            >
              <c.icon className="mx-auto h-4 w-4 text-slate-400" />
              <p className="mt-1.5 text-lg leading-none font-semibold text-white tabular-nums">
                {c.label}
              </p>
              <p className="mt-1 text-[10px] tracking-wide text-slate-400 uppercase">{c.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* severity ticker for the first upcoming event */}
      {next && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-white/10 bg-black/20 px-8 py-3 text-xs text-slate-300 md:px-10">
          <span className="font-semibold text-white">
            Next event: {next.level === 'storm' ? 'Thunderstorm' : next.level === 'heavy' ? 'Heavy rain' : 'Rain'}
          </span>
          <span>
            {next.ongoing ? 'Now' : formatHour(next.start, data.timeZone)} →{' '}
            {formatHour(next.end, data.timeZone)} ({next.hours} h)
          </span>
          <span>Peak probability {next.peakProb}%</span>
          {next.totalMm > 0.1 && <span>~{next.totalMm.toFixed(1)} mm expected</span>}
          {next.maxGusts >= 40 && <span>Gusts up to {Math.round(next.maxGusts)} km/h</span>}
        </div>
      )}
    </section>
  )
}
