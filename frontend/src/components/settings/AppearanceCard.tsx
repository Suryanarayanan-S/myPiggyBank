import { Card } from '../ui/Card';
import { useTheme, type ModePref } from '../../lib/theme';

const MODES: { value: ModePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The light/dark choice, remembered on this browser. */
export function AppearanceCard() {
  const { pref, chooseMode } = useTheme();
  return (
    <Card title="Appearance">
      <fieldset className="text-sm">
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
    </Card>
  );
}
