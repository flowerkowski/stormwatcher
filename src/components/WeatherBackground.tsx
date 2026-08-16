import { useEffect, useRef } from 'react'
import type { SkyStatus } from '@/types/weather'

interface Drop {
  x: number
  y: number
  len: number
  speed: number
  drift: number
  alpha: number
}

/**
 * Full-screen animated backdrop: drifting gradient + canvas rain,
 * with occasional lightning flashes while a storm is active.
 */
export default function WeatherBackground({ status }: { status: SkyStatus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let drops: Drop[] = []
    let flash = 0 // 0..1 lightning intensity
    let nextFlashAt = performance.now() + 4000
    let w = 0
    let h = 0
    let running = !document.hidden

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const target = Math.floor((w * h) / 14000)
      drops = Array.from({ length: target }, () => spawn(true))
    }

    const spawn = (anywhere = false): Drop => ({
      x: Math.random() * (w + 100) - 50,
      y: anywhere ? Math.random() * h : -20 - Math.random() * 60,
      len: 10 + Math.random() * 18,
      speed: 9 + Math.random() * 8,
      drift: -1.5 - Math.random() * 1.5,
      alpha: 0.12 + Math.random() * 0.25,
    })

    const tick = (now: number) => {
      ctx.clearRect(0, 0, w, h)

      const intensity = status === 'storm' ? 1 : 0.55
      ctx.lineWidth = 1.1
      const visible = Math.floor(drops.length * intensity)
      for (let i = 0; i < visible; i++) {
        const d = drops[i]
        ctx.strokeStyle = `rgba(147, 197, 253, ${d.alpha})`
        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x + d.drift * 1.6, d.y + d.len)
        ctx.stroke()
        d.y += d.speed
        d.x += d.drift
        if (d.y > h + 30) drops[i] = spawn()
      }

      if (status === 'storm') {
        if (now >= nextFlashAt) {
          flash = 0.9
          nextFlashAt = now + 2500 + Math.random() * 7000
        }
        if (flash > 0.01) {
          ctx.fillStyle = `rgba(196, 181, 253, ${flash * 0.16})`
          ctx.fillRect(0, 0, w, h)
          flash *= 0.86
        }
      }
      if (running) raf = requestAnimationFrame(tick)
    }

    resize()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (status === 'clear' || reducedMotion) return

    const handleVisibility = () => {
      running = !document.hidden
      if (running) {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(tick)
      }
    }
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', handleVisibility)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [status])

  const gradient =
    status === 'storm'
      ? 'from-[#0b0620] via-[#1e1145] to-[#3b0f3f]'
      : status === 'rain'
        ? 'from-[#020617] via-[#0b2137] to-[#0f2f4a]'
        : 'from-[#020617] via-[#0a1a2f] to-[#0b2440]'

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-b ${gradient} transition-colors duration-1000`} />
      {/* soft aurora blobs */}
      <div className="absolute -top-40 left-1/4 h-[34rem] w-[34rem] rounded-full bg-sky-500/10 blur-3xl" />
      <div
        className={`absolute top-1/3 -right-32 h-[30rem] w-[30rem] rounded-full blur-3xl transition-colors duration-1000 ${
          status === 'storm' ? 'bg-violet-600/15' : 'bg-cyan-500/10'
        }`}
      />
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-slate-950/40" />
    </div>
  )
}
