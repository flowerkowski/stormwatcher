import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Cloud,
  Cpu,
  Droplets,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  Sun,
  Table2,
  Thermometer,
  Wind,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fetchWeatherNext, weatherNextEndpoint } from '@/lib/weathernext'
import type { WeatherNextForecast, WeatherNextHour } from '@/lib/weathernext'
import type { HourPoint, WeatherBundle } from '@/types/weather'
import { formatDay, formatHour } from '@/lib/weather'

type ChartMode = 'precip' | 'thermal' | 'wind'

const WIDTH = 960
const HEIGHT = 300
const MARGIN = { top: 28, right: 52, bottom: 46, left: 52 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

interface EnrichedRow extends WeatherNextHour {
  date: Date
  dayLabel: string
  hourLabel: string
  openMeteo?: HourPoint
}

function buildBandPath(
  rows: EnrichedRow[],
  x: (i: number) => number,
  yLow: (r: EnrichedRow) => number,
  yHigh: (r: EnrichedRow) => number,
): string {
  if (!rows.length) return ''
  const upper = rows
    .map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yHigh(r).toFixed(1)}`)
    .join(' ')
  const lower = [...rows]
    .reverse()
    .map((r, revIdx) => {
      const i = rows.length - 1 - revIdx
      return `L ${x(i).toFixed(1)} ${yLow(r).toFixed(1)}`
    })
    .join(' ')
  return `${upper} ${lower} Z`
}

function buildLinePath(
  rows: EnrichedRow[],
  x: (i: number) => number,
  yVal: (r: EnrichedRow) => number | null,
): string {
  let path = ''
  let penDown = false
  rows.forEach((r, i) => {
    const y = yVal(r)
    if (y === null || !Number.isFinite(y)) {
      penDown = false
      return
    }
    path += `${penDown ? ' L' : ' M'} ${x(i).toFixed(1)} ${y.toFixed(1)}`
    penDown = true
  })
  return path.trim()
}

export default function WeatherNextPanel({ data }: { data: WeatherBundle }) {
  const uid = useId().replaceAll(':', '')
  const svgRef = useRef<SVGSVGElement>(null)
  const [forecast, setForecast] = useState<WeatherNextForecast | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(Boolean(weatherNextEndpoint))
  const [mode, setMode] = useState<ChartMode>('precip')
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const { latitude, longitude } = data.location

  const load = useCallback(
    async (controller: AbortController) => {
      if (!weatherNextEndpoint) return
      setLoading(true)
      setError(null)
      try {
        const result = await fetchWeatherNext(
          { name: '', latitude, longitude },
          weatherNextEndpoint,
          AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
        )
        if (!controller.signal.aborted) setForecast(result)
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'WeatherNext is unavailable.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    },
    [latitude, longitude],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller)
    return () => controller.abort()
  }, [load, data.fetchedAt, retry])

  const openMeteoMap = useMemo(
    () => new Map(data.hours.map((hour) => [hour.precipitationTime.getTime(), hour])),
    [data.hours],
  )

  const rows: EnrichedRow[] = useMemo(() => {
    if (!forecast) return []
    return forecast.hours
      .filter((hour) => Date.parse(hour.time) > data.fetchedAt.getTime())
      .map((hour) => {
        const date = new Date(hour.time)
        return {
          ...hour,
          date,
          dayLabel: formatDay(date, data.timeZone),
          hourLabel: formatHour(date, data.timeZone),
          openMeteo: openMeteoMap.get(date.getTime()),
        }
      })
  }, [forecast, data.fetchedAt, data.timeZone, openMeteoMap])

  const metrics = useMemo(() => {
    if (!rows.length) return null
    const totalGoogleMm = rows.reduce((s, r) => s + r.precipitationMm, 0)
    const totalP10Mm = rows.reduce((s, r) => s + r.precipitationP10Mm, 0)
    const totalP90Mm = rows.reduce((s, r) => s + r.precipitationP90Mm, 0)
    const hasImerg = rows.some((r) => r.imergPrecipitationMm !== undefined)
    const totalImergMm = rows.reduce((s, r) => s + (r.imergPrecipitationMm ?? 0), 0)
    const totalOpenMeteoMm = rows.reduce((s, r) => s + (r.openMeteo?.precipMm ?? 0), 0)
    const rainDeltaMm = totalGoogleMm - totalOpenMeteoMm

    let peakRainRow = rows[0]
    for (const r of rows) {
      if (r.precipitationP90Mm > peakRainRow.precipitationP90Mm) peakRainRow = r
    }
    const wetHours = rows.filter((r) => r.precipitationMm >= 0.1 || r.precipitationP90Mm >= 0.25).length

    const minTemp = Math.min(...rows.map((r) => r.temperatureP10C ?? r.temperatureC))
    const maxTemp = Math.max(...rows.map((r) => r.temperatureP90C ?? r.temperatureC))
    const maxTempSpread = Math.max(
      ...rows.map((r) =>
        r.temperatureP90C !== undefined && r.temperatureP10C !== undefined
          ? r.temperatureP90C - r.temperatureP10C
          : 0,
      ),
    )
    const dewpoints = rows.map((r) => r.dewpointC).filter((v): v is number => v !== undefined)
    const avgDewpoint = dewpoints.length
      ? dewpoints.reduce((a, b) => a + b, 0) / dewpoints.length
      : null

    const peakWind10m = Math.max(...rows.map((r) => r.windSpeedKmh))
    const peakWindP90 = Math.max(...rows.map((r) => r.windSpeedP90Kmh ?? r.windSpeedKmh))
    const peakWind100m = Math.max(...rows.map((r) => r.windSpeed100mKmh ?? 0))
    const pressures = rows.map((r) => r.pressureHpa).filter((v): v is number => v !== undefined)
    const minPressure = pressures.length ? Math.min(...pressures) : null
    const maxPressure = pressures.length ? Math.max(...pressures) : null
    const peakSolar = Math.max(...rows.map((r) => r.solarRadiationWm2 ?? 0))

    return {
      totalGoogleMm,
      totalP10Mm,
      totalP90Mm,
      hasImerg,
      totalImergMm,
      totalOpenMeteoMm,
      rainDeltaMm,
      peakRainRow,
      wetHours,
      minTemp,
      maxTemp,
      maxTempSpread,
      avgDewpoint,
      peakWind10m,
      peakWindP90,
      peakWind100m,
      minPressure,
      maxPressure,
      peakSolar,
    }
  }, [rows])

  const geometry = useMemo(() => {
    const step = rows.length > 1 ? PLOT_WIDTH / (rows.length - 1) : PLOT_WIDTH
    const x = (index: number) => MARGIN.left + index * step

    // Precipitation scale (mm/h)
    const maxPrecip = Math.max(
      1.0,
      ...rows.map((r) =>
        Math.max(
          r.precipitationP90Mm,
          r.precipitationMm,
          r.imergPrecipitationMm ?? 0,
          r.openMeteo?.precipMm ?? 0,
        ),
      ),
    )
    const precipCeiling =
      maxPrecip <= 1.2
        ? 1.2
        : maxPrecip <= 3
          ? Math.ceil(maxPrecip * 2) / 2
          : Math.ceil(maxPrecip)
    const yPrecip = (mm: number) =>
      MARGIN.top +
      PLOT_HEIGHT -
      (Math.max(0, Math.min(precipCeiling, mm)) / precipCeiling) * PLOT_HEIGHT

    // Temperature scale (°C)
    const allTemps = rows.flatMap((r) => [
      r.temperatureC,
      r.temperatureP10C ?? r.temperatureC,
      r.temperatureP90C ?? r.temperatureC,
      r.dewpointC ?? r.temperatureC,
      r.openMeteo?.temp ?? r.temperatureC,
    ])
    const tMinRaw = allTemps.length ? Math.min(...allTemps) : 0
    const tMaxRaw = allTemps.length ? Math.max(...allTemps) : 20
    const tFloor = Math.floor(tMinRaw - 1.5)
    const tCeil = Math.ceil(tMaxRaw + 1.5)
    const tSpan = Math.max(4, tCeil - tFloor)
    const yTemp = (c: number) =>
      MARGIN.top +
      PLOT_HEIGHT * 0.14 +
      (1 - (c - tFloor) / tSpan) * (PLOT_HEIGHT * 0.78)

    // Solar scale (W/m²) mapped to bottom 45% of plot
    const maxSolar = Math.max(200, ...rows.map((r) => r.solarRadiationWm2 ?? 0))
    const ySolar = (wm2: number) =>
      MARGIN.top +
      PLOT_HEIGHT -
      (Math.max(0, Math.min(maxSolar, wm2)) / maxSolar) * (PLOT_HEIGHT * 0.42)

    // Wind scale (km/h)
    const maxWind = Math.max(
      25,
      ...rows.map((r) =>
        Math.max(r.windSpeedKmh, r.windSpeedP90Kmh ?? 0, r.windSpeed100mKmh ?? 0),
      ),
    )
    const windCeiling = Math.ceil(maxWind / 5) * 5
    const yWind = (kmh: number) =>
      MARGIN.top +
      PLOT_HEIGHT -
      (Math.max(0, Math.min(windCeiling, kmh)) / windCeiling) * PLOT_HEIGHT

    // Pressure scale (hPa)
    const pressures = rows.map((r) => r.pressureHpa).filter((v): v is number => v !== undefined)
    const pMin = pressures.length ? Math.floor(Math.min(...pressures) - 1) : 1000
    const pMax = pressures.length ? Math.ceil(Math.max(...pressures) + 1) : 1025
    const pSpan = Math.max(4, pMax - pMin)
    const yPressure = (hpa: number) =>
      MARGIN.top +
      PLOT_HEIGHT * 0.12 +
      (1 - (hpa - pMin) / pSpan) * (PLOT_HEIGHT * 0.76)

    // Paths — Precipitation
    const precipP10P90Band = buildBandPath(
      rows,
      x,
      (r) => yPrecip(r.precipitationP10Mm),
      (r) => yPrecip(r.precipitationP90Mm),
    )
    const hasQuartiles = rows.some(
      (r) => r.precipitationP25Mm !== undefined && r.precipitationP75Mm !== undefined,
    )
    const precipP25P75Band = hasQuartiles
      ? buildBandPath(
          rows,
          x,
          (r) => yPrecip(r.precipitationP25Mm ?? r.precipitationP10Mm),
          (r) => yPrecip(r.precipitationP75Mm ?? r.precipitationP90Mm),
        )
      : ''
    const precipMeanLine = buildLinePath(rows, x, (r) => yPrecip(r.precipitationMm))
    const precipMedianLine = buildLinePath(rows, x, (r) =>
      r.precipitationP50Mm !== undefined ? yPrecip(r.precipitationP50Mm) : null,
    )
    const imergLine = buildLinePath(rows, x, (r) =>
      r.imergPrecipitationMm !== undefined ? yPrecip(r.imergPrecipitationMm) : null,
    )

    // Paths — Thermal & Solar
    const tempBand = buildBandPath(
      rows,
      x,
      (r) => yTemp(r.temperatureP10C ?? r.temperatureC),
      (r) => yTemp(r.temperatureP90C ?? r.temperatureC),
    )
    const tempMeanLine = buildLinePath(rows, x, (r) => yTemp(r.temperatureC))
    const openMeteoTempLine = buildLinePath(rows, x, (r) =>
      r.openMeteo ? yTemp(r.openMeteo.temp) : null,
    )
    const dewpointLine = buildLinePath(rows, x, (r) =>
      r.dewpointC !== undefined ? yTemp(r.dewpointC) : null,
    )
    const solarLine = buildLinePath(rows, x, (r) =>
      r.solarRadiationWm2 !== undefined ? ySolar(r.solarRadiationWm2) : null,
    )
    const solarArea =
      rows.length && solarLine
        ? `${solarLine} L ${x(rows.length - 1).toFixed(1)} ${MARGIN.top + PLOT_HEIGHT} L ${x(0).toFixed(1)} ${MARGIN.top + PLOT_HEIGHT} Z`
        : ''

    // Paths — Wind & Pressure
    const windBand = buildBandPath(
      rows,
      x,
      (r) => yWind(r.windSpeedP10Kmh ?? r.windSpeedKmh),
      (r) => yWind(r.windSpeedP90Kmh ?? r.windSpeedKmh),
    )
    const wind10mLine = buildLinePath(rows, x, (r) => yWind(r.windSpeedKmh))
    const wind100mLine = buildLinePath(rows, x, (r) =>
      r.windSpeed100mKmh !== undefined ? yWind(r.windSpeed100mKmh) : null,
    )
    const pressureLine = buildLinePath(rows, x, (r) =>
      r.pressureHpa !== undefined ? yPressure(r.pressureHpa) : null,
    )

    const dayTransitions: Array<{ index: number; label: string }> = []
    rows.forEach((row, index) => {
      if (index > 0 && row.dayLabel !== rows[index - 1].dayLabel) {
        dayTransitions.push({ index, label: row.dayLabel })
      }
    })

    return {
      step,
      x,
      precipCeiling,
      yPrecip,
      tFloor,
      tCeil,
      yTemp,
      maxSolar,
      ySolar,
      windCeiling,
      yWind,
      pMin,
      pMax,
      yPressure,
      precipP10P90Band,
      precipP25P75Band,
      precipMeanLine,
      precipMedianLine,
      imergLine,
      tempBand,
      tempMeanLine,
      openMeteoTempLine,
      dewpointLine,
      solarArea,
      windBand,
      wind10mLine,
      wind100mLine,
      pressureLine,
      dayTransitions,
    }
  }, [rows])

  const formatRun = (time: string) =>
    new Date(time).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: data.timeZone,
    })

  const activeRow = activeIdx !== null && rows[activeIdx] ? rows[activeIdx] : null

  const updatePointerIndex = (clientX: number) => {
    const svg = svgRef.current
    if (!svg || !rows.length) return
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0) return
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH
    const rawIdx = Math.round((svgX - MARGIN.left) / geometry.step)
    const clamped = Math.max(0, Math.min(rows.length - 1, rawIdx))
    setActiveIdx(clamped)
  }

  if (!weatherNextEndpoint && !expanded) {
    return (
      <div className="instrument-panel flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-400/20 px-4 py-2.5 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-violet-300" />
          <span className="font-display font-semibold text-white">WeatherNext 3</span>
          <span className="font-mono rounded border border-violet-400/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300 uppercase">
            Standby
          </span>
          <span className="text-slate-400">
            WeatherNext comparison is available once approved Google data access is connected. Your
            forecast alerts currently use Open-Meteo.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={expanded}
          className="font-mono inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200"
        >
          Details <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <Card className="instrument-panel relative overflow-hidden rounded-2xl border-violet-400/25 text-white shadow-[0_0_80px_-28px_rgba(167,139,250,0.45)] backdrop-blur-xl">
      {/* Top atmospheric directional glow strip */}
      <div className="h-1 w-full bg-gradient-to-r from-violet-500/95 via-fuchsia-500/75 to-sky-400/70" />

      <CardHeader className="space-y-3 pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/35 bg-violet-500/15 text-violet-200 shadow-inner">
              <Sparkles className="h-4 w-4 text-violet-300" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold tracking-tight text-white">
                  Google DeepMind WeatherNext 3
                </span>
                <span className="font-mono inline-flex items-center gap-1.5 rounded-md border border-violet-400/35 bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-200 uppercase">
                  <span className="beacon-dot h-1.5 w-1.5 rounded-full bg-violet-300" />
                  64-Member FGN Ensemble
                </span>
                <span className="font-mono hidden rounded-md border border-fuchsia-400/25 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-normal text-fuchsia-200 uppercase sm:inline-block">
                  Earth Engine 0.1° Live
                </span>
              </div>
              {forecast && (
                <p className="font-mono mt-1 text-[11px] text-slate-400">
                  Run {formatRun(forecast.initializedAt)} · fetched {formatRun(forecast.fetchedAt)}{' '}
                  · 0.1° cell ({forecast.grid.latitude.toFixed(2)}°N,{' '}
                  {forecast.grid.longitude.toFixed(2)}°E) · {rows.length}h horizon
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {forecast && rows.length > 0 && (
              <div
                role="group"
                aria-label="WeatherNext visualization mode"
                className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950/70 p-1 text-[11px] font-normal"
              >
                <button
                  type="button"
                  onClick={() => setMode('precip')}
                  aria-pressed={mode === 'precip'}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[10px] transition-all ${
                    mode === 'precip'
                      ? 'border border-violet-400/45 bg-violet-500/25 text-violet-100 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Droplets className="h-3 w-3 text-violet-300" /> Precip Plume
                </button>
                <button
                  type="button"
                  onClick={() => setMode('thermal')}
                  aria-pressed={mode === 'thermal'}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[10px] transition-all ${
                    mode === 'thermal'
                      ? 'border border-emerald-400/45 bg-emerald-500/20 text-emerald-100 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Thermometer className="h-3 w-3 text-emerald-300" /> Thermal &amp; Sky
                </button>
                <button
                  type="button"
                  onClick={() => setMode('wind')}
                  aria-pressed={mode === 'wind'}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[10px] transition-all ${
                    mode === 'wind'
                      ? 'border border-amber-400/45 bg-amber-500/20 text-amber-100 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Wind className="h-3 w-3 text-amber-300" /> Wind &amp; Pressure
                </button>
              </div>
            )}

            {weatherNextEndpoint && (
              <Button
                variant="ghost"
                size="icon"
                disabled={loading}
                aria-label="Refresh WeatherNext forecast"
                onClick={() => setRetry((n) => n + 1)}
                className="h-8 w-8 rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10 hover:text-white"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            )}
            {!weatherNextEndpoint && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(false)}
                className="h-7 px-2 font-mono text-xs text-slate-400 hover:text-white"
              >
                Collapse <ChevronUp className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 text-sm text-slate-300">
        {!weatherNextEndpoint && (
          <p>
            WeatherNext comparison is available once approved Google data access is connected. Your
            forecast alerts currently use Open-Meteo.
          </p>
        )}

        {loading && !forecast && (
          <div
            role="status"
            className="instrument-well flex h-56 flex-col items-center justify-center gap-3 rounded-xl border border-violet-400/20 text-slate-300"
          >
            <Loader2 className="h-7 w-7 animate-spin text-violet-300" />
            <p className="font-mono text-xs">
              Sampling 64-member WeatherNext 3 ensemble from Google Earth Engine…
            </p>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200"
          >
            {error}{' '}
            {forecast && 'Showing the last successful comparison; it may be out of date.'}{' '}
            Open-Meteo alerts remain active.
          </p>
        )}

        {forecast && metrics && rows.length > 0 && (
          <>
            {/* 4-Card Ensemble Telemetry KPI Strip */}
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <div className="instrument-well flex flex-col justify-between rounded-xl border border-violet-400/20 px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-medium tracking-wider text-violet-300 uppercase">
                    48H ENSEMBLE RAIN
                  </span>
                  <Droplets className="h-3.5 w-3.5 text-violet-300" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-xl leading-none font-semibold text-white tabular-nums">
                    {metrics.totalGoogleMm.toFixed(1)} mm
                  </span>
                  <span
                    className={`font-mono rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
                      Math.abs(metrics.rainDeltaMm) < 0.3
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : metrics.rainDeltaMm > 0
                          ? 'bg-violet-500/20 text-violet-200'
                          : 'bg-sky-500/20 text-sky-200'
                    }`}
                  >
                    {metrics.rainDeltaMm >= 0 ? '+' : ''}
                    {metrics.rainDeltaMm.toFixed(1)} vs OM
                  </span>
                </div>
                <p className="font-mono mt-1.5 truncate text-[11px] text-slate-400 tabular-nums">
                  p10–p90: {metrics.totalP10Mm.toFixed(1)}–{metrics.totalP90Mm.toFixed(1)} mm
                  {metrics.hasImerg ? ` · IMERG ${metrics.totalImergMm.toFixed(1)} mm` : ''}
                </p>
              </div>

              <div className="instrument-well flex flex-col justify-between rounded-xl border border-fuchsia-400/20 px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-medium tracking-wider text-fuchsia-300 uppercase">
                    PEAK TAIL RISK (P90)
                  </span>
                  <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-xl leading-none font-semibold text-white tabular-nums">
                    {metrics.peakRainRow.precipitationP90Mm.toFixed(2)} mm/h
                  </span>
                  <span className="font-mono text-[11px] text-fuchsia-200 tabular-nums">
                    mean {metrics.peakRainRow.precipitationMm.toFixed(2)}
                  </span>
                </div>
                <p className="font-mono mt-1.5 truncate text-[11px] text-slate-400">
                  Peak {metrics.peakRainRow.dayLabel} {metrics.peakRainRow.hourLabel} ·{' '}
                  {metrics.wetHours}h active
                </p>
              </div>

              <div className="instrument-well flex flex-col justify-between rounded-xl border border-emerald-400/20 px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-medium tracking-wider text-emerald-300 uppercase">
                    THERMAL ENVELOPE
                  </span>
                  <Thermometer className="h-3.5 w-3.5 text-emerald-300" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-xl leading-none font-semibold text-white tabular-nums">
                    {metrics.minTemp.toFixed(1)}°..{metrics.maxTemp.toFixed(1)}°C
                  </span>
                </div>
                <p className="font-mono mt-1.5 truncate text-[11px] text-slate-400 tabular-nums">
                  Spread up to ±{(metrics.maxTempSpread / 2).toFixed(1)}°C
                  {metrics.avgDewpoint !== null
                    ? ` · Dew ${metrics.avgDewpoint.toFixed(1)}°C`
                    : ''}
                </p>
              </div>

              <div className="instrument-well flex flex-col justify-between rounded-xl border border-amber-400/20 px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-medium tracking-wider text-amber-300 uppercase">
                    WIND (10M/100M) &amp; MSLP
                  </span>
                  <Gauge className="h-3.5 w-3.5 text-amber-300" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-xl leading-none font-semibold text-white tabular-nums">
                    {metrics.peakWind10m.toFixed(1)} km/h
                  </span>
                  {metrics.peakWind100m > 0 && (
                    <span className="font-mono text-[11px] text-rose-300 tabular-nums">
                      100m: {metrics.peakWind100m.toFixed(0)} km/h
                    </span>
                  )}
                </div>
                <p className="font-mono mt-1.5 truncate text-[11px] text-slate-400 tabular-nums">
                  p90 {metrics.peakWindP90.toFixed(1)} km/h
                  {metrics.minPressure !== null && metrics.maxPressure !== null
                    ? ` · ${Math.round(metrics.minPressure)}–${Math.round(metrics.maxPressure)} hPa`
                    : ''}
                </p>
              </div>
            </div>

            {/* Live Scrubber Telemetry Readout Strip */}
            <div className="instrument-well flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border border-white/10 px-3.5 py-2.5 font-mono text-xs">
              {activeRow ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-violet-500/25 px-2 py-0.5 text-[10px] font-semibold text-violet-200 uppercase">
                      {activeRow.dayLabel} {activeRow.hourLabel}
                    </span>
                    {activeRow.cloudCoverPct !== undefined && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-300">
                        <Cloud className="h-3 w-3 text-sky-300" />
                        Cloud <strong>{Math.round(activeRow.cloudCoverPct)}%</strong>
                      </span>
                    )}
                    {activeRow.solarRadiationWm2 !== undefined &&
                      activeRow.solarRadiationWm2 > 1 && (
                        <span className="flex items-center gap-1 text-[11px] text-amber-300">
                          <Sun className="h-3 w-3" />
                          Solar <strong>{Math.round(activeRow.solarRadiationWm2)} W/m²</strong>
                        </span>
                      )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums">
                    <span className="text-violet-200">
                      WN3 Rain <strong>{activeRow.precipitationMm.toFixed(2)} mm</strong>{' '}
                      <span className="text-slate-400">
                        (p10–p90: {activeRow.precipitationP10Mm.toFixed(2)}–
                        {activeRow.precipitationP90Mm.toFixed(2)})
                      </span>
                    </span>
                    <span className="text-sky-300">
                      Open-Meteo{' '}
                      <strong>
                        {activeRow.openMeteo
                          ? `${activeRow.openMeteo.precipMm.toFixed(2)} mm`
                          : '—'}
                      </strong>
                    </span>
                    <span className="text-emerald-300">
                      Temp <strong>{activeRow.temperatureC.toFixed(1)}°C</strong>
                      {activeRow.temperatureP10C !== undefined &&
                        activeRow.temperatureP90C !== undefined && (
                          <span className="text-slate-400">
                            {' '}
                            ({activeRow.temperatureP10C.toFixed(1)}°..
                            {activeRow.temperatureP90C.toFixed(1)}°)
                          </span>
                        )}
                    </span>
                    <span className="text-amber-300">
                      Wind <strong>{activeRow.windSpeedKmh.toFixed(1)} km/h</strong>
                      {activeRow.windSpeed100mKmh !== undefined && (
                        <span className="text-rose-300">
                          {' '}
                          · 100m {activeRow.windSpeed100mKmh.toFixed(1)}
                        </span>
                      )}
                    </span>
                    {activeRow.pressureHpa !== undefined && (
                      <span className="text-cyan-200">
                        <strong>{activeRow.pressureHpa.toFixed(0)} hPa</strong>
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <span className="text-[11px] text-slate-400">
                    Hover or use ←/→ keys to scrub 64-member ensemble distributions across all 48
                    hours
                  </span>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-300 tabular-nums">
                    <span className="text-violet-300">
                      Shaded plumes show <strong>p10–p90</strong> (80% ensemble envelope) &amp;{' '}
                      <strong>p25–p75</strong> (IQR core)
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Interactive SVG Ensemble Plume Chart */}
            <div className="telemetry-grid instrument-well w-full overflow-x-auto rounded-xl border border-white/10 p-2">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                role="img"
                tabIndex={0}
                aria-label={`WeatherNext 3 ${mode} ensemble chart`}
                onPointerMove={(e) => updatePointerIndex(e.clientX)}
                onPointerLeave={() => setActiveIdx(null)}
                onKeyDown={(e) => {
                  if (!rows.length) return
                  if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    setActiveIdx((prev) =>
                      prev === null ? 0 : Math.min(rows.length - 1, prev + 1),
                    )
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault()
                    setActiveIdx((prev) => (prev === null ? 0 : Math.max(0, prev - 1)))
                  } else if (e.key === 'Escape') {
                    setActiveIdx(null)
                  }
                }}
                className="h-72 min-w-[680px] w-full cursor-crosshair select-none rounded-lg focus-visible:ring-1 focus-visible:ring-violet-400/60 focus-visible:outline-none"
              >
                <defs>
                  <linearGradient id={`${uid}-precip-outer`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity="0.34" />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.05" />
                  </linearGradient>
                  <linearGradient id={`${uid}-precip-iqr`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e879f9" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity="0.14" />
                  </linearGradient>
                  <linearGradient id={`${uid}-temp-band`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity="0.36" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.08" />
                  </linearGradient>
                  <linearGradient id={`${uid}-solar-fill`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id={`${uid}-wind-band`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.36" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.06" />
                  </linearGradient>
                </defs>

                {/* Day transition dividers */}
                {geometry.dayTransitions.map((d) => {
                  const xpos = geometry.x(d.index)
                  return (
                    <g key={`day-${d.index}`}>
                      <line
                        x1={xpos}
                        x2={xpos}
                        y1={MARGIN.top}
                        y2={MARGIN.top + PLOT_HEIGHT}
                        stroke="rgba(148,163,184,0.25)"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={xpos + 5}
                        y={MARGIN.top + 11}
                        fill="#cbd5e1"
                        fontSize="9.5"
                        fontWeight="600"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {d.label.toUpperCase()}
                      </text>
                    </g>
                  )
                })}

                {/* MODE 1: PRECIPITATION PLUME */}
                {mode === 'precip' && (
                  <g>
                    {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                      const val = geometry.precipCeiling * frac
                      const ypos = geometry.yPrecip(val)
                      return (
                        <g key={frac}>
                          <line
                            x1={MARGIN.left}
                            x2={MARGIN.left + PLOT_WIDTH}
                            y1={ypos}
                            y2={ypos}
                            stroke="rgba(148,163,184,0.12)"
                          />
                          <text
                            x={MARGIN.left - 8}
                            y={ypos + 4}
                            textAnchor="end"
                            fill="#94a3b8"
                            fontSize="10"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {val.toFixed(geometry.precipCeiling <= 2 ? 1 : 0)} mm
                          </text>
                        </g>
                      )
                    })}

                    {/* Open-Meteo deterministic comparison bars */}
                    {rows.map((r, i) => {
                      const om = r.openMeteo?.precipMm ?? 0
                      if (om <= 0) return null
                      const yTop = geometry.yPrecip(om)
                      const barH = MARGIN.top + PLOT_HEIGHT - yTop
                      return (
                        <rect
                          key={`om-${r.time}`}
                          x={geometry.x(i) - Math.max(2, geometry.step * 0.2)}
                          y={yTop}
                          width={Math.max(3, geometry.step * 0.4)}
                          height={Math.max(1.5, barH)}
                          rx="1.5"
                          fill={
                            activeIdx === i ? 'rgba(56,189,248,0.85)' : 'rgba(56,189,248,0.38)'
                          }
                        />
                      )
                    })}

                    {/* p10-p90 outer fan plume */}
                    {geometry.precipP10P90Band && (
                      <path
                        d={geometry.precipP10P90Band}
                        fill={`url(#${uid}-precip-outer)`}
                        stroke="#a855f7"
                        strokeOpacity="0.35"
                        strokeWidth="1"
                      />
                    )}

                    {/* p25-p75 inner interquartile core */}
                    {geometry.precipP25P75Band && (
                      <path d={geometry.precipP25P75Band} fill={`url(#${uid}-precip-iqr)`} />
                    )}

                    {/* p50 ensemble median */}
                    {geometry.precipMedianLine && (
                      <path
                        d={geometry.precipMedianLine}
                        fill="none"
                        stroke="#f0abfc"
                        strokeWidth="1.4"
                        strokeDasharray="4 3"
                        strokeOpacity="0.85"
                      />
                    )}

                    {/* IMERG satellite-calibrated mean */}
                    {geometry.imergLine && (
                      <path
                        d={geometry.imergLine}
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="1.6"
                        strokeDasharray="2 3"
                        strokeOpacity="0.9"
                      />
                    )}

                    {/* Ensemble mean curve */}
                    {geometry.precipMeanLine && (
                      <path
                        d={geometry.precipMeanLine}
                        fill="none"
                        stroke="#c084fc"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </g>
                )}

                {/* MODE 2: THERMAL & SKY CANOPY */}
                {mode === 'thermal' && (
                  <g>
                    {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                      const val =
                        geometry.tFloor + (geometry.tCeil - geometry.tFloor) * frac
                      const ypos = geometry.yTemp(val)
                      return (
                        <g key={frac}>
                          <line
                            x1={MARGIN.left}
                            x2={MARGIN.left + PLOT_WIDTH}
                            y1={ypos}
                            y2={ypos}
                            stroke="rgba(148,163,184,0.12)"
                          />
                          <text
                            x={MARGIN.left - 8}
                            y={ypos + 4}
                            textAnchor="end"
                            fill="#94a3b8"
                            fontSize="10"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {val.toFixed(0)}°C
                          </text>
                        </g>
                      )
                    })}

                    {/* Upper sky cloud cover canopy strip */}
                    {rows.map((r, i) => {
                      const cloud = r.cloudCoverPct ?? 0
                      return (
                        <rect
                          key={`cloud-${r.time}`}
                          x={geometry.x(i) - geometry.step * 0.45}
                          y={MARGIN.top}
                          width={Math.max(3, geometry.step * 0.9)}
                          height={8}
                          rx="1.5"
                          fill="#94a3b8"
                          fillOpacity={Math.min(0.75, Math.max(0.05, (cloud / 100) * 0.75))}
                        />
                      )
                    })}

                    {/* Solar radiation daylight glow */}
                    {geometry.solarArea && (
                      <path d={geometry.solarArea} fill={`url(#${uid}-solar-fill)`} />
                    )}

                    {/* Temperature p10-p90 uncertainty fan */}
                    {geometry.tempBand && (
                      <path
                        d={geometry.tempBand}
                        fill={`url(#${uid}-temp-band)`}
                        stroke="#34d399"
                        strokeOpacity="0.35"
                        strokeWidth="1"
                      />
                    )}

                    {/* Dewpoint temperature curve */}
                    {geometry.dewpointLine && (
                      <path
                        d={geometry.dewpointLine}
                        fill="none"
                        stroke="#a78bfa"
                        strokeWidth="1.6"
                        strokeDasharray="3 3"
                        strokeOpacity="0.85"
                      />
                    )}

                    {/* Open-Meteo 2m temperature reference */}
                    {geometry.openMeteoTempLine && (
                      <path
                        d={geometry.openMeteoTempLine}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="1.75"
                        strokeDasharray="5 3"
                        strokeOpacity="0.85"
                      />
                    )}

                    {/* WeatherNext 2m temperature mean */}
                    {geometry.tempMeanLine && (
                      <path
                        d={geometry.tempMeanLine}
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </g>
                )}

                {/* MODE 3: WIND PROFILE & PRESSURE */}
                {mode === 'wind' && (
                  <g>
                    {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                      const val = geometry.windCeiling * frac
                      const ypos = geometry.yWind(val)
                      const pVal =
                        geometry.pMin + (geometry.pMax - geometry.pMin) * frac
                      const pY = geometry.yPressure(pVal)
                      return (
                        <g key={frac}>
                          <line
                            x1={MARGIN.left}
                            x2={MARGIN.left + PLOT_WIDTH}
                            y1={ypos}
                            y2={ypos}
                            stroke="rgba(148,163,184,0.12)"
                          />
                          <text
                            x={MARGIN.left - 8}
                            y={ypos + 4}
                            textAnchor="end"
                            fill="#fbbf24"
                            fontSize="10"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {val.toFixed(0)}
                          </text>
                          <text
                            x={MARGIN.left + PLOT_WIDTH + 6}
                            y={pY + 4}
                            textAnchor="start"
                            fill="#38bdf8"
                            fontSize="9.5"
                            fontFamily="JetBrains Mono, monospace"
                          >
                            {pVal.toFixed(0)}
                          </text>
                        </g>
                      )
                    })}

                    {/* 10m wind p10-p90 uncertainty fan */}
                    {geometry.windBand && (
                      <path
                        d={geometry.windBand}
                        fill={`url(#${uid}-wind-band)`}
                        stroke="#f59e0b"
                        strokeOpacity="0.35"
                        strokeWidth="1"
                      />
                    )}

                    {/* Mean sea level pressure curve (hPa) */}
                    {geometry.pressureLine && (
                      <path
                        d={geometry.pressureLine}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="1.9"
                        strokeDasharray="5 3"
                        strokeOpacity="0.85"
                      />
                    )}

                    {/* 100m turbine-height wind speed */}
                    {geometry.wind100mLine && (
                      <path
                        d={geometry.wind100mLine}
                        fill="none"
                        stroke="#fb7185"
                        strokeWidth="2.0"
                        strokeDasharray="3 2"
                        strokeOpacity="0.9"
                      />
                    )}

                    {/* 10m wind speed mean */}
                    {geometry.wind10mLine && (
                      <path
                        d={geometry.wind10mLine}
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </g>
                )}

                {/* Active Scrubber Crosshair & Highlight Dots */}
                {activeIdx !== null && activeRow && (
                  <g>
                    <line
                      x1={geometry.x(activeIdx)}
                      x2={geometry.x(activeIdx)}
                      y1={MARGIN.top}
                      y2={MARGIN.top + PLOT_HEIGHT}
                      stroke="rgba(226,232,240,0.7)"
                      strokeWidth="1"
                    />
                    {mode === 'precip' && (
                      <>
                        <circle
                          cx={geometry.x(activeIdx)}
                          cy={geometry.yPrecip(activeRow.precipitationP90Mm)}
                          r="3.5"
                          fill="#e879f9"
                          stroke="#020617"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={geometry.x(activeIdx)}
                          cy={geometry.yPrecip(activeRow.precipitationMm)}
                          r="4.5"
                          fill="#c084fc"
                          stroke="#020617"
                          strokeWidth="2"
                        />
                      </>
                    )}
                    {mode === 'thermal' && (
                      <>
                        <circle
                          cx={geometry.x(activeIdx)}
                          cy={geometry.yTemp(activeRow.temperatureC)}
                          r="4.5"
                          fill="#34d399"
                          stroke="#020617"
                          strokeWidth="2"
                        />
                        {activeRow.dewpointC !== undefined && (
                          <circle
                            cx={geometry.x(activeIdx)}
                            cy={geometry.yTemp(activeRow.dewpointC)}
                            r="3.5"
                            fill="#a78bfa"
                            stroke="#020617"
                            strokeWidth="1.5"
                          />
                        )}
                      </>
                    )}
                    {mode === 'wind' && (
                      <>
                        <circle
                          cx={geometry.x(activeIdx)}
                          cy={geometry.yWind(activeRow.windSpeedKmh)}
                          r="4.5"
                          fill="#fbbf24"
                          stroke="#020617"
                          strokeWidth="2"
                        />
                        {activeRow.windSpeed100mKmh !== undefined && (
                          <circle
                            cx={geometry.x(activeIdx)}
                            cy={geometry.yWind(activeRow.windSpeed100mKmh)}
                            r="3.5"
                            fill="#fb7185"
                            stroke="#020617"
                            strokeWidth="1.5"
                          />
                        )}
                      </>
                    )}
                  </g>
                )}

                {/* X-axis hour & day ticks */}
                {rows.map((row, index) =>
                  index % 6 === 0 ? (
                    <text
                      key={row.time}
                      x={geometry.x(index)}
                      y={HEIGHT - 24}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="10.5"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      <tspan x={geometry.x(index)}>{row.hourLabel}</tspan>
                      <tspan x={geometry.x(index)} dy="14" fill="#64748b">
                        {row.dayLabel}
                      </tspan>
                    </text>
                  ) : null,
                )}
              </svg>

              {/* Mode-specific Legend Footer */}
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 px-2 pt-2 font-mono text-[11px] text-slate-400">
                {mode === 'precip' && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="flex items-center gap-1.5 text-violet-200">
                      <span className="h-0.5 w-3.5 bg-purple-400" /> WN3 Ensemble Mean
                    </span>
                    <span className="flex items-center gap-1.5 text-fuchsia-200">
                      <span className="h-2.5 w-2.5 rounded-xs bg-fuchsia-400/45 border border-purple-400/50" />{' '}
                      p25–p75 IQR &amp; p10–p90 Plume
                    </span>
                    <span className="flex items-center gap-1.5 text-fuchsia-300">
                      <span className="h-0.5 w-3 border-b border-dashed border-fuchsia-300" /> p50
                      Median
                    </span>
                    {metrics.hasImerg && (
                      <span className="flex items-center gap-1.5 text-emerald-300">
                        <span className="h-0.5 w-3 border-b border-dotted border-emerald-400" />{' '}
                        NASA IMERG Calibrated
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 text-sky-300">
                      <span className="h-2.5 w-2.5 rounded-xs bg-sky-400/50" /> Open-Meteo Rain
                    </span>
                  </div>
                )}
                {mode === 'thermal' && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="flex items-center gap-1.5 text-emerald-300">
                      <span className="h-0.5 w-3.5 bg-emerald-400" /> WN3 2m Temp Mean &amp; p10–p90
                    </span>
                    <span className="flex items-center gap-1.5 text-sky-300">
                      <span className="h-0.5 w-3 border-b border-dashed border-sky-400" />{' '}
                      Open-Meteo Temp
                    </span>
                    <span className="flex items-center gap-1.5 text-violet-300">
                      <span className="h-0.5 w-3 border-b border-dotted border-violet-400" /> 2m
                      Dewpoint
                    </span>
                    <span className="flex items-center gap-1.5 text-amber-300">
                      <span className="h-2 w-2 rounded-xs bg-amber-400/50" /> Solar Irradiance
                      (W/m²)
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-2 w-3 rounded-xs bg-slate-400/60" /> Cloud Canopy %
                    </span>
                  </div>
                )}
                {mode === 'wind' && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="flex items-center gap-1.5 text-amber-300">
                      <span className="h-0.5 w-3.5 bg-amber-400" /> 10m Wind Speed Mean &amp;
                      p10–p90 (km/h)
                    </span>
                    <span className="flex items-center gap-1.5 text-rose-300">
                      <span className="h-0.5 w-3 border-b border-dashed border-rose-400" /> 100m
                      Turbine Hub Wind (km/h)
                    </span>
                    <span className="flex items-center gap-1.5 text-sky-300">
                      <span className="h-0.5 w-3 border-b border-dashed border-sky-400" /> Surface
                      Pressure (hPa, right axis)
                    </span>
                  </div>
                )}
                <span className="text-[10px] text-slate-500">
                  Valid hour end · {data.timeZone}
                </span>
              </div>
            </div>

            {/* Next 12-Hour Ensemble Micro-Strip */}
            <div className="rounded-xl border border-white/10 bg-slate-950/45 px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="font-mono tracking-wider text-slate-400 uppercase">
                  Immediate 12h Ensemble Micro-Telemetry (Click hour to inspect)
                </span>
                <span className="font-mono text-[10px] text-slate-500">
                  Bar = p10–p90 rain range · Dot = mean
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                {rows.slice(0, 12).map((r, idx) => {
                  const selected = activeIdx === idx
                  const ceil = Math.max(0.5, geometry.precipCeiling)
                  const p90Pct = Math.min(100, (r.precipitationP90Mm / ceil) * 100)
                  const p10Pct = Math.min(100, (r.precipitationP10Mm / ceil) * 100)
                  const meanPct = Math.min(100, (r.precipitationMm / ceil) * 100)
                  return (
                    <button
                      key={r.time}
                      type="button"
                      onClick={() => setActiveIdx(selected ? null : idx)}
                      className={`flex flex-col items-center rounded-lg border px-1.5 py-2 text-center transition-all ${
                        selected
                          ? 'border-violet-400/70 bg-violet-500/25 text-white shadow-sm'
                          : 'border-white/10 bg-white/[0.02] text-slate-300 hover:border-violet-400/35 hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-slate-400">
                        {r.hourLabel.slice(0, 5)}
                      </span>
                      {/* Vertical whisker mini-gauge */}
                      <div className="relative my-1.5 h-8 w-2 rounded-full bg-slate-900/90">
                        <div
                          className="absolute right-0 left-0 rounded-full bg-gradient-to-t from-violet-500/60 to-fuchsia-400/80"
                          style={{
                            bottom: `${p10Pct}%`,
                            height: `${Math.max(8, p90Pct - p10Pct)}%`,
                          }}
                        />
                        <span
                          className="absolute left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow"
                          style={{ bottom: `${meanPct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[10px] font-semibold text-emerald-300 tabular-nums">
                        {Math.round(r.temperatureC)}°
                      </span>
                      <span className="font-mono text-[9px] text-violet-200/90 tabular-nums">
                        {r.precipitationP90Mm >= 0.05
                          ? `${r.precipitationP90Mm.toFixed(1)}m`
                          : 'dry'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Collapsible 48-Hour Comparison Matrix */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Hourly precipitation mean and 10th–90th percentile range across the 64-member
                  ensemble. The range describes forecast spread; it is not rain probability.
                </p>
                <button
                  type="button"
                  onClick={() => setShowTable((v) => !v)}
                  aria-expanded={showTable}
                  className="font-mono inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-violet-200 transition-colors hover:border-violet-400/40 hover:bg-violet-500/15"
                >
                  <Table2 className="h-3.5 w-3.5" />
                  {showTable ? 'Hide 48h table' : 'Full 48h telemetry table'}
                  {showTable ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {showTable && (
                <div className="instrument-well max-h-80 overflow-auto rounded-xl border border-white/10">
                  <table className="font-mono w-full min-w-[680px] text-left text-xs tabular-nums">
                    <caption className="sr-only">
                      WeatherNext 3 and Open-Meteo forecasts compared at matching valid hours
                    </caption>
                    <thead className="sticky top-0 bg-slate-900/95 text-slate-300 backdrop-blur">
                      <tr>
                        {[
                          'Time',
                          'Google mean rain',
                          'Google p10–p90',
                          'Open-Meteo rain',
                          'Google temp.',
                          'Google wind (10m/100m)',
                          'Sky / MSLP',
                        ].map((label) => (
                          <th key={label} scope="col" className="p-3 font-medium">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((hour, idx) => {
                        const match = hour.openMeteo
                        const isSelected = activeIdx === idx
                        return (
                          <tr
                            key={hour.time}
                            onMouseEnter={() => setActiveIdx(idx)}
                            onMouseLeave={() => setActiveIdx(null)}
                            className={`border-t border-white/5 transition-colors ${
                              isSelected ? 'bg-violet-500/15' : 'hover:bg-white/[0.03]'
                            }`}
                          >
                            <th scope="row" className="p-3 font-normal text-slate-200">
                              {hour.dayLabel} {hour.hourLabel}
                            </th>
                            <td className="p-3 font-medium text-violet-200">
                              {hour.precipitationMm.toFixed(2)} mm
                              {hour.imergPrecipitationMm !== undefined && (
                                <span className="ml-1.5 text-[10px] text-emerald-300/80">
                                  (IMERG {hour.imergPrecipitationMm.toFixed(2)})
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-fuchsia-200">
                              {hour.precipitationP10Mm.toFixed(2)}–
                              {hour.precipitationP90Mm.toFixed(2)} mm
                            </td>
                            <td className="p-3 text-sky-200">
                              {match ? `${match.precipMm.toFixed(2)} mm` : '—'}
                            </td>
                            <td className="p-3 text-emerald-200">
                              {hour.temperatureC.toFixed(1)}°C
                              {hour.temperatureP10C !== undefined &&
                                hour.temperatureP90C !== undefined && (
                                  <span className="ml-1 text-[10px] text-slate-400">
                                    ({hour.temperatureP10C.toFixed(1)}°..
                                    {hour.temperatureP90C.toFixed(1)}°)
                                  </span>
                                )}
                            </td>
                            <td className="p-3 text-amber-200">
                              {hour.windSpeedKmh.toFixed(1)} km/h
                              {hour.windSpeed100mKmh !== undefined && (
                                <span className="ml-1 text-[10px] text-rose-300/85">
                                  · {hour.windSpeed100mKmh.toFixed(0)}@100m
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-slate-300">
                              {hour.cloudCoverPct !== undefined
                                ? `${Math.round(hour.cloudCoverPct)}% cloud`
                                : '—'}
                              {hour.pressureHpa !== undefined
                                ? ` · ${Math.round(hour.pressureHpa)} hPa`
                                : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        <p className="text-xs text-slate-400">
          <a
            href="https://developers.google.com/weathernext/guides/models"
            target="_blank"
            rel="noreferrer"
            className="text-violet-300 underline underline-offset-2 hover:text-violet-200"
          >
            Google WeatherNext 3
          </a>{' '}
          · 64-member Functional Generative Network (FGN) ensemble streamed via Google Earth Engine.
          Ensemble percentiles do not provide thunderstorm codes or calibrated rain probabilities for
          this app’s alerts. Follow official local warnings.
        </p>
      </CardContent>
    </Card>
  )
}
