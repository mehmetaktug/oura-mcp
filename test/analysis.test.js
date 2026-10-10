import { test } from "node:test";
import assert from "node:assert/strict";
import { hrvTrend, mainSleepByDay, mean, readinessDrivers, shiftDay, sleepSummary, weeklyComparison } from "../src/analysis.js";

const night = (day, hours, hrv, extra = {}) => ({ day, type: "long_sleep", total_sleep_duration: hours * 3600, average_hrv: hrv, efficiency: 90, lowest_heart_rate: 55, ...extra });

test("mean ignores nulls and returns null when empty", () => {
  assert.equal(mean([1, 2, null, 3]), 2);
  assert.equal(mean([]), null);
  assert.equal(mean([null, undefined]), null);
});

test("shiftDay crosses month and year boundaries", () => {
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
});

test("mainSleepByDay prefers the longest long_sleep over naps", () => {
  const m = mainSleepByDay([
    { day: "2026-10-01", type: "rest", total_sleep_duration: 5000 },
    night("2026-10-01", 7, 40),
    night("2026-10-01", 3, 30),
  ]);
  assert.equal(m.get("2026-10-01").total_sleep_duration, 7 * 3600);
});

test("sleepSummary computes averages, extremes and sleep debt", () => {
  const out = sleepSummary({
    daily: [{ day: "2026-10-01", score: 80 }, { day: "2026-10-02", score: 60 }],
    sessions: [night("2026-10-01", 8, 40), night("2026-10-02", 6, 30)],
    targetHours: 7.5,
  });
  assert.equal(out.averages.score, 70);
  assert.equal(out.averages.sleep_hours, 7);
  assert.deepEqual(out.best_night, { day: "2026-10-01", score: 80 });
  assert.deepEqual(out.worst_night, { day: "2026-10-02", score: 60 });
  assert.equal(out.sleep_debt_hours, 1.5);
  assert.equal(out.nights_under_target, 1);
});

test("sleepSummary tolerates missing data", () => {
  const out = sleepSummary({ daily: [], sessions: [] });
  assert.equal(out.nights.length, 0);
  assert.equal(out.averages.score, null);
  assert.equal(out.best_night, null);
});

test("weeklyComparison splits current and previous week", () => {
  const days = (from, n, score) => Array.from({ length: n }, (_, i) => ({ day: shiftDay(from, i), score, steps: score * 100 }));
  const prev = days("2026-10-01", 7, 60); // 10-01 .. 10-07
  const cur = days("2026-10-08", 7, 75); // 10-08 .. 10-14
  const out = weeklyComparison({ sleep: [...prev, ...cur], readiness: [...prev, ...cur], activity: [...prev, ...cur], endDay: "2026-10-14" });
  assert.equal(out.current_period.from, "2026-10-08");
  assert.equal(out.previous_period.to, "2026-10-07");
  assert.deepEqual(out.sleep_score, { current: 75, previous: 60, delta: 15, delta_pct: 25 });
  assert.equal(out.steps.delta, 1500);
});

test("weeklyComparison handles an empty previous week", () => {
  const out = weeklyComparison({ sleep: [{ day: "2026-10-14", score: 70 }], readiness: [], activity: [], endDay: "2026-10-14" });
  assert.equal(out.sleep_score.delta, null);
  assert.equal(out.readiness_score.current, null);
});

test("hrvTrend detects a rising trend and builds a rolling average", () => {
  const sessions = [30, 31, 32, 40, 42, 44].map((v, i) => night(shiftDay("2026-10-01", i), 7, v));
  const out = hrvTrend({ sessions, window: 3 });
  assert.equal(out.direction, "up");
  assert.equal(out.latest, 44);
  assert.equal(out.min, 30);
  assert.equal(out.series[2].rolling_avg, 31);
});

test("hrvTrend reports flat, down, and not enough data", () => {
  const mk = (vals) => vals.map((v, i) => night(shiftDay("2026-10-01", i), 7, v));
  assert.equal(hrvTrend({ sessions: mk([40, 40, 41, 40, 40, 41]) }).direction, "flat");
  assert.equal(hrvTrend({ sessions: mk([50, 48, 46, 40, 38, 36]) }).direction, "down");
  assert.equal(hrvTrend({ sessions: mk([40, 41]) }).direction, "not_enough_data");
  assert.equal(hrvTrend({ sessions: [] }).direction, "no_data");
});

test("readinessDrivers ranks weakest and strongest contributors from the latest day", () => {
  const out = readinessDrivers({
    readiness: [
      { day: "2026-10-09", score: 70, contributors: { sleep_balance: 10 } },
      { day: "2026-10-10", score: 82, temperature_deviation: -0.2, contributors: { sleep_balance: 68, hrv_balance: 77, resting_heart_rate: 98, body_temperature: 98, previous_night: 78, recovery_index: null } },
    ],
  });
  assert.equal(out.day, "2026-10-10");
  assert.equal(out.weakest[0].name, "sleep_balance");
  assert.equal(out.strongest.length, 3);
  assert.ok(out.strongest[0].value >= out.strongest[2].value);
});

test("readinessDrivers with no data", () => {
  assert.equal(readinessDrivers({ readiness: [] }).day, null);
});
