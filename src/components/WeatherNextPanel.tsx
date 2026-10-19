import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Cpu, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fetchWeatherNext, weatherNextEndpoint } from '@/lib/weathernext'
import type { WeatherNextForecast } from '@/lib/weathernext'
import type { WeatherBundle } from '@/types/weather'
import { formatDay, formatHour } from '@/lib/weather'

export default function WeatherNextPanel({ data }: { data: WeatherBundle }) {
  const [forecast, setForecast] = useState<WeatherNextForecast | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(Boolean(weatherNextEndpoint))
  const { latitude, longitude } = data.location

  const load = useCallback(async (controller: AbortController) => {
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
  }, [latitude, longitude])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller)
    return () => controller.abort()
  }, [load, data.fetchedAt, retry])

  const rows =
    forecast?.hours.filter((hour) => Date.parse(hour.time) > data.fetchedAt.getTime()) ?? []
  const openMeteo = new Map(data.hours.map((hour) => [hour.precipitationTime.getTime(), hour]))
  const formatRun = (time: string) =>
    new Date(time).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: data.timeZone,
    })

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
            WeatherNext comparison is available once approved Google data access is connected. Your forecast alerts currently use Open-Meteo.
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
    <Card className="instrument-panel rounded-2xl border-violet-400/20 text-white backdrop-blur-xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="font-display flex items-center gap-2">
            <Cpu className="h-4 w-4 text-violet-300" />
            WeatherNext 3
            <span className="font-mono rounded border border-violet-400/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-normal text-violet-300 uppercase">
              experimental comparison
            </span>
          </span>
          <div className="flex items-center gap-1">
            {weatherNextEndpoint && (
              <Button
                variant="ghost"
                size="icon"
                disabled={loading}
                aria-label="Refresh WeatherNext forecast"
                onClick={() => setRetry((n) => n + 1)}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
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
      <CardContent className="space-y-3 text-sm text-slate-300">
        {!weatherNextEndpoint && (
          <p>
            WeatherNext comparison is available once approved Google data access is connected. Your
            forecast alerts currently use Open-Meteo.
          </p>
        )}
        {loading && <p role="status">Loading Google ensemble forecast…</p>}
        {error && (
          <p role="alert" className="text-amber-200">
            {error}{' '}
            {forecast && 'Showing the last successful comparison; it may be out of date.'}{' '}
            Open-Meteo alerts remain active.
          </p>
        )}
        {forecast && (
          <>
            <p className="font-mono text-xs text-slate-400">
              Model run {formatRun(forecast.initializedAt)} · fetched{' '}
              {formatRun(forecast.fetchedAt)} · 0.1° grid ({forecast.grid.latitude.toFixed(2)},{' '}
              {forecast.grid.longitude.toFixed(2)}) · {rows.length} future hourly steps
            </p>
            <p className="text-xs">
              Hourly precipitation mean and 10th–90th percentile range across the ensemble. The
              range describes forecast spread; it is not rain probability. Each time marks the end
              of the precipitation hour, in {data.timeZone}.
            </p>
            <div className="instrument-well max-h-72 overflow-auto rounded-xl border border-white/10">
              <table className="font-mono w-full min-w-[580px] text-left text-xs tabular-nums">
                <caption className="sr-only">
                  WeatherNext 3 and Open-Meteo forecasts compared at matching valid hours
                </caption>
                <thead className="sticky top-0 bg-slate-900/95 text-slate-300">
                  <tr>
                    {[
                      'Time',
                      'Google mean rain',
                      'Google p10–p90',
                      'Open-Meteo rain',
                      'Google temp.',
                      'Google wind',
                    ].map((label) => (
                      <th key={label} scope="col" className="p-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((hour) => {
                    const time = new Date(hour.time)
                    const match = openMeteo.get(time.getTime())
                    return (
                      <tr key={hour.time} className="border-t border-white/5 hover:bg-white/[0.02]">
                        <th scope="row" className="p-3 font-normal">
                          {formatDay(time, data.timeZone)} {formatHour(time, data.timeZone)}
                        </th>
                        <td className="p-3 text-violet-200">
                          {hour.precipitationMm.toFixed(1)} mm
                        </td>
                        <td className="p-3">
                          {hour.precipitationP10Mm.toFixed(1)}–
                          {hour.precipitationP90Mm.toFixed(1)} mm
                        </td>
                        <td className="p-3 text-sky-200">
                          {match ? `${match.precipMm.toFixed(1)} mm` : '—'}
                        </td>
                        <td className="p-3">{hour.temperatureC.toFixed(1)}°C</td>
                        <td className="p-3">{hour.windSpeedKmh.toFixed(1)} km/h</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-xs text-slate-400">
          <a
            href="https://developers.google.com/weathernext/guides/models"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Google WeatherNext 3
          </a>{' '}
          · Ensemble estimates do not provide thunderstorm codes or precipitation probabilities for
          this app’s alerts. Follow official local warnings.
        </p>
      </CardContent>
    </Card>
  )
}
