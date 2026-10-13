import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  CloudLightning,
  Loader2,
  MapPin,
  RefreshCw,
  Settings,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import type { AlertSettings, SavedLocation } from '@/types/weather'
import { DEFAULT_SETTINGS } from '@/types/weather'
import {
  loadLocation,
  loadSettings,
  overallStatus,
  saveLocation,
  saveSettings,
} from '@/lib/weather'
import { useWeather } from '@/hooks/useWeather'
import WeatherBackground from '@/components/WeatherBackground'
import StatusHero from '@/components/StatusHero'
import PrecipChart from '@/components/PrecipChart'
import AlertsPanel from '@/components/AlertsPanel'
import DailyStrip from '@/components/DailyStrip'
import LocationSearch from '@/components/LocationSearch'
import WeatherNextPanel from '@/components/WeatherNextPanel'

const SettingsPanel = lazy(() => import('@/components/SettingsPanel'))

export default function Home() {
  const [location, setLocation] = useState<SavedLocation | null>(() => loadLocation())
  const [settings, setSettings] = useState<AlertSettings>(() =>
    loadSettings(DEFAULT_SETTINGS),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingLocation, setEditingLocation] = useState(false)

  const { data, loading, error, refresh } = useWeather(location, settings)

  useEffect(() => saveSettings(settings), [settings])

  const visibleEvents = useMemo(() => {
    if (!data) return []
    return data.events.filter(
      (e) =>
        (e.level === 'storm' && settings.stormAlerts) ||
        (e.level !== 'storm' && settings.rainAlerts),
    )
  }, [data, settings.stormAlerts, settings.rainAlerts])

  const heroData = data

  const pickLocation = (loc: SavedLocation) => {
    setLocation(loc)
    saveLocation(loc)
    setEditingLocation(false)
  }

  const effectiveStatus = data ? overallStatus(data.events) : 'clear'

  return (
    <div className="min-h-screen font-sans text-white">
      <WeatherBackground status={effectiveStatus} />
      <Toaster position="top-center" richColors closeButton />

      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 py-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-violet-500 shadow-lg shadow-sky-500/25">
              <CloudLightning className="h-5 w-5 text-white" />
            </span>
            <div>
              <p className="text-lg leading-none font-bold tracking-tight">StormWatch</p>
              <p className="mt-0.5 text-[10px] tracking-[0.2em] text-slate-400 uppercase">
                rain &amp; storm alerts
              </p>
            </div>
          </div>

          {location && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditingLocation((v) => !v)}
                aria-expanded={editingLocation}
                aria-label={`Change location. Current location: ${location.name}`}
                className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-slate-200 backdrop-blur transition-colors hover:bg-white/10 sm:px-3.5"
              >
                <MapPin className="h-3.5 w-3.5 text-sky-300" />
                <span className="max-w-24 truncate sm:max-w-40">{location.name}</span>
                {location.country && (
                  <span className="hidden text-slate-500 md:inline">· {location.country}</span>
                )}
              </button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void refresh()}
                disabled={loading}
                title="Refresh now"
                aria-label="Refresh weather now"
                className="text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
                title="Alert settings"
                aria-label="Open alert settings"
                className="text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          )}
        </header>

        {/* Onboarding / location edit */}
        {(!location || editingLocation) && (
          <div
            className={`app-pop ${
              !location ? 'mt-16 md:mt-24' : 'mt-4'
            } mx-auto flex max-w-xl flex-col items-center rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center backdrop-blur-xl md:p-10`}
          >
            {!editingLocation && (
              <>
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400/30 to-violet-500/30">
                  <MapPin className="h-7 w-7 text-sky-300" />
                </span>
                <h2 className="mt-5 text-2xl font-bold tracking-tight md:text-3xl">
                  Where should we watch the sky?
                </h2>
                <p className="mt-2 mb-6 max-w-sm text-sm leading-relaxed text-slate-400">
                  Pick your location to monitor rain and thunderstorm forecasts.
                  Keep this tab open to receive forecast alerts.
                </p>
              </>
            )}
            {editingLocation && (
              <p className="mb-4 text-sm font-medium text-slate-300">Change location</p>
            )}
            <LocationSearch onSelect={pickLocation} compact />
            {editingLocation && (
              <button
                onClick={() => setEditingLocation(false)}
                className="mt-4 text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Dashboard */}
        {location && !editingLocation && (
          <main className="mt-2 space-y-4">
            {error && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2.5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
              >
                <TriangleAlert className="h-4 w-4 shrink-0" />
                <span className="flex-1">{error} — check your connection and try again. {data && 'Showing the last successful forecast; it may be out of date.'}</span>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="rounded-md border border-rose-300/30 px-2.5 py-1 text-xs font-semibold hover:bg-rose-200/10"
                >
                  Retry
                </button>
              </div>
            )}

            {!data && loading && (
              <div
                role="status"
                className="flex h-72 flex-col items-center justify-center gap-3 text-slate-400"
              >
                <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
                <p className="text-sm">Reading the sky over {location.name}…</p>
              </div>
            )}

            {heroData && (
              <>
                <StatusHero data={heroData} status={effectiveStatus} />
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="min-w-0 lg:col-span-2">
                    <PrecipChart
                      hours={heroData.hours}
                      settings={settings}
                      timeZone={heroData.timeZone}
                    />
                  </div>
                  <AlertsPanel events={visibleEvents} timeZone={heroData.timeZone} />
                </div>
                <DailyStrip daily={heroData.daily} timeZone={heroData.timeZone} />
                <WeatherNextPanel key={`${location.latitude},${location.longitude}`} data={heroData} />
                <p className="pt-2 text-center text-[11px] leading-relaxed text-slate-500">
                  Monitoring every {settings.refreshMinutes} min · last updated{' '}
                  {heroData.fetchedAt.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}keep this tab open to receive alerts
                </p>
                <p className="text-center text-[11px] text-slate-500">
                  Forecast alerts are informational. Follow your local weather authority for official warnings.
                </p>
                <p className="text-center text-[11px] text-slate-500">
                  <a
                    href="https://open-meteo.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
                  >
                    Weather data by Open-Meteo
                  </a>
                </p>
              </>
            )}
          </main>
        )}
      </div>

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel
            open
            onOpenChange={setSettingsOpen}
            settings={settings}
            onChange={setSettings}
          />
        </Suspense>
      )}
    </div>
  )
}
