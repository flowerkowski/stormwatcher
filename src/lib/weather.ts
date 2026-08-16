import type {
  AlertEvent,
  AlertLevel,
  AlertSettings,
  CurrentWeather,
  DailyForecast,
  GeoPlace,
  HourPoint,
  SavedLocation,
  SkyStatus,
  WeatherBundle,
} from '@/types/weather'

/* ---------------- WMO weather-code mapping ---------------- */

export type CodeKind =
  | 'clear'
  | 'partly'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'freezing'
  | 'snow'
  | 'showers'
  | 'storm'

interface CodeInfo {
  label: string
  kind: CodeKind
}

const WMO: Record<number, CodeInfo> = {
  0: { label: 'Clear sky', kind: 'clear' },
  1: { label: 'Mainly clear', kind: 'clear' },
  2: { label: 'Partly cloudy', kind: 'partly' },
  3: { label: 'Overcast', kind: 'cloud' },
  45: { label: 'Fog', kind: 'fog' },
  48: { label: 'Rime fog', kind: 'fog' },
  51: { label: 'Light drizzle', kind: 'drizzle' },
  53: { label: 'Drizzle', kind: 'drizzle' },
  55: { label: 'Dense drizzle', kind: 'drizzle' },
  56: { label: 'Freezing drizzle', kind: 'freezing' },
  57: { label: 'Freezing drizzle', kind: 'freezing' },
  61: { label: 'Light rain', kind: 'rain' },
  63: { label: 'Rain', kind: 'rain' },
  65: { label: 'Heavy rain', kind: 'rain' },
  66: { label: 'Freezing rain', kind: 'freezing' },
  67: { label: 'Freezing rain', kind: 'freezing' },
  71: { label: 'Light snow', kind: 'snow' },
  73: { label: 'Snow', kind: 'snow' },
  75: { label: 'Heavy snow', kind: 'snow' },
  77: { label: 'Snow grains', kind: 'snow' },
  80: { label: 'Light showers', kind: 'showers' },
  81: { label: 'Rain showers', kind: 'showers' },
  82: { label: 'Violent showers', kind: 'showers' },
  85: { label: 'Snow showers', kind: 'snow' },
  86: { label: 'Snow showers', kind: 'snow' },
  95: { label: 'Thunderstorm', kind: 'storm' },
  96: { label: 'Thunderstorm with hail', kind: 'storm' },
  99: { label: 'Thunderstorm with hail', kind: 'storm' },
}

export function codeInfo(code: number): CodeInfo {
  return WMO[code] ?? { label: 'Unknown', kind: 'cloud' }
}

export function isStormCode(code: number): boolean {
  return code === 95 || code === 96 || code === 99
}

export function isWetCode(code: number): boolean {
  const k = WMO[code]?.kind
  return (
    k === 'drizzle' ||
    k === 'rain' ||
    k === 'freezing' ||
    k === 'showers' ||
    k === 'snow' ||
    k === 'storm'
  )
}

/* ---------------- API ---------------- */

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    query,
  )}&count=6&language=en&format=json`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('Geocoding failed')
  const json = await res.json()
  return (json.results ?? []) as GeoPlace[]
}

interface ForecastApiResponse {
  timezone: string
  current: {
    time: number
    temperature_2m: number
    relative_humidity_2m: number
    apparent_temperature: number
    weather_code: number
    wind_speed_10m: number
    wind_gusts_10m: number
  }
  hourly: {
    time: number[]
    temperature_2m: number[]
    precipitation_probability: number[]
    precipitation: number[]
    weather_code: number[]
    wind_gusts_10m: number[]
  }
  daily: {
    time: number[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: number[]
    precipitation_sum: number[]
  }
}

export async function fetchWeather(
  loc: SavedLocation,
  settings: AlertSettings,
  signal?: AbortSignal,
): Promise<WeatherBundle> {
  const params = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m',
    hourly:
      'temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '7',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`)
  const json = (await res.json()) as ForecastApiResponse

  const current: CurrentWeather = {
    temp: json.current.temperature_2m,
    feelsLike: json.current.apparent_temperature,
    humidity: json.current.relative_humidity_2m,
    code: json.current.weather_code,
    windSpeed: json.current.wind_speed_10m,
    windGusts: json.current.wind_gusts_10m,
    time: new Date(json.current.time * 1000),
  }

  const now = Date.now()
  const hours: HourPoint[] = json.hourly.time
    .map((t, i) => {
      const time = new Date(t * 1000)
      const code = json.hourly.weather_code[i]
      const prob = json.hourly.precipitation_probability?.[i] ?? 0
      const mm = json.hourly.precipitation?.[i] ?? 0
      return {
        time,
        temp: json.hourly.temperature_2m[i],
        precipProb: prob,
        precipMm: mm,
        code,
        gusts: json.hourly.wind_gusts_10m?.[i] ?? 0,
        level: classifyHour(code, prob, mm, settings),
      }
    })
    // Keep the current hourly bucket plus 48 hours ahead.
    .filter((h) => h.time.getTime() > now - 3600_000 && h.time.getTime() < now + 48 * 3600_000)

  const events = buildEvents(hours)

  const daily: DailyForecast[] = json.daily.time.map((t, i) => ({
    date: new Date(t * 1000),
    code: json.daily.weather_code[i],
    tempMax: json.daily.temperature_2m_max[i],
    tempMin: json.daily.temperature_2m_min[i],
    precipProbMax: json.daily.precipitation_probability_max?.[i] ?? 0,
    precipSum: json.daily.precipitation_sum?.[i] ?? 0,
  }))

  return {
    location: loc,
    timeZone: json.timezone,
    current,
    hours,
    events,
    daily,
    fetchedAt: new Date(),
  }
}

/* ---------------- Alert engine ---------------- */

function classifyHour(
  code: number,
  prob: number,
  mm: number,
  s: AlertSettings,
): AlertLevel | null {
  if (isStormCode(code)) return 'storm'
  if (mm >= s.heavyMmPerHour && prob >= 40) return 'heavy'
  if (prob >= s.rainThreshold) return 'rain'
  // wet weather code with meaningful probability — count it as rain even if
  // the model probability sits just below the threshold
  if (isWetCode(code) && mm >= 0.2 && prob >= Math.max(30, s.rainThreshold - 25))
    return 'rain'
  return null
}

function levelRank(l: AlertLevel): number {
  return l === 'storm' ? 3 : l === 'heavy' ? 2 : 1
}

export function buildEvents(hours: HourPoint[]): AlertEvent[] {
  const events: AlertEvent[] = []
  let cur: AlertEvent | null = null
  const now = Date.now()

  const flush = () => {
    if (cur) events.push(cur)
    cur = null
  }

  for (const h of hours) {
    if (!h.level) {
      flush()
      continue
    }
    const t = h.time.getTime()
    if (!cur) {
      cur = {
        id: `${h.level}-${h.time.toISOString()}`,
        level: h.level,
        start: h.time,
        end: new Date(t + 3600_000),
        hours: 1,
        peakProb: h.precipProb,
        totalMm: h.precipMm,
        maxGusts: h.gusts,
        ongoing: t <= now && now < t + 3600_000,
        startsInMin: Math.round((t - now) / 60000),
      }
    } else {
      if (levelRank(h.level) > levelRank(cur.level)) cur.level = h.level
      cur.end = new Date(t + 3600_000)
      cur.hours += 1
      cur.peakProb = Math.max(cur.peakProb, h.precipProb)
      cur.totalMm += h.precipMm
      cur.maxGusts = Math.max(cur.maxGusts, h.gusts)
      if (t <= now && now < t + 3600_000) cur.ongoing = true
      cur.startsInMin = Math.min(cur.startsInMin, Math.round((t - now) / 60000))
    }
  }
  flush()
  // The current-hour bucket is retained so ongoing events are detected, but an
  // event that has already ended must never be presented as an active alert.
  return events.filter((event) => event.end.getTime() > now)
}

export function overallStatus(events: AlertEvent[]): SkyStatus {
  if (events.some((e) => e.level === 'storm')) return 'storm'
  if (events.length > 0) return 'rain'
  return 'clear'
}

/** Stable signature used to detect *new* alerts between polls. */
export function alertSignature(events: AlertEvent[], leadMinutes: number): string {
  return events
    .filter((e) => e.ongoing || e.startsInMin <= leadMinutes)
    .map((e) => `${e.level}@${e.start.toISOString().slice(0, 13)}${e.ongoing ? '!' : ''}`)
    .sort()
    .join('|')
}

export function formatEta(min: number): string {
  if (min <= 0) return 'now'
  if (min < 60) return `in ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m > 15 ? `in ${h} h ${m} m` : `in ${h} h`
  const d = Math.floor(h / 24)
  return `in ${d} day${d > 1 ? 's' : ''}`
}

export function formatHour(d: Date, timeZone?: string): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone })
}

export function formatDay(d: Date, timeZone?: string): string {
  return d.toLocaleDateString([], { weekday: 'short', timeZone })
}

/* ---------------- Persistence ---------------- */

const LOC_KEY = 'stormwatch.location'
const SETTINGS_KEY = 'stormwatch.settings'
const SIG_KEY = 'stormwatch.signature'

export function loadLocation(): SavedLocation | null {
  try {
    const raw = localStorage.getItem(LOC_KEY)
    return raw ? (JSON.parse(raw) as SavedLocation) : null
  } catch {
    return null
  }
}

export function saveLocation(loc: SavedLocation | null) {
  try {
    if (loc) localStorage.setItem(LOC_KEY, JSON.stringify(loc))
    else localStorage.removeItem(LOC_KEY)
  } catch {
    // Storage can be unavailable in strict privacy modes; the in-memory app still works.
  }
}

export function loadSettings<T>(defaults: T): T {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaults, ...(JSON.parse(raw) as T) } : defaults
  } catch {
    return defaults
  }
}

export function saveSettings(s: unknown) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // Non-critical persistence failure.
  }
}

function signatureKey(loc: SavedLocation): string {
  return `${SIG_KEY}.${loc.latitude.toFixed(3)},${loc.longitude.toFixed(3)}`
}

export function loadSignature(loc: SavedLocation): string {
  try {
    return localStorage.getItem(signatureKey(loc)) ?? ''
  } catch {
    return ''
  }
}

export function saveSignature(loc: SavedLocation, sig: string) {
  try {
    localStorage.setItem(signatureKey(loc), sig)
  } catch {
    // Non-critical persistence failure.
  }
}
