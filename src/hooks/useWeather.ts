import { useCallback, useEffect, useRef, useState } from 'react'
import type { AlertEvent, AlertSettings, SavedLocation, WeatherBundle } from '@/types/weather'
import {
  alertSignature,
  fetchWeather,
  formatEta,
  loadSignature,
  saveSignature,
} from '@/lib/weather'
import { playAlertSound } from '@/lib/sound'
import { toast } from 'sonner'

function eventMessage(e: AlertEvent): { title: string; body: string } {
  const eta = e.ongoing ? 'happening now' : `starting ${formatEta(e.startsInMin)}`
  const dur = e.hours > 1 ? `, ~${e.hours} h` : ''
  if (e.level === 'storm') {
    return {
      title: '⛈ Thunderstorm forecast',
      body: `Thunderstorm ${eta}${dur}. Peak precipitation probability ${e.peakProb}%${e.maxGusts >= 50 ? `, gusts up to ${Math.round(e.maxGusts)} km/h` : ''}.`,
    }
  }
  if (e.level === 'heavy') {
    return {
      title: '🌧 Heavy rain alert',
      body: `Heavy rain ${eta}${dur}. Expect ~${e.totalMm.toFixed(1)} mm total.`,
    }
  }
  return {
    title: '🌦 Rain approaching',
    body: `Rain ${eta}${dur}. Peak probability ${e.peakProb}%.`,
  }
}

function fireNotification(title: string, body: string) {
  try {
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        tag: 'stormwatch',
        icon: new URL('favicon.svg', document.baseURI).href,
      })
    }
  } catch {
    // some browsers require a service worker — toast still covers it
  }
}

export function useWeather(location: SavedLocation | null, settings: AlertSettings) {
  const [data, setData] = useState<WeatherBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prevSig = useRef<string | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const { rainThreshold, heavyMmPerHour } = settings

  const refresh = useCallback(async () => {
    if (!location) return
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setLoading(true)
    setError(null)
    try {
      const bundle = await fetchWeather(
        location,
        { ...settingsRef.current, rainThreshold, heavyMmPerHour },
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      )
      if (controller.signal.aborted) return
      setData(bundle)

      const s = settingsRef.current
      const relevant = bundle.events.filter(
        (e) =>
          (e.level === 'storm' && s.stormAlerts) ||
          (e.level !== 'storm' && s.rainAlerts),
      )
      const sig = alertSignature(relevant, s.leadMinutes)

      if (prevSig.current === null) {
        // first load: establish baseline, only shout about ongoing storms
        prevSig.current = loadSignature(location)
        const ongoingStorm = relevant.find((e) => e.ongoing && e.level === 'storm')
        if (ongoingStorm && prevSig.current !== sig) {
          const m = eventMessage(ongoingStorm)
          toast.warning(m.title, { description: m.body, duration: 10000 })
        }
      } else if (sig !== prevSig.current && sig !== '') {
        // something new or escalated — announce the most severe fresh event
        const fresh = relevant
          .filter((e) => e.ongoing || e.startsInMin <= s.leadMinutes)
          .sort((a, b) => {
            const rank = (x: AlertEvent) => (x.level === 'storm' ? 3 : x.level === 'heavy' ? 2 : 1)
            return rank(b) - rank(a) || a.start.getTime() - b.start.getTime()
          })
        const top = fresh.find(
          (e) => !prevSig.current!.includes(e.start.toISOString().slice(0, 13)),
        ) ?? fresh[0]
        if (top) {
          const m = eventMessage(top)
          if (top.level === 'storm') toast.error(m.title, { description: m.body, duration: 15000 })
          else toast.warning(m.title, { description: m.body, duration: 10000 })
          if (s.notifyEnabled) fireNotification(m.title, m.body)
          if (s.soundEnabled) playAlertSound(top.level)
        }
      }
      prevSig.current = sig
      saveSignature(location, sig)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : 'Failed to load weather')
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setLoading(false)
      }
    }
  }, [location, rainThreshold, heavyMmPerHour])

  useEffect(() => () => activeRequest.current?.abort(), [])

  // initial fetch + when location changes
  useEffect(() => {
    prevSig.current = null
    setData(null)
    void refresh()
    return () => activeRequest.current?.abort()
  }, [refresh])

  // polling
  useEffect(() => {
    if (!location) return
    const ms = Math.max(5, settings.refreshMinutes) * 60_000
    const id = window.setInterval(() => void refresh(), ms)
    return () => window.clearInterval(id)
  }, [location, settings.refreshMinutes, refresh])

  return { data, loading, error, refresh }
}
