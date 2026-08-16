import type { AlertLevel } from '@/types/weather'

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(
  ac: AudioContext,
  freqFrom: number,
  freqTo: number,
  start: number,
  dur: number,
  type: OscillatorType,
  gainPeak: number,
) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freqFrom, start)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), start + dur)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.03)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain).connect(ac.destination)
  osc.start(start)
  osc.stop(start + dur + 0.05)
}

/** Synthesized alert sounds — no audio assets required. */
export function playAlertSound(level: AlertLevel) {
  const ac = getCtx()
  if (!ac) return
  const t0 = ac.currentTime + 0.02

  if (level === 'storm') {
    // urgent two-tone siren x3
    for (let i = 0; i < 3; i++) {
      const s = t0 + i * 0.85
      tone(ac, 660, 880, s, 0.4, 'square', 0.12)
      tone(ac, 880, 660, s + 0.4, 0.4, 'square', 0.12)
    }
  } else if (level === 'heavy') {
    // triple warning beep
    for (let i = 0; i < 3; i++) {
      tone(ac, 740, 740, t0 + i * 0.35, 0.22, 'triangle', 0.16)
    }
  } else {
    // gentle rain chime
    tone(ac, 523.25, 523.25, t0, 0.3, 'sine', 0.18)
    tone(ac, 659.25, 659.25, t0 + 0.22, 0.3, 'sine', 0.16)
    tone(ac, 783.99, 783.99, t0 + 0.44, 0.5, 'sine', 0.14)
  }
}

/** Short tick used for UI feedback / test button. */
export function playTestSound() {
  const ac = getCtx()
  if (!ac) return
  const t0 = ac.currentTime + 0.02
  tone(ac, 523.25, 523.25, t0, 0.25, 'sine', 0.18)
  tone(ac, 783.99, 783.99, t0 + 0.2, 0.4, 'sine', 0.16)
}
