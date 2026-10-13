import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEvents, classifyHour, validateForecast, overallStatus, alertSignature, fetchWeather, loadLocation, loadSettings } from '../src/lib/weather.ts'
import { DEFAULT_SETTINGS } from '../src/types/weather.ts'
import { parseWeatherNext } from '../src/lib/weathernext.ts'

const base = Math.floor(Date.now() / 3600000) * 3600000
const hour = (offset, level = 'rain') => ({ time: new Date(base + offset * 3600000), temp: 10, precipProb: 70, precipMm: 2, code: 61, gusts: 20, level })

test('events separate at missing hourly steps and use the final severity in their ID', () => {
  const events = buildEvents([hour(0), hour(1, 'storm'), hour(3)])
  assert.equal(events.length, 2)
  assert.equal(events[0].level, 'storm')
  assert.ok(events[0].id.startsWith('storm-'))
  assert.equal(events[0].hours, 2)
  assert.equal(events[0].totalMm, 4)
  assert.equal(events[0].ongoing, true)
  assert.equal(events[1].hours, 1)
})

test('dry buckets break events and expired events are removed', () => {
  const events = buildEvents([hour(-3), hour(-2, null), hour(1), hour(2, null), hour(3)])
  assert.equal(events.length, 2)
  assert.equal(events[0].start.getTime(), base + 3600000)
})

test('classification preserves storm priority and threshold boundaries', () => {
  assert.equal(classifyHour(95, 0, 0, DEFAULT_SETTINGS), 'storm')
  assert.equal(classifyHour(61, 40, 4, DEFAULT_SETTINGS), 'heavy')
  assert.equal(classifyHour(0, 50, 0, DEFAULT_SETTINGS), 'rain')
  assert.equal(classifyHour(0, 49, 0, DEFAULT_SETTINGS), null)
  assert.equal(overallStatus(buildEvents([hour(1, 'storm')])), 'storm')
  assert.equal(alertSignature(buildEvents([hour(14)]), 720), '')
})

function forecastFixture() {
  return {
    timezone: 'Europe/Warsaw',
    current: { time: base / 1000, temperature_2m: 10, relative_humidity_2m: 70, apparent_temperature: 9, weather_code: 61, wind_speed_10m: 10, wind_gusts_10m: 20 },
    hourly: { time: [base / 1000, base / 1000 + 3600], temperature_2m: [10, 11], precipitation_probability: [0, 60], precipitation: [0, 2], weather_code: [0, 61], wind_gusts_10m: [10, 20] },
    daily: { time: [base / 1000], weather_code: [61], temperature_2m_max: [15], temperature_2m_min: [8], precipitation_probability_max: [60], precipitation_sum: [2] },
  }
}

test('provider validation accepts complete data, rejects nulls, missing columns, stale hours, invalid probabilities and mismatched lengths', () => {
  validateForecast(forecastFixture())
  for (const corrupt of [
    (f) => { f.hourly.precipitation[0] = null },
    (f) => { delete f.hourly.weather_code },
    (f) => { f.hourly.temperature_2m.pop() },
    (f) => { f.hourly.precipitation_probability[0] = 101 },
    (f) => { f.hourly.time = f.hourly.time.map((t) => t - 86400) },
    (f) => { f.timezone = 'invalid' },
  ]) {
    const fixture = forecastFixture()
    corrupt(fixture)
    assert.throws(() => validateForecast(fixture), /incomplete forecast/)
  }
})

function googleFixture() {
  return { model: 'WeatherNext 3', initializedAt: new Date(base - 3600000).toISOString(), fetchedAt: new Date().toISOString(), grid: { latitude: 52.2, longitude: 21, resolutionDegrees: 0.1 }, hours: Array.from({ length: 48 }, (_, i) => ({ time: new Date(base + (i + 1) * 3600000).toISOString(), temperatureC: 10, precipitationMm: 2, precipitationP10Mm: 0, precipitationP90Mm: 5, windSpeedKmh: 20 })) }
}

test('WeatherNext contract refuses unknown models, percentile inversions, missing stats and mixed or stale timelines', () => {
  assert.equal(parseWeatherNext(googleFixture()).model, 'WeatherNext 3')
  for (const corrupt of [
    (f) => { f.model = 'WeatherNext 2' },
    (f) => { f.hours[0].precipitationP10Mm = 10 },
    (f) => { f.hours[0].precipitationMm = null },
    (f) => { f.hours[1].time = f.hours[0].time },
    (f) => { f.initializedAt = new Date(base - 48 * 3600000).toISOString() },
    (f) => { f.hours.pop() },
    (f) => { f.fetchedAt = new Date(Date.now() - 21 * 60_000).toISOString() },
    (f) => { f.fetchedAt = new Date(Date.now() + 120_000).toISOString() },
    (f) => { f.hours = f.hours.map((h) => ({ ...h, time: new Date(Date.parse(h.time) + 60_000).toISOString() })) },
  ]) {
    const fixture = googleFixture()
    corrupt(fixture)
    assert.throws(() => parseWeatherNext(fixture))
  }
})

test('precipitation valid at the next hour belongs to the current alert bucket', async (t) => {
  const fixture = forecastFixture()
  const requested = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(String(url))
    return new Response(JSON.stringify(fixture))
  })
  const result = await fetchWeather({ name: 'Warsaw', latitude: 52.2, longitude: 21 }, DEFAULT_SETTINGS)
  assert.equal(result.hours[0].time.getTime(), base)
  assert.equal(result.hours[0].precipitationTime.getTime(), base + 3600000)
  assert.equal(result.hours[0].precipMm, 2)
  assert.equal(result.hours[0].precipProb, 60)
  assert.equal(result.events[0].ongoing, true)
  assert.ok(requested[0].includes('wind_speed_unit=kmh'))
})

test('invalid saved settings and coordinates cannot break forecast polling', (t) => {
  const store = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => store.get(key) ?? null } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage })
  store.set('stormwatch.location', JSON.stringify({ name: 'Bad', latitude: 900, longitude: 0 }))
  assert.equal(loadLocation(), null)
  store.set('stormwatch.settings', JSON.stringify({ rainThreshold: null, refreshMinutes: -10, soundEnabled: 'false', rainAlerts: false }))
  const settings = loadSettings(DEFAULT_SETTINGS)
  assert.equal(settings.refreshMinutes, 15)
  assert.equal(settings.rainThreshold, 50)
  assert.equal(settings.soundEnabled, true)
  assert.equal(settings.rainAlerts, false)
})
