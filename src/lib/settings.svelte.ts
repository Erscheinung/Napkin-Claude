// Per-machine preferences. Conveniences only, so localStorage is fine; failures are ignored.

type Settings = { fontSize: number; doodleBack: boolean };
const KEY = "napkin.settings.v1";
const DEFAULTS: Settings = { fontSize: 13.5, doodleBack: true };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = $state<Settings>(load());

$effect.root(() => {
  $effect(() => {
    const snapshot = JSON.stringify(settings);
    try {
      localStorage.setItem(KEY, snapshot);
    } catch {
      /* private mode etc. */
    }
  });
});
