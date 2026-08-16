import { useId, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AlertSettings, HourPoint } from '@/types/weather'
import { formatDay, formatHour, isStormCode } from '@/lib/weather'

interface Props {
  hours: HourPoint[]
  settings: AlertSettings
  timeZone: string
}

const WIDTH = 960
const HEIGHT = 270
const MARGIN = { top: 18, right: 16, bottom: 46, left: 48 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

export default function PrecipChart({ hours, settings, timeZone }: Props) {
  const gradientId = useId().replaceAll(':', '')
  const chart = useMemo(() => {
    const rows = hours.map((hour) => ({
      ...hour,
      probability: Math.round(hour.precipProb),
      storm: isStormCode(hour.code),
    }))
    const step = rows.length > 1 ? PLOT_WIDTH / (rows.length - 1) : PLOT_WIDTH
    const x = (index: number) => MARGIN.left + index * step
    const y = (probability: number) =>
      MARGIN.top + PLOT_HEIGHT - (Math.max(0, Math.min(100, probability)) / 100) * PLOT_HEIGHT
    const line = rows.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(row.probability)}`).join(' ')
    const area = rows.length
      ? `${line} L ${x(rows.length - 1)} ${MARGIN.top + PLOT_HEIGHT} L ${x(0)} ${MARGIN.top + PLOT_HEIGHT} Z`
      : ''
    const maxMm = Math.max(1, ...rows.map((row) => row.precipMm))

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

    return { rows, step, x, y, line, area, maxMm, stormWindows }
  }, [hours])

  const summary = chart.rows.length
    ? `Hourly rain probability for the next ${chart.rows.length} hours. Peak probability ${Math.max(...chart.rows.map((row) => row.probability))} percent.`
    : 'No hourly forecast data available.'

  return (
    <div className="app-enter h-full [animation-delay:75ms]">
      <Card className="h-full border-white/10 bg-white/[0.04] text-white backdrop-blur-xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-col gap-2 text-base font-semibold sm:flex-row sm:items-center sm:justify-between">
            <span>Precipitation outlook — next 48 h</span>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-normal text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-sky-400" /> probability %
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-cyan-500/70" /> amount (mm)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-violet-500/70" /> storm
              </span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto pb-1">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-labelledby={`${gradientId}-title ${gradientId}-description`}
              className="h-72 min-w-[680px] w-full"
            >
              <title id={`${gradientId}-title`}>Hourly precipitation forecast</title>
              <desc id={`${gradientId}-description`}>{summary}</desc>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {chart.stormWindows.map((window) => {
                const left = Math.max(MARGIN.left, chart.x(window.start) - chart.step / 2)
                const right = Math.min(
                  MARGIN.left + PLOT_WIDTH,
                  chart.x(window.end) + chart.step / 2,
                )
                return (
                  <rect
                    key={`${window.start}-${window.end}`}
                    x={left}
                    y={MARGIN.top}
                    width={Math.max(2, right - left)}
                    height={PLOT_HEIGHT}
                    fill="#8b5cf6"
                    fillOpacity="0.14"
                    stroke="#a78bfa"
                    strokeOpacity="0.35"
                  />
                )
              })}

              {[0, 25, 50, 75, 100].map((value) => (
                <g key={value}>
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + PLOT_WIDTH}
                    y1={chart.y(value)}
                    y2={chart.y(value)}
                    stroke="rgba(148,163,184,0.14)"
                  />
                  <text
                    x={MARGIN.left - 8}
                    y={chart.y(value) + 4}
                    textAnchor="end"
                    fill="#94a3b8"
                    fontSize="11"
                  >
                    {value}%
                  </text>
                </g>
              ))}

              <line
                x1={MARGIN.left}
                x2={MARGIN.left + PLOT_WIDTH}
                y1={chart.y(settings.rainThreshold)}
                y2={chart.y(settings.rainThreshold)}
                stroke="#fbbf24"
                strokeDasharray="6 4"
                strokeOpacity="0.8"
              />
              <text
                x={MARGIN.left + PLOT_WIDTH - 4}
                y={chart.y(settings.rainThreshold) - 6}
                textAnchor="end"
                fill="#fbbf24"
                fontSize="10"
              >
                alert ≥ {settings.rainThreshold}%
              </text>

              {chart.area && <path d={chart.area} fill={`url(#${gradientId})`} />}
              {chart.rows.map((row, index) => {
                const barHeight = (row.precipMm / chart.maxMm) * 54
                return (
                  <rect
                    key={row.time.toISOString()}
                    x={chart.x(index) - Math.max(2, chart.step * 0.2)}
                    y={MARGIN.top + PLOT_HEIGHT - barHeight}
                    width={Math.max(3, chart.step * 0.4)}
                    height={barHeight}
                    rx="2"
                    fill="rgba(34,211,238,0.55)"
                  >
                    <title>
                      {formatDay(row.time, timeZone)} {formatHour(row.time, timeZone)}: {row.probability}% probability, {row.precipMm.toFixed(1)} mm
                    </title>
                  </rect>
                )
              })}
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

              {chart.rows.map((row, index) =>
                index % 6 === 0 ? (
                  <text
                    key={row.time.toISOString()}
                    x={chart.x(index)}
                    y={HEIGHT - 24}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="11"
                  >
                    <tspan x={chart.x(index)}>{formatHour(row.time, timeZone)}</tspan>
                    <tspan x={chart.x(index)} dy="14" fill="#64748b">
                      {formatDay(row.time, timeZone)}
                    </tspan>
                  </text>
                ) : null,
              )}
            </svg>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
