import type { SavedLocation } from '@/types/weather'

export interface WeatherNextHour {
  time: string
  temperatureC: number
  precipitationMm: number
  precipitationP10Mm: number
  precipitationP90Mm: number
  windSpeedKmh: number
}

export interface WeatherNextForecast {
  model: 'WeatherNext 3'
  initializedAt: string
  fetchedAt: string
  grid: { latitude: number; longitude: number; resolutionDegrees: 0.1 }
  hours: WeatherNextHour[]
}

export const weatherNextEndpoint = import.meta.env?.VITE_WEATHERNEXT_API_URL as string | undefined

export function parseWeatherNext(value: unknown): WeatherNextForecast {
  const data = value as WeatherNextForecast
  const validDate = (s: unknown) => typeof s === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s))
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  if (!data || data.model !== 'WeatherNext 3' || !validDate(data.initializedAt) || !validDate(data.fetchedAt)
    || !data.grid || data.grid.resolutionDegrees !== 0.1
    || !finite(data.grid.latitude) || Math.abs(data.grid.latitude) > 90
    || !finite(data.grid.longitude) || Math.abs(data.grid.longitude) > 180
    || !Array.isArray(data.hours) || data.hours.length !== 48) {
    throw new Error('WeatherNext returned an invalid forecast')
  }
  const now = Date.now()
  const fetched = Date.parse(data.fetchedAt)
  if (fetched > now + 60_000 || now - fetched > 20 * 60_000) {
    throw new Error('WeatherNext returned an outdated or invalid fetch timestamp')
  }
  if (Date.parse(data.initializedAt) > now || now - Date.parse(data.initializedAt) > 24 * 3600_000) {
    throw new Error('WeatherNext has no recent model run available')
  }
  if (Date.parse(data.initializedAt) > fetched || Date.parse(data.initializedAt) % 3600_000 !== 0) {
    throw new Error('WeatherNext returned an invalid model initialization')
  }
  const firstHour = Math.floor(fetched / 3600_000) * 3600_000 + 3600_000
  for (const [i, hour] of data.hours.entries()) {
    if (!hour || !validDate(hour.time) || !finite(hour.temperatureC)
      || ![hour.precipitationMm, hour.precipitationP10Mm, hour.precipitationP90Mm, hour.windSpeedKmh].every((n) => finite(n) && n >= 0)
      || hour.precipitationP10Mm > hour.precipitationP90Mm
      || Date.parse(hour.time) <= Date.parse(data.initializedAt)
      || Date.parse(hour.time) !== firstHour + i * 3600_000) {
      throw new Error('WeatherNext returned incomplete hourly statistics')
    }
  }
  if (!data.hours.some((h) => Date.parse(h.time) > now && Date.parse(h.time) <= now + 3600_000)) {
    throw new Error('WeatherNext forecast does not cover the next hour')
  }
  return data
}

export async function fetchWeatherNext(location: SavedLocation, endpoint: string, signal: AbortSignal) {
  const url = new URL(endpoint, window.location.href)
  url.searchParams.set('latitude', String(location.latitude))
  url.searchParams.set('longitude', String(location.longitude))
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(response.status === 503
      ? 'WeatherNext access or backend configuration is unavailable.'
      : response.status === 429 ? 'WeatherNext query limit reached. Try again later.'
        : `WeatherNext request failed (${response.status}).`)
  }
  return parseWeatherNext(await response.json())
}
