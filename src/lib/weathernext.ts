import type { SavedLocation } from '@/types/weather'

export interface WeatherNextHour {
  time: string
  temperatureC: number
  temperatureP10C?: number
  temperatureP90C?: number
  dewpointC?: number
  precipitationMm: number
  precipitationP10Mm: number
  precipitationP25Mm?: number
  precipitationP50Mm?: number
  precipitationP75Mm?: number
  precipitationP90Mm: number
  imergPrecipitationMm?: number
  windSpeedKmh: number
  windSpeedP10Kmh?: number
  windSpeedP90Kmh?: number
  windSpeed100mKmh?: number
  cloudCoverPct?: number
  pressureHpa?: number
  solarRadiationWm2?: number
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
  const optionalFinite = (n: unknown, min?: number) =>
    n === undefined || (finite(n) && (min === undefined || (n as number) >= min))

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
      || !optionalFinite(hour.temperatureP10C)
      || !optionalFinite(hour.temperatureP90C)
      || !optionalFinite(hour.dewpointC)
      || !optionalFinite(hour.precipitationP25Mm, 0)
      || !optionalFinite(hour.precipitationP50Mm, 0)
      || !optionalFinite(hour.precipitationP75Mm, 0)
      || !optionalFinite(hour.imergPrecipitationMm, 0)
      || !optionalFinite(hour.windSpeedP10Kmh, 0)
      || !optionalFinite(hour.windSpeedP90Kmh, 0)
      || !optionalFinite(hour.windSpeed100mKmh, 0)
      || !optionalFinite(hour.cloudCoverPct, 0)
      || !optionalFinite(hour.pressureHpa, 0)
      || !optionalFinite(hour.solarRadiationWm2, 0)
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
