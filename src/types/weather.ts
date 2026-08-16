export interface GeoPlace {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

export interface SavedLocation {
  name: string
  latitude: number
  longitude: number
  country?: string
}

export interface CurrentWeather {
  temp: number
  feelsLike: number
  humidity: number
  code: number
  windSpeed: number
  windGusts: number
  time: Date
}

export interface DailyForecast {
  date: Date
  code: number
  tempMax: number
  tempMin: number
  precipProbMax: number
  precipSum: number
}

export type AlertLevel = 'storm' | 'heavy' | 'rain'

export interface HourPoint {
  time: Date
  temp: number
  precipProb: number
  precipMm: number
  code: number
  gusts: number
  level: AlertLevel | null
}

export interface AlertEvent {
  id: string
  level: AlertLevel
  start: Date
  end: Date
  hours: number
  peakProb: number
  totalMm: number
  maxGusts: number
  ongoing: boolean
  startsInMin: number
}

export interface WeatherBundle {
  location: SavedLocation
  timeZone: string
  current: CurrentWeather
  hours: HourPoint[]
  events: AlertEvent[]
  daily: DailyForecast[]
  fetchedAt: Date
}

export type SkyStatus = 'storm' | 'rain' | 'clear'

export interface AlertSettings {
  rainThreshold: number // % probability that counts as "rain coming"
  heavyMmPerHour: number // mm/h considered heavy rain
  stormAlerts: boolean
  rainAlerts: boolean
  notifyEnabled: boolean
  soundEnabled: boolean
  refreshMinutes: number
  leadMinutes: number // only alert for events starting within this window
}

export const DEFAULT_SETTINGS: AlertSettings = {
  rainThreshold: 50,
  heavyMmPerHour: 4,
  stormAlerts: true,
  rainAlerts: true,
  notifyEnabled: false,
  soundEnabled: true,
  refreshMinutes: 15,
  leadMinutes: 720, // 12 h
}
