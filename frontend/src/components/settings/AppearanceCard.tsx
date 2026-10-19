import { Card } from '../ui/Card';
import { useTheme, type Look, type ModePref } from '../../lib/theme';

const LOOKS: { value: Look; label: string; hint: string }[] = [
  { value: 'modern', label: 'Modern', hint: 'clean and calm' },
  { value: 'retro', label: 'Retro', hint: '8-bit arcade' },
];
const MODES: { value: ModePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The look and light/dark choice, remembered on this browser. */
export function AppearanceCard() {
  const { look, pref, chooseLook, chooseMode } = useTheme();
  return (
    <Card title="Appearance">
      <div className="space-y-4 text-sm">
        <fieldset>
          <legend className="mb-2 font-medium">Look</legend>
          <div className="flex flex-wrap gap-4">
            {LOOKS.map((l) => (
              <label key={l.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="look"
                  checked={look === l.value}
                  onChange={() => chooseLook(l.value)}
                />
                {l.label} <span className="text-xs text-slate-500">({l.hint})</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 font-medium">Light or dark</legend>
          <div className="flex flex-wrap gap-4">
            {MODES.map((m) => (
              <label key={m.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={pref === m.value}
                  onChange={() => chooseMode(m.value)}
                />
                {m.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            System follows your computer’s setting. Remembered on this browser.
          </p>
        </fieldset>
      </div>
    </Card>
  );
}
