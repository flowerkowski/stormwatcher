import { Bell, BellRing, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { AlertSettings } from '@/types/weather'
import { playTestSound } from '@/lib/sound'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  settings: AlertSettings
  onChange: (s: AlertSettings) => void
}

const REFRESH_OPTIONS = [5, 10, 15, 30, 60]

export default function SettingsPanel({ open, onOpenChange, settings, onChange }: Props) {
  const set = <K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) =>
    onChange({ ...settings, [key]: value })

  const requestNotify = async (enable: boolean) => {
    if (enable && 'Notification' in window && Notification.permission === 'default') {
      const perm = await Notification.requestPermission()
      set('notifyEnabled', perm === 'granted')
    } else {
      set('notifyEnabled', enable)
    }
  }

  const notifUnsupported = !('Notification' in window)
  const notifDenied =
    'Notification' in window && Notification.permission === 'denied'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full border-white/10 bg-slate-950/95 text-white backdrop-blur-2xl sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-white">Alert settings</SheetTitle>
          <SheetDescription className="text-slate-400">
            Tune when and how StormWatch warns you.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-8 space-y-7 px-4 pb-6">
          {/* thresholds */}
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-slate-200" htmlFor="rain-threshold">
                  Rain alert threshold
                </Label>
                <span className="text-sm font-semibold text-sky-300 tabular-nums">
                  ≥ {settings.rainThreshold}%
                </span>
              </div>
              <Slider
                id="rain-threshold"
                aria-label="Rain alert probability threshold"
                value={[settings.rainThreshold]}
                onValueChange={([v]) => set('rainThreshold', v)}
                min={20}
                max={90}
                step={5}
                className="mt-3"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Alert when hourly rain probability reaches this level.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-slate-200" htmlFor="heavy-rain-threshold">
                  Heavy rain amount
                </Label>
                <span className="text-sm font-semibold text-amber-300 tabular-nums">
                  ≥ {settings.heavyMmPerHour} mm/h
                </span>
              </div>
              <Slider
                id="heavy-rain-threshold"
                aria-label="Heavy rain threshold in millimetres per hour"
                value={[settings.heavyMmPerHour]}
                onValueChange={([v]) => set('heavyMmPerHour', v)}
                min={1}
                max={15}
                step={1}
                className="mt-3"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Precipitation rate that escalates an alert to "heavy rain".
              </p>
            </div>
          </div>

          <Separator className="bg-white/10" />

          {/* alert types */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-200" htmlFor="storm-alerts">
                  Storm forecast alerts
                </Label>
                <p className="text-xs text-slate-500">Forecast thunderstorms &amp; hail</p>
              </div>
              <Switch
                id="storm-alerts"
                checked={settings.stormAlerts}
                onCheckedChange={(v) => set('stormAlerts', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-200" htmlFor="rain-alerts">
                  Rain alerts
                </Label>
                <p className="text-xs text-slate-500">Rain and heavy-rain events</p>
              </div>
              <Switch
                id="rain-alerts"
                checked={settings.rainAlerts}
                onCheckedChange={(v) => set('rainAlerts', v)}
              />
            </div>
          </div>

          <Separator className="bg-white/10" />

          {/* delivery */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label
                  className="flex items-center gap-1.5 text-slate-200"
                  htmlFor="browser-notifications"
                >
                  {settings.notifyEnabled ? (
                    <BellRing className="h-3.5 w-3.5 text-sky-300" />
                  ) : (
                    <Bell className="h-3.5 w-3.5 text-slate-500" />
                  )}
                  Browser notifications
                </Label>
                <p className="text-xs text-slate-500">
                  {notifUnsupported
                    ? 'Not supported in this browser'
                    : notifDenied
                      ? 'Blocked — enable notifications for this site in your browser settings'
                      : 'System notifications when new alerts appear'}
                </p>
              </div>
              <Switch
                id="browser-notifications"
                checked={settings.notifyEnabled}
                disabled={notifUnsupported || notifDenied}
                onCheckedChange={requestNotify}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="flex items-center gap-1.5 text-slate-200" htmlFor="alert-sounds">
                  <Volume2 className="h-3.5 w-3.5 text-slate-400" />
                  Alert sounds
                </Label>
                <p className="text-xs text-slate-500">Siren for storms, chime for rain</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={playTestSound}
                  className="h-7 border-white/15 bg-white/5 px-2.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  Test
                </Button>
                <Switch
                  id="alert-sounds"
                  checked={settings.soundEnabled}
                  onCheckedChange={(v) => set('soundEnabled', v)}
                />
              </div>
            </div>
          </div>

          <Separator className="bg-white/10" />

          {/* refresh */}
          <div>
            <Label className="text-slate-200">Check for updates every</Label>
            <div className="mt-3 flex gap-2">
              {REFRESH_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={settings.refreshMinutes === m}
                  onClick={() => set('refreshMinutes', m)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                    settings.refreshMinutes === m
                      ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
                      : 'border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {m < 60 ? `${m}m` : '1h'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Keep this tab open — monitoring and alerts run while the page is open.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
