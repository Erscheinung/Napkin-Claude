// The reference mock data (docs/reference.png), used by `NAPKIN_FIXTURE=reference` for the
// fidelity gate and README screenshots. Never touches real sessions.
import type { AppInfo, Napkin, Project, Usage } from "./api";
import type { Live } from "./state.svelte";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function referenceFixture(now: number) {
  // pin the clock to an evening so the greeting matches
  const evening = new Date(now);
  evening.setHours(19, 12, 0, 0);
  const t = evening.getTime();

  const napkin = (id: string, title: string, project: string, ago: number): Napkin => ({
    id,
    title,
    project,
    session_id: id,
    created_at: t - ago - HOUR,
    updated_at: t - ago,
    boundary: null,
    tracking: true,
    tracking_note: null,
    archived: false,
    running: false,
  });
  const napkins = [
    napkin("fx-weather", "weather cli", "/Users/you/code/weather-cli", 6 * MIN),
    napkin("fx-lemonade", "lemonade stand site", "/Users/you/code/lemonade-stand", 40 * MIN),
  ];
  const live: Record<string, Live> = {
    "fx-weather": { status: "needs_you", turns: [], marks: [], touched: [], rev: 0 },
    "fx-lemonade": { status: "done", turns: [], marks: [], touched: [], rev: 0 },
  };
  const project = (name: string, path: string, sessions: number, ago: number, exists = true): Project => ({
    name,
    path,
    sessions,
    last_active: t - ago,
    last_session: null,
    last_prompt: null,
    exists,
  });
  const projects = [
    project("weather-cli", "/Users/you/code/weather-cli", 2, 6 * MIN),
    project("lemonade-stand", "/Users/you/code/lemonade-stand", 4, 40 * MIN),
    project("penpal", "/Users/you/code/penpal", 31, 3 * HOUR),
    project("recipes", "/Users/you/Documents/recipes", 12, 2 * DAY),
    project("blog-2019", "/Users/you/code/blog-2019", 3, 64 * DAY, false),
  ];
  const info: AppInfo = {
    version: "0.1.0",
    fixture: "reference",
    home: "/Users/you",
    data_dir: "",
    claude: "/opt/homebrew/bin/claude",
    claude_version: "2.1.278",
    git: true,
    shell: "/bin/zsh",
  };
  const fiveReset = new Date(evening);
  fiveReset.setHours(21, 43, 0, 0);
  const weekReset = new Date(evening.getTime() + 3 * DAY);
  weekReset.setHours(23, 38, 0, 0);
  const usage: Usage = {
    t,
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: fiveReset.getTime() / 1000 },
      seven_day: { used_percentage: 98, resets_at: weekReset.getTime() / 1000 },
    },
  };
  return { now: t, napkins, live, projects, info, usage };
}
