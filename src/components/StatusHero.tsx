import {
  Clock,
  CloudLightning,
  CloudRain,
  Droplets,
  ShieldCheck,
  SunMedium,
  Thermometer,
  Wind,
} from 'lucide-react'
import type { AlertEvent, SkyStatus, WeatherBundle } from '@/types/weather'
import {
  codeInfo,
  computeDryWindow,
  computeNext24hSummary,
  formatEta,
  formatHour,
} from '@/lib/weather'

const STATUS_STYLE: Record<
  SkyStatus,
  {
    ring: string
    glow: string
    iconBg: string
    accent: string
    badge: string
    strip: string
  }
> = {
  storm: {
    ring: 'border-violet-400/45',
    glow: 'shadow-[0_0_90px_-24px_rgba(167,139,250,0.55)]',
    iconBg: 'border-violet-400/40 bg-violet-500/20 text-violet-200',
    accent: 'text-violet-300',
    badge: 'border-violet-400/35 bg-violet-500/15 text-violet-200',
    strip: 'from-violet-500/90 via-fuchsia-500/60 to-transparent',
  },
  rain: {
    ring: 'border-amber-400/40',
    glow: 'shadow-[0_0_90px_-24px_rgba(251,191,36,0.42)]',
    iconBg: 'border-amber-400/40 bg-amber-500/20 text-amber-200',
    accent: 'text-amber-300',
    badge: 'border-amber-400/35 bg-amber-500/15 text-amber-200',
    strip: 'from-amber-400/90 via-sky-400/60 to-transparent',
  },
  clear: {
    ring: 'border-emerald-400/30',
    glow: 'shadow-[0_0_90px_-28px_rgba(52,211,153,0.35)]',
    iconBg: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200',
    accent: 'text-emerald-300',
    badge: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
    strip: 'from-emerald-400/80 via-sky-400/40 to-transparent',
  },
}

function headline(
  status: SkyStatus,
  next: AlertEvent | undefined,
  timeZone: string,
): { title: string; sub: string } {
  if (status === 'storm' && next) {
    return next.ongoing
      ? {
          title: 'Thunderstorms forecast now',
          sub: 'Check local observations and official weather warnings.',
        }
      : {
          title: 'Storm approaching',
          sub: `Thunderstorm expected ${formatEta(next.startsInMin)} (around ${formatHour(next.start, timeZone)}).`,
        }
  }
  if (status === 'rain' && next) {
    return next.ongoing
      ? {
          title: 'Rain forecast now',
          sub: `Wet conditions forecast — expected to ease around ${formatHour(next.end, timeZone)}.`,
        }
      : {
          title: 'Rain on the way',
          sub: `${next.level === 'heavy' ? 'Heavy rain' : 'Rain'} expected ${formatEta(next.startsInMin)} (around ${formatHour(next.start, timeZone)}).`,
        }
  }
  return {
    title: 'No forecast alerts',
    sub: 'No rain or storms meet your alert thresholds in the next 48 hours.',
  }
}

export default function StatusHero({ data, status }: { data: WeatherBundle; status: SkyStatus }) {
  const style = STATUS_STYLE[status]
  const next =
    status === 'storm' ? data.events.find((event) => event.level === 'storm') : data.events[0]
  const { title, sub } = headline(status, next, data.timeZone)
  const info = codeInfo(data.current.code)
  const dryWindow = computeDryWindow(data.hours)
  const summary24h = computeNext24hSummary(data.hours)
  const next12Hours = data.hours.slice(0, 12)

  const Icon = status === 'storm' ? CloudLightning : status === 'rain' ? CloudRain : ShieldCheck

  const dryCalloutText = (() => {
    if (!dryWindow) return 'Continuous wet conditions across the 48h window'
    if (dryWindow.currentlyDry) {
      if (dryWindow.allClear) return 'Dry window active · Clear across next 48h'
      return `Dry window now · ${dryWindow.durationHours}h clear until ${formatHour(dryWindow.end, data.timeZone)}`
    }
    return `Next dry window · ${formatHour(dryWindow.start, data.timeZone)} – ${formatHour(dryWindow.end, data.timeZone)} (${dryWindow.durationHours}h dry)`
  })()

  const readouts = [
    {
      icon: Thermometer,
      title: 'AIR TEMP',
      value: `${Math.round(data.current.temp)}°C`,
      sub: `Feels ${Math.round(data.current.feelsLike)}° · 24h ${Math.round(summary24h.minTemp)}°/${Math.round(summary24h.maxTemp)}°`,
    },
    {
      icon: Wind,
      title: 'WIND / GUSTS',
      value: `${Math.round(data.current.windGusts)} km/h`,
      sub: `Sustained ${Math.round(data.current.windSpeed)} km/h`,
    },
    {
      icon: Droplets,
      title: '24H RAIN / RH',
      value: `${summary24h.totalMm.toFixed(1)} mm`,
      sub: `${Math.round(data.current.humidity)}% humidity · ${summary24h.wetHours}h wet`,
    },
    {
      icon: Clock,
      title: 'DRY WINDOW',
      value: dryWindow
        ? dryWindow.allClear
          ? '48h+ dry'
          : `${dryWindow.durationHours}h dry`
        : 'None',
      sub: dryWindow
        ? dryWindow.currentlyDry
          ? dryWindow.allClear
            ? 'No alerts ahead'
            : `Until ${formatHour(dryWindow.end, data.timeZone)}`
        : `Starts ${formatHour(dryWindow.start, data.timeZone)}`
        : 'Wet horizon',
    },
  ]

  return (
    <section
      aria-live="polite"
      className={`app-enter instrument-panel relative overflow-hidden rounded-2xl border backdrop-blur-xl ${style.ring} ${style.glow}`}
    >
      {/* Top directional accent rule */}
      <div className={`h-1 w-full bg-gradient-to-r ${style.strip}`} />

      <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between lg:p-8">
        <div className="flex min-w-0 flex-1 items-start gap-4 sm:gap-5">
          <div
            key={status}
            className={`app-pop flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border sm:h-16 sm:w-16 ${style.iconBg}`}
          >
            <Icon className="h-7 w-7 sm:h-9 sm:w-9" strokeWidth={1.6} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider uppercase ${style.badge}`}
              >
                <span className="beacon-dot h-1.5 w-1.5 rounded-full bg-current" />
                {info.label} · forecast status
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                WMO {String(data.current.code).padStart(2, '0')}
              </span>
            </div>

            <h1 className="font-display mt-2 break-words text-2xl font-bold tracking-tight text-white sm:text-4xl lg:text-[2.65rem] lg:leading-[1.08]">
              {title}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300/95 sm:text-base">
              {sub}
            </p>

            {/* Actionable Dry Window Callout */}
            <div className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/55 px-3 py-1.5 text-xs text-slate-200">
              <SunMedium
                className={`h-3.5 w-3.5 shrink-0 ${
                  dryWindow?.currentlyDry ? 'text-emerald-300' : 'text-sky-300'
                }`}
              />
              <span className="font-mono text-[11px] font-medium">{dryCalloutText}</span>
            </div>
          </div>
        </div>

        {/* 4-cell Meteorological Readout Grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:w-[23rem] lg:grid-cols-2 xl:w-[25rem]">
          {readouts.map((c) => (
            <div
              key={c.title}
              className="instrument-well flex flex-col justify-between rounded-xl border border-white/10 px-3.5 py-3"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-mono text-[10px] font-medium tracking-wider text-slate-400 uppercase">
                  {c.title}
                </span>
                <c.icon className="h-3.5 w-3.5 text-slate-400" />
              </div>
              <p className="font-mono mt-2 text-lg leading-none font-semibold text-white tabular-nums sm:text-xl">
                {c.value}
              </p>
              <p className="mt-1.5 truncate text-[11px] text-slate-400">{c.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 12-Hour Sky Strip */}
      {next12Hours.length > 0 && (
        <div className="border-t border-white/10 bg-slate-950/45 px-5 py-3 sm:px-7 lg:px-8">
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="font-mono tracking-wider text-slate-400 uppercase">
              Immediate 12h Sky Strip
            </span>
            <span className="flex items-center gap-3 font-mono text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs bg-emerald-400/60" /> Dry
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs bg-sky-400/80" /> Rain
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs bg-amber-400/90" /> Heavy
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-xs bg-violet-400" /> Storm
              </span>
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {next12Hours.map((h, idx) => {
              const barCls =
                h.level === 'storm'
                  ? 'border-violet-400/50 bg-violet-500/30 text-violet-100'
                  : h.level === 'heavy'
                    ? 'border-amber-400/50 bg-amber-500/25 text-amber-100'
                    : h.level === 'rain'
                      ? 'border-sky-400/40 bg-sky-500/20 text-sky-100'
                      : 'border-white/10 bg-white/[0.03] text-slate-300'
              const indicatorCls =
                h.level === 'storm'
                  ? 'bg-violet-400'
                  : h.level === 'heavy'
                    ? 'bg-amber-400'
                    : h.level === 'rain'
                      ? 'bg-sky-400'
                      : 'bg-emerald-400/50'
              return (
                <div
                  key={h.time.toISOString()}
                  title={`${formatHour(h.time, data.timeZone)} · ${codeInfo(h.code).label} · ${Math.round(h.precipProb)}% (${h.precipMm.toFixed(1)} mm)`}
                  className={`flex flex-col items-center rounded-lg border px-1.5 py-1.5 text-center transition-colors ${barCls}`}
                >
                  <span className="font-mono text-[10px] text-slate-400">
                    {idx === 0 ? 'Now' : formatHour(h.time, data.timeZone).slice(0, 5)}
                  </span>
                  <span className={`my-1.5 h-1.5 w-full rounded-full ${indicatorCls}`} />
                  <span className="font-mono text-[10px] font-medium tabular-nums">
                    {Math.round(h.precipProb)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* severity ticker for the first upcoming event */}
      {next && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-white/10 bg-black/35 px-5 py-2.5 font-mono text-xs text-slate-300 sm:px-7 lg:px-8">
          <span className="font-semibold text-white">
            Next event:{' '}
            {next.level === 'storm'
              ? 'Thunderstorm'
              : next.level === 'heavy'
                ? 'Heavy rain'
                : 'Rain'}
          </span>
          <span>
            {next.ongoing ? 'Now' : formatHour(next.start, data.timeZone)} →{' '}
            {formatHour(next.end, data.timeZone)} ({next.hours} h)
          </span>
          <span>Peak precipitation probability {next.peakProb}%</span>
          {next.totalMm > 0.1 && <span>~{next.totalMm.toFixed(1)} mm expected</span>}
          {next.maxGusts >= 40 && <span>Gusts up to {Math.round(next.maxGusts)} km/h</span>}
        </div>
      )}
    </section>
  )
}
