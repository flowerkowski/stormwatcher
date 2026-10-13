import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, MapPin, Navigation, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GeoPlace, SavedLocation } from '@/types/weather'
import { searchPlaces } from '@/lib/weather'

interface Props {
  onSelect: (loc: SavedLocation) => void
  compact?: boolean
}

export default function LocationSearch({ onSelect, compact = false }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoPlace[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setSearching(false)
    setOpen(false)
    setActiveIndex(-1)
    if (query.trim().length < 2) {
      setResults([])
      setOpen(false)
      setSearchError(null)
      return
    }
    const debounce = window.setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const places = await searchPlaces(query.trim(), controller.signal)
        if (controller.signal.aborted) return
        setResults(places)
        setOpen(true)
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        setResults([])
        setSearchError('City search is unavailable right now. Please try again.')
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 350)
    return () => {
      window.clearTimeout(debounce)
      controller.abort()
    }
  }, [query])

  const pick = (p: GeoPlace) => {
    onSelect({
      name: p.name,
      latitude: p.latitude,
      longitude: p.longitude,
      country: p.country,
    })
    setOpen(false)
    setQuery('')
  }

  const useGps = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by this browser.')
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        // reverse-lookup a friendly name (best effort)
        let name = 'My location'
        try {
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
            { signal: AbortSignal.timeout(5000) },
          )
          if (!res.ok) throw new Error('Reverse geocoding failed')
          const j = await res.json()
          name = j.city || j.locality || j.principalSubdivision || name
          onSelect({ name, latitude, longitude, country: j.countryName || undefined })
          setLocating(false)
          return
        } catch {
          /* keep default name */
        }
        onSelect({ name, latitude, longitude })
        setLocating(false)
      },
      (err) => {
        setLocating(false)
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — search for your city instead.'
            : 'Could not determine your position — try searching instead.',
        )
      },
      { timeout: 12000, maximumAge: 300000 },
    )
  }

  return (
    <div className={compact ? 'w-full' : 'w-full max-w-md'}>
      <div className="flex gap-2">
        <div ref={boxRef} className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
              if (results.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setOpen(true)
                setActiveIndex((index) => event.key === 'ArrowDown'
                  ? (index + 1) % results.length
                  : (index <= 0 ? results.length - 1 : index - 1))
              }
              if (event.key === 'Enter' && open && activeIndex >= 0 && results[activeIndex]) {
                event.preventDefault()
                pick(results[activeIndex])
              }
            }}
            role="combobox"
            aria-label="Search for a city"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open && results.length > 0}
            aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            autoComplete="off"
            placeholder="Search your city…"
            className="border-white/15 bg-white/[0.06] pl-9 text-white placeholder:text-slate-500 focus-visible:ring-sky-400/50"
          />
          {searching && (
            <Loader2 className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
          )}
          {open && results.length > 0 && (
            <div
              id={listId}
              role="listbox"
              aria-label="Matching locations"
              className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur-xl"
            >
              {results.map((p, index) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  id={`${listId}-${index}`}
                  tabIndex={-1}
                  aria-selected={activeIndex === index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(p)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-slate-200 transition-colors hover:bg-white/10 ${activeIndex === index ? 'bg-white/10' : ''}`}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span className="truncate">
                    {p.name}
                    <span className="text-slate-500">
                      {p.admin1 ? `, ${p.admin1}` : ''}
                      {p.country ? ` · ${p.country}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"
          onClick={useGps}
          disabled={locating}
          aria-label={locating ? 'Determining your location' : 'Use GPS location'}
          variant="outline"
          className="shrink-0 border-sky-400/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 hover:text-sky-100"
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="h-4 w-4" />
          )}
          <span className="ml-1.5 hidden sm:inline">{locating ? 'Locating…' : 'Use GPS'}</span>
        </Button>
      </div>
      <div aria-live="polite">
        {searchError && <p className="mt-2 text-xs text-rose-300">{searchError}</p>}
        {geoError && <p className="mt-2 text-xs text-rose-300">{geoError}</p>}
        {!searching && open && query.trim().length >= 2 && results.length === 0 && !searchError && (
          <p className="mt-2 text-xs text-slate-400">No matching locations found.</p>
        )}
      </div>
    </div>
  )
}
