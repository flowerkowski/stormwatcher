import { useId, useMemo, useRef, useState } from 'react'
import { Droplets, Thermometer, Wind } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AlertSettings, HourPoint } from '@/types/weather'
import { codeInfo, formatDay, formatHour, isStormCode } from '@/lib/weather'

interface Props {
  hours: HourPoint[]
  settings: AlertSettings
  timeZone: string
}

type OverlayMode = 'none' | 'gusts' | 'temp'

const WIDTH = 960
const HEIGHT = 276
const MARGIN = { top: 24, right: 20, bottom: 46, left: 48 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

export default function PrecipChart({ hours, settings, timeZone }: Props) {
  const gradientId = useId().replaceAll(':', '')
  const svgRef = useRef<SVGSVGElement>(null)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [overlay, setOverlay] = useState<OverlayMode>('gusts')

  const chart = useMemo(() => {
    const rows = hours.map((hour) => ({
      ...hour,
      probability: Math.round(hour.precipProb),
      storm: isStormCode(hour.code),
      dayLabel: formatDay(hour.time, timeZone),
      hourLabel: formatHour(hour.time, timeZone),
    }))
    const step = rows.length > 1 ? PLOT_WIDTH / (rows.length - 1) : PLOT_WIDTH
    const x = (index: number) => MARGIN.left + index * step
    const y = (probability: number) =>
      MARGIN.top + PLOT_HEIGHT - (Math.max(0, Math.min(100, probability)) / 100) * PLOT_HEIGHT

    const line = rows
      .map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(row.probability)}`)
      .join(' ')
    const area = rows.length
      ? `${line} L ${x(rows.length - 1)} ${MARGIN.top + PLOT_HEIGHT} L ${x(0)} ${MARGIN.top + PLOT_HEIGHT} Z`
      : ''

    const maxMm = Math.max(1, ...rows.map((row) => row.precipMm))
    const totalMm = rows.reduce((acc, r) => acc + r.precipMm, 0)
    const peakProb = rows.length ? Math.max(...rows.map((r) => r.probability)) : 0
    const maxGusts = rows.length ? Math.max(...rows.map((r) => r.gusts)) : 0
    const gustCeiling = Math.max(60, Math.ceil(maxGusts / 10) * 10)
    const minTemp = rows.length ? Math.min(...rows.map((r) => r.temp)) : 0
    const maxTemp = rows.length ? Math.max(...rows.map((r) => r.temp)) : 20
    const tempSpan = Math.max(4, maxTemp - minTemp)

    const yGust = (gust: number) =>
      MARGIN.top + PLOT_HEIGHT - (Math.max(0, Math.min(gustCeiling, gust)) / gustCeiling) * PLOT_HEIGHT

    const yTemp = (t: number) =>
      MARGIN.top +
      PLOT_HEIGHT * 0.12 +
      (1 - (t - minTemp) / tempSpan) * (PLOT_HEIGHT * 0.76)

    const gustLine = rows
      .map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${yGust(row.gusts)}`)
      .join(' ')

    const tempLine = rows
      .map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${yTemp(row.temp)}`)
      .join(' ')

    const stormWindows: Array<{ start: number; end: number }> = []
    let stormStart: number | null = null
    rows.forEach((row, index) => {
      if (row.storm && stormStart === null) stormStart = index
      if ((!row.storm || index === rows.length - 1) && stormStart !== null) {
        stormWindows.push({
          start: stormStart,
          end: row.storm && index === rows.length - 1 ? index : index - 1,
        })
        stormStart = null
      }
    })

    const dayTransitions: Array<{ index: number; label: string }> = []
    rows.forEach((row, index) => {
      if (index > 0 && row.dayLabel !== rows[index - 1].dayLabel) {
        dayTransitions.push({ index, label: row.dayLabel })
      }
    })

    return {
      rows,
      step,
      x,
      y,
      yGust,
      yTemp,
      line,
      area,
      gustLine,
      tempLine,
      maxMm,
      totalMm,
      peakProb,
      maxGusts,
      minTemp,
      maxTemp,
      stormWindows,
      dayTransitions,
    }
  }, [hours, timeZone])

  const summary = chart.rows.length
    ? `Hourly rain probability for the next ${chart.rows.length} hours. Peak probability ${chart.peakProb} percent.`
    : 'No hourly forecast data available.'

  const activeRow =
    activeIdx !== null && chart.rows[activeIdx] ? chart.rows[activeIdx] : null

  const updatePointerIndex = (clientX: number) => {
    const svg = svgRef.current
    if (!svg || !chart.rows.length) return
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0) return
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH
    const rawIdx = Math.round((svgX - MARGIN.left) / chart.step)
    const clamped = Math.max(0, Math.min(chart.rows.length - 1, rawIdx))
    setActiveIdx(clamped)
  }

  return (
    <div className="app-enter h-full [animation-delay:75ms]">
      <Card className="instrument-panel h-full rounded-2xl border-white/10 text-white backdrop-blur-xl">
        <CardHeader className="space-y-3 pb-2">
          <CardTitle className="flex flex-col gap-2.5 text-base font-semibold sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="font-display tracking-tight">
                Precipitation &amp; atmospheric outlook — 48h
              </span>
            </div>

            {/* Secondary Overlay Toggle */}
            <div
              role="group"
              aria-label="Chart secondary metric overlay"
              className="inline-flex items-center gap-1 self-start rounded-lg border border-white/10 bg-slate-950/60 p-0.5 text-[11px] font-normal sm:self-auto"
            >
              <button
                type="button"
                onClick={() => setOverlay('none')}
                aria-pressed={overlay === 'none'}
                className={`rounded-md px-2 py-1 font-mono text-[10px] transition-colors ${
                  overlay === 'none'
                    ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Precip only
              </button>
              <button
                type="button"
                onClick={() => setOverlay('gusts')}
                aria-pressed={overlay === 'gusts'}
                className={`flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] transition-colors ${
                  overlay === 'gusts'
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wind className="h-3 w-3" /> + Gusts
              </button>
              <button
                type="button"
                onClick={() => setOverlay('temp')}
                aria-pressed={overlay === 'temp'}
                className={`flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] transition-colors ${
                  overlay === 'temp'
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Thermometer className="h-3 w-3" /> + Temp
              </button>
            </div>
          </CardTitle>

          {/* Live Scrubber Readout / 48h Summary Bar */}
          <div className="instrument-well flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border border-white/10 px-3.5 py-2 font-mono text-xs">
            {activeRow ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 uppercase">
                    {activeRow.dayLabel} {activeRow.hourLabel}
                  </span>
                  <span className="text-slate-200">{codeInfo(activeRow.code).label}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums">
                  <span className="text-sky-300">
                    Prob <strong>{activeRow.probability}%</strong>
                  </span>
                  <span className="text-cyan-300">
                    Rain <strong>{activeRow.precipMm.toFixed(1)} mm</strong>
                  </span>
                  <span className="text-amber-300">
                    Gusts <strong>{Math.round(activeRow.gusts)} km/h</strong>
                  </span>
                  <span className="text-emerald-300">
                    Temp <strong>{activeRow.temp.toFixed(1)}°C</strong>
                  </span>
                </div>
              </>
            ) : (
              <>
                <span className="text-[11px] text-slate-400">
                  Hover or use ←/→ keys to inspect hourly telemetry
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-300 tabular-nums">
                  <span className="flex items-center gap-1">
                    <Droplets className="h-3 w-3 text-sky-400" />
                    Peak <strong className="text-white">{chart.peakProb}%</strong> ·{' '}
                    <strong className="text-cyan-300">{chart.totalMm.toFixed(1)} mm</strong>/48h
                  </span>
                  <span className="text-amber-300/90">
                    Max gust <strong>{Math.round(chart.maxGusts)} km/h</strong>
                  </span>
                  <span className="text-emerald-300/90">
                    Span{' '}
                    <strong>
                      {Math.round(chart.minTemp)}°..{Math.round(chart.maxTemp)}°C
                    </strong>
                  </span>
                </div>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <div className="w-full overflow-x-auto pb-1">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              tabIndex={0}
              aria-labelledby={`${gradientId}-title ${gradientId}-description`}
              onPointerMove={(e) => updatePointerIndex(e.clientX)}
              onPointerLeave={() => setActiveIdx(null)}
              onKeyDown={(e) => {
                if (!chart.rows.length) return
                if (e.key === 'ArrowRight') {
                  e.preventDefault()
                  setActiveIdx((prev) =>
                    prev === null ? 0 : Math.min(chart.rows.length - 1, prev + 1),
                  )
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault()
                  setActiveIdx((prev) =>
                    prev === null ? 0 : Math.max(0, prev - 1),
                  )
                } else if (e.key === 'Escape') {
                  setActiveIdx(null)
                }
              }}
              className="h-72 min-w-[680px] w-full cursor-crosshair select-none rounded-lg focus-visible:ring-1 focus-visible:ring-sky-400/60 focus-visible:outline-none"
            >
              <title id={`${gradientId}-title`}>Hourly precipitation forecast</title>
              <desc id={`${gradientId}-description`}>{summary}</desc>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Storm windows */}
              {chart.stormWindows.map((window) => {
                const left = Math.max(MARGIN.left, chart.x(window.start) - chart.step / 2)
                const right = Math.min(
                  MARGIN.left + PLOT_WIDTH,
                  chart.x(window.end) + chart.step / 2,
                )
                return (
                  <g key={`${window.start}-${window.end}`}>
                    <rect
                      x={left}
                      y={MARGIN.top}
                      width={Math.max(2, right - left)}
                      height={PLOT_HEIGHT}
                      fill="#8b5cf6"
                      fillOpacity="0.16"
                      stroke="#a78bfa"
                      strokeOpacity="0.35"
                    />
                    <text
                      x={left + 4}
                      y={MARGIN.top + 12}
                      fill="#c4b5fd"
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      ⚡ STORM
                    </text>
                  </g>
                )
              })}

              {/* Horizontal probability grid */}
              {[0, 25, 50, 75, 100].map((value) => (
                <g key={value}>
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + PLOT_WIDTH}
                    y1={chart.y(value)}
                    y2={chart.y(value)}
                    stroke="rgba(148,163,184,0.13)"
                  />
                  <text
                    x={MARGIN.left - 8}
                    y={chart.y(value) + 4}
                    textAnchor="end"
                    fill="#94a3b8"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {value}%
                  </text>
                </g>
              ))}

              {/* Midnight day boundary lines */}
              {chart.dayTransitions.map((d) => {
                const xpos = chart.x(d.index)
                return (
                  <g key={`day-${d.index}`}>
                    <line
                      x1={xpos}
                      x2={xpos}
                      y1={MARGIN.top}
                      y2={MARGIN.top + PLOT_HEIGHT}
                      stroke="rgba(148,163,184,0.28)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={xpos + 5}
                      y={MARGIN.top + 11}
                      fill="#cbd5e1"
                      fontSize="9.5"
                      fontWeight="600"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {d.label.toUpperCase()}
                    </text>
                  </g>
                )
              })}

              {/* Alert probability threshold line */}
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + PLOT_WIDTH}
                y1={chart.y(settings.rainThreshold)}
                y2={chart.y(settings.rainThreshold)}
                stroke="#fbbf24"
                strokeDasharray="6 4"
                strokeOpacity="0.85"
              />
              <text
                x={MARGIN.left + PLOT_WIDTH - 4}
                y={chart.y(settings.rainThreshold) - 6}
                textAnchor="end"
                fill="#fbbf24"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                alert ≥ {settings.rainThreshold}%
              </text>

              {/* Precipitation probability area */}
              {chart.area && <path d={chart.area} fill={`url(#${gradientId})`} />}

              {/* Hourly precipitation mm bars */}
              {chart.rows.map((row, index) => {
                const barHeight = (row.precipMm / chart.maxMm) * 58
                const isActive = activeIdx === index
                return (
                  <rect
                    key={row.time.toISOString()}
                    x={chart.x(index) - Math.max(2, chart.step * 0.22)}
                    y={MARGIN.top + PLOT_HEIGHT - barHeight}
                    width={Math.max(3, chart.step * 0.44)}
                    height={barHeight}
                    rx="1.5"
                    fill={isActive ? 'rgba(34,211,238,0.95)' : 'rgba(34,211,238,0.55)'}
                  >
                    <title>
                      {row.dayLabel} {row.hourLabel}: {row.probability}% probability,{' '}
                      {row.precipMm.toFixed(1)} mm, gusts {Math.round(row.gusts)} km/h
                    </title>
                  </rect>
                )
              })}

              {/* Secondary overlay: Wind Gusts or Temperature */}
              {overlay === 'gusts' && chart.gustLine && (
                <path
                  d={chart.gustLine}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.75"
                  strokeDasharray="4 2"
                  strokeOpacity="0.85"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {overlay === 'temp' && chart.tempLine && (
                <path
                  d={chart.tempLine}
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="1.85"
                  strokeOpacity="0.85"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}

              {/* Primary precipitation probability line */}
              {chart.line && (
                <path
                  d={chart.line}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}

              {/* Interactive scrubber crosshair & active points */}
              {activeIdx !== null && activeRow && (
                <g>
                  <line
                    x1={chart.x(activeIdx)}
                    x2={chart.x(activeIdx)}
                    y1={MARGIN.top}
                    y2={MARGIN.top + PLOT_HEIGHT}
                    stroke="rgba(226,232,240,0.65)"
                    strokeWidth="1"
                  />
                  <circle
                    cx={chart.x(activeIdx)}
                    cy={chart.y(activeRow.probability)}
                    r="4.5"
                    fill="#38bdf8"
                    stroke="#020617"
                    strokeWidth="2"
                  />
                  {overlay === 'gusts' && (
                    <circle
                      cx={chart.x(activeIdx)}
                      cy={chart.yGust(activeRow.gusts)}
                      r="3.5"
                      fill="#f59e0b"
                      stroke="#020617"
                      strokeWidth="1.5"
                    />
                  )}
                  {overlay === 'temp' && (
                    <circle
                      cx={chart.x(activeIdx)}
                      cy={chart.yTemp(activeRow.temp)}
                      r="3.5"
                      fill="#34d399"
                      stroke="#020617"
                      strokeWidth="1.5"
                    />
                  )}
                </g>
              )}

              {/* X-axis hour & day ticks */}
              {chart.rows.map((row, index) =>
                index % 6 === 0 ? (
                  <text
                    key={row.time.toISOString()}
                    x={chart.x(index)}
                    y={HEIGHT - 24}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10.5"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    <tspan x={chart.x(index)}>{row.hourLabel}</tspan>
                    <tspan x={chart.x(index)} dy="14" fill="#64748b">
                      {row.dayLabel}
                    </tspan>
                  </text>
                ) : null,
              )}
            </svg>
          </div>

          {/* Legend footer */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2.5 font-mono text-[11px] text-slate-400">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-sky-400" /> Probability %
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-cyan-400/75" /> Amount (mm/h)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-violet-500/75" /> Storm window
              </span>
              {overlay === 'gusts' && (
                <span className="flex items-center gap-1.5 text-amber-300">
                  <span className="h-0.5 w-3 bg-amber-400" /> Wind gusts (km/h)
                </span>
              )}
              {overlay === 'temp' && (
                <span className="flex items-center gap-1.5 text-emerald-300">
                  <span className="h-0.5 w-3 bg-emerald-400" /> Temperature (°C)
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-500">48h horizon · {timeZone}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
