// Pure analysis helpers. No network, no Cloudflare APIs, so they are easy to test.

export const round = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

export function mean(values) {
  const v = values.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function shiftDay(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// One main sleep session per day: the longest "long_sleep" (falls back to the longest of any type).
export function mainSleepByDay(sessions) {
  const best = new Map();
  for (const s of sessions) {
    if (!s.day) continue;
    const rank = (x) => (x.type === "long_sleep" ? 1e9 : 0) + (x.total_sleep_duration ?? 0);
    const cur = best.get(s.day);
    if (!cur || rank(s) > rank(cur)) best.set(s.day, s);
  }
  return best;
}

export function sleepSummary({ daily, sessions, targetHours = 7.5 }) {
  const byDay = mainSleepByDay(sessions);
  const days = new Set([...daily.map((d) => d.day), ...byDay.keys()]);
  const scoreOf = new Map(daily.map((d) => [d.day, d.score]));
  const nights = [...days].sort().map((day) => {
    const s = byDay.get(day);
    return {
      day,
      score: scoreOf.get(day) ?? null,
      sleep_hours: s?.total_sleep_duration != null ? round(s.total_sleep_duration / 3600, 2) : null,
      efficiency: s?.efficiency ?? null,
      avg_hrv: s?.average_hrv ?? null,
      lowest_hr: s?.lowest_heart_rate ?? null,
    };
  });
  const withHours = nights.filter((n) => n.sleep_hours !== null);
  const scored = nights.filter((n) => n.score !== null);
  const debt = withHours.reduce((a, n) => a + Math.max(0, targetHours - n.sleep_hours), 0);
  const best = scored.reduce((a, n) => (a === null || n.score > a.score ? n : a), null);
  const worst = scored.reduce((a, n) => (a === null || n.score < a.score ? n : a), null);
  return {
    nights,
    averages: {
      score: round(mean(nights.map((n) => n.score))),
      sleep_hours: round(mean(nights.map((n) => n.sleep_hours)), 2),
      efficiency: round(mean(nights.map((n) => n.efficiency))),
      avg_hrv: round(mean(nights.map((n) => n.avg_hrv))),
      lowest_hr: round(mean(nights.map((n) => n.lowest_hr))),
    },
    best_night: best && { day: best.day, score: best.score },
    worst_night: worst && { day: worst.day, score: worst.score },
    target_hours: targetHours,
    sleep_debt_hours: round(debt, 2),
    nights_under_target: withHours.filter((n) => n.sleep_hours < targetHours).length,
  };
}

function change(current, previous) {
  if (current === null || previous === null) return { current: round(current), previous: round(previous), delta: null, delta_pct: null };
  return {
    current: round(current),
    previous: round(previous),
    delta: round(current - previous),
    delta_pct: previous === 0 ? null : round(((current - previous) / previous) * 100),
  };
}

// Last 7 days (ending at `endDay`, inclusive) versus the 7 days before that.
export function weeklyComparison({ sleep, readiness, activity, endDay }) {
  const curStart = shiftDay(endDay, -6);
  const prevStart = shiftDay(endDay, -13);
  const prevEnd = shiftDay(endDay, -7);
  const inCur = (r) => r.day >= curStart && r.day <= endDay;
  const inPrev = (r) => r.day >= prevStart && r.day <= prevEnd;
  const metric = (rows, key) => change(mean(rows.filter(inCur).map((r) => r[key])), mean(rows.filter(inPrev).map((r) => r[key])));
  return {
    current_period: { from: curStart, to: endDay },
    previous_period: { from: prevStart, to: prevEnd },
    sleep_score: metric(sleep, "score"),
    readiness_score: metric(readiness, "score"),
    activity_score: metric(activity, "score"),
    steps: metric(activity, "steps"),
  };
}

export function hrvTrend({ sessions, window = 7 }) {
  const series = [...mainSleepByDay(sessions).values()]
    .filter((s) => typeof s.average_hrv === "number")
    .map((s) => ({ day: s.day, hrv: s.average_hrv }))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((p, i, arr) => ({ ...p, rolling_avg: round(mean(arr.slice(Math.max(0, i - window + 1), i + 1).map((x) => x.hrv))) }));
  if (series.length === 0) return { series, direction: "no_data" };
  const half = Math.floor(series.length / 2);
  const first = mean(series.slice(0, half || 1).map((p) => p.hrv));
  const second = mean(series.slice(half || 0).map((p) => p.hrv));
  const pct = first ? ((second - first) / first) * 100 : 0;
  return {
    series,
    average: round(mean(series.map((p) => p.hrv))),
    latest: series[series.length - 1].hrv,
    min: Math.min(...series.map((p) => p.hrv)),
    max: Math.max(...series.map((p) => p.hrv)),
    first_half_avg: round(first),
    second_half_avg: round(second),
    change_pct: round(pct),
    direction: series.length < 4 ? "not_enough_data" : pct > 5 ? "up" : pct < -5 ? "down" : "flat",
  };
}

export function readinessDrivers({ readiness }) {
  const latest = [...readiness].sort((a, b) => (a.day < b.day ? -1 : 1)).pop();
  if (!latest) return { day: null, note: "No readiness data in range" };
  const entries = Object.entries(latest.contributors ?? {}).filter(([, v]) => typeof v === "number").sort((a, b) => a[1] - b[1]);
  return {
    day: latest.day,
    score: latest.score,
    temperature_deviation: latest.temperature_deviation ?? null,
    weakest: entries.slice(0, 3).map(([name, value]) => ({ name, value })),
    strongest: entries.slice(-3).reverse().map(([name, value]) => ({ name, value })),
  };
}
