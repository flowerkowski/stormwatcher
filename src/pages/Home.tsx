import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  Bookmark,
  Compass,
  Loader2,
  MapPin,
  Radio,
  RefreshCw,
  Settings,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import type { AlertSettings, SavedLocation } from '@/types/weather'
import { DEFAULT_SETTINGS } from '@/types/weather'
import {
  formatCoords,
  isSameLocation,
  loadLocation,
  loadSavedLocations,
  loadSettings,
  overallStatus,
  saveLocation,
  saveSavedLocations,
  saveSettings,
  toggleSavedLocation,
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

const PRESET_CITIES: SavedLocation[] = [
  { name: 'Warsaw', latitude: 52.2297, longitude: 21.0122, country: 'Poland' },
  { name: 'London', latitude: 51.5074, longitude: -0.1278, country: 'United Kingdom' },
  { name: 'Zurich', latitude: 47.3769, longitude: 8.5417, country: 'Switzerland' },
  { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, country: 'Japan' },
]

export default function Home() {
  const [location, setLocation] = useState<SavedLocation | null>(() => loadLocation())
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(() =>
    loadSavedLocations(),
  )
  const [settings, setSettings] = useState<AlertSettings>(() =>
    loadSettings(DEFAULT_SETTINGS),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingLocation, setEditingLocation] = useState(false)

  const { data, loading, error, refresh } = useWeather(location, settings)

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => saveSavedLocations(savedLocations), [savedLocations])

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

  const isCurrentPinned = useMemo(
    () =>
      location ? savedLocations.some((item) => isSameLocation(item, location)) : false,
    [location, savedLocations],
  )

  const handleTogglePin = () => {
    if (!location) return
    setSavedLocations((prev) => toggleSavedLocation(prev, location))
  }

  const effectiveStatus = data ? overallStatus(data.events) : 'clear'

  const statusDotColor =
    effectiveStatus === 'storm'
      ? 'bg-violet-400 text-violet-300'
      : effectiveStatus === 'rain'
        ? 'bg-amber-400 text-amber-300'
        : 'bg-emerald-400 text-emerald-300'

  return (
    <div className="min-h-screen font-sans text-white">
      <WeatherBackground status={effectiveStatus} />
      <Toaster position="top-center" richColors closeButton />

      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* Header */}
        <header className="pt-5 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="instrument-panel flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/35 text-sky-300">
                <Radio className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-display text-lg leading-none font-bold tracking-tight">
                    StormWatch
                  </p>
                  <span className="font-mono hidden rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-slate-400 uppercase sm:inline-block">
                    WX-TELEMETRY
                  </span>
                </div>
                <p className="font-mono mt-1 text-[10px] tracking-[0.18em] text-slate-400 uppercase">
                  rain &amp; storm alerts
                </p>
              </div>
            </div>

            {location && (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setEditingLocation((v) => !v)}
                  aria-expanded={editingLocation}
                  aria-label={`Change location. Current location: ${location.name}`}
                  className="instrument-panel flex min-w-0 items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:border-sky-400/40 hover:bg-white/10 sm:px-3.5"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span className="font-display max-w-28 truncate font-semibold sm:max-w-44">
                    {location.name}
                  </span>
                  {location.country && (
                    <span className="hidden text-slate-400 md:inline">
                      · {location.country}
                    </span>
                  )}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleTogglePin}
                  title={isCurrentPinned ? 'Unpin station' : 'Pin station for quick access'}
                  aria-label={isCurrentPinned ? 'Unpin current location' : 'Pin current location'}
                  aria-pressed={isCurrentPinned}
                  className={`h-8 w-8 rounded-xl border ${
                    isCurrentPinned
                      ? 'border-sky-400/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Bookmark
                    className="h-3.5 w-3.5"
                    fill={isCurrentPinned ? 'currentColor' : 'none'}
                  />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void refresh()}
                  disabled={loading}
                  title="Refresh now"
                  aria-label="Refresh weather now"
                  className="h-8 w-8 rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSettingsOpen(true)}
                  title="Alert settings"
                  aria-label="Open alert settings"
                  className="h-8 w-8 rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Live Telemetry Sub-Bar & Pinned Stations */}
          {location && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2 font-mono text-[11px] text-slate-400 backdrop-blur">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5 text-slate-200">
                  <span className={`beacon-dot h-2 w-2 rounded-full ${statusDotColor}`} />
                  <span>LIVE POLL · {settings.refreshMinutes}M</span>
                </span>
                <span className="flex items-center gap-1 text-slate-400">
                  <Compass className="h-3 w-3 text-sky-400" />
                  {formatCoords(location.latitude, location.longitude)}
                </span>
                {heroData && (
                  <span>
                    UPDATED{' '}
                    {heroData.fetchedAt.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    ({heroData.timeZone})
                  </span>
                )}
              </div>

              {savedLocations.length > 0 && (
                <div
                  role="group"
                  aria-label="Pinned locations"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <span className="text-[10px] tracking-wider text-slate-500 uppercase">
                    Pinned:
                  </span>
                  {savedLocations.map((saved) => {
                    const active = isSameLocation(saved, location)
                    return (
                      <button
                        key={`${saved.latitude.toFixed(3)},${saved.longitude.toFixed(3)}`}
                        type="button"
                        onClick={() => pickLocation(saved)}
                        className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                          active
                            ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                            : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {saved.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </header>

        {/* Onboarding / location edit */}
        {(!location || editingLocation) && (
          <div
            className={`app-pop instrument-panel ${
              !location ? 'mt-12 md:mt-20' : 'mt-3'
            } mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-white/15 p-7 text-center backdrop-blur-xl md:p-10`}
          >
            {!editingLocation && (
              <>
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-400/35 bg-sky-500/15">
                  <MapPin className="h-7 w-7 text-sky-300" />
                </span>
                <h2 className="font-display mt-5 text-2xl font-bold tracking-tight md:text-3xl">
                  Where should we watch the sky?
                </h2>
                <p className="mt-2 mb-6 max-w-sm text-sm leading-relaxed text-slate-400">
                  Pick your location to monitor rain and thunderstorm forecasts.
                  Keep this tab open to receive forecast alerts.
                </p>
              </>
            )}
            {editingLocation && (
              <p className="font-display mb-4 text-sm font-semibold text-slate-200">
                Select or search monitoring station
              </p>
            )}
            <LocationSearch onSelect={pickLocation} compact />

            {/* Quick station presets */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
              <span className="font-mono mr-1 text-[10px] tracking-wider text-slate-500 uppercase">
                Quick stations:
              </span>
              {(savedLocations.length > 0 ? savedLocations : PRESET_CITIES).map((preset) => (
                <button
                  key={`${preset.name}-${preset.latitude}`}
                  type="button"
                  onClick={() => pickLocation(preset)}
                  className="font-mono rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-sky-400/40 hover:bg-sky-500/15 hover:text-white"
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {editingLocation && (
              <button
                type="button"
                onClick={() => setEditingLocation(false)}
                className="font-mono mt-5 text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
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
                <span className="flex-1">
                  {error} — check your connection and try again.{' '}
                  {data &&
                    'Showing the last successful forecast; it may be out of date.'}
                </span>
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
                <p className="font-mono text-sm">
                  Reading the sky over {location.name}…
                </p>
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
                  <AlertsPanel
                    events={visibleEvents}
                    timeZone={heroData.timeZone}
                    hours={heroData.hours}
                    settings={settings}
                  />
                </div>
                <DailyStrip daily={heroData.daily} timeZone={heroData.timeZone} />
                <WeatherNextPanel
                  key={`${location.latitude},${location.longitude}`}
                  data={heroData}
                />
                <footer className="space-y-1 pt-2 text-center font-mono text-[11px] leading-relaxed text-slate-500">
                  <p>
                    Monitoring every {settings.refreshMinutes} min · alert window{' '}
                    {Math.round(settings.leadMinutes / 60)}h · last updated{' '}
                    {heroData.fetchedAt.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}keep this tab open to receive alerts
                  </p>
                  <p>
                    Forecast alerts are informational. Follow your local weather authority for
                    official warnings.{' '}
                    <a
                      href="https://open-meteo.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-slate-700 underline-offset-2 hover:text-slate-300"
                    >
                      Weather data by Open-Meteo
                    </a>
                  </p>
                </footer>
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
