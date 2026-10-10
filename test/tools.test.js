import { test } from "node:test";
import assert from "node:assert/strict";
import { COLLECTIONS, TOOLS, callTool, handleRpc } from "../src/tools.js";
import { shiftDay } from "../src/analysis.js";

const today = new Date().toISOString().slice(0, 10);

function fakeApi(data = {}) {
  const calls = [];
  return {
    calls,
    get: async (path, params) => {
      calls.push({ path, params });
      const key = path.split("/").pop();
      return { data: data[key] ?? [] };
    },
    raw: async (args) => JSON.stringify({ raw: args.collection }),
  };
}

test("initialize echoes the protocol version", async () => {
  const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, fakeApi());
  assert.equal(r.result.protocolVersion, "2025-03-26");
  assert.ok(r.result.capabilities.tools);
});

test("notifications get no reply", async () => {
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, fakeApi()), null);
});

test("tools/list exposes every tool, all read only, with valid schemas", async () => {
  const r = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, fakeApi());
  const names = r.result.tools.map((t) => t.name);
  assert.deepEqual(names, ["oura_data", "sleep_summary", "weekly_comparison", "hrv_trend", "readiness_drivers"]);
  for (const t of TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} must be read only`);
    assert.equal(t.inputSchema.type, "object");
  }
  assert.equal(COLLECTIONS.length, 19);
});

test("unknown tool and unknown method return JSON-RPC errors", async () => {
  const t = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope" } }, fakeApi());
  assert.equal(t.error.code, -32602);
  const m = await handleRpc({ jsonrpc: "2.0", id: 4, method: "wat" }, fakeApi());
  assert.equal(m.error.code, -32601);
});

test("oura_data passes straight through", async () => {
  const r = await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "oura_data", arguments: { collection: "daily_sleep" } } }, fakeApi());
  assert.equal(JSON.parse(r.result.content[0].text).raw, "daily_sleep");
});

test("sleep_summary asks Oura for the right window and shapes the answer", async () => {
  const api = fakeApi({
    daily_sleep: [{ day: today, score: 80 }],
    sleep: [{ day: today, type: "long_sleep", total_sleep_duration: 8 * 3600, average_hrv: 40, efficiency: 90, lowest_heart_rate: 55 }],
  });
  const r = await handleRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sleep_summary", arguments: { days: 3 } } }, api);
  const out = JSON.parse(r.result.content[0].text);
  assert.equal(out.averages.score, 80);
  assert.equal(out.averages.sleep_hours, 8);
  const daily = api.calls.find((c) => c.path.endsWith("daily_sleep"));
  assert.equal(daily.params.start_date, shiftDay(today, -2));
  assert.equal(daily.params.end_date, shiftDay(today, 1));
});

test("days is clamped to a safe range", async () => {
  const api = fakeApi();
  await callTool("hrv_trend", { days: 100000 }, api);
  assert.equal(api.calls[0].params.start_date, shiftDay(today, -89));
});

test("API errors become tool errors, not crashes", async () => {
  const api = { get: async () => { throw new Error("Oura API 401: nope"); }, raw: async () => "" };
  const r = await handleRpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "weekly_comparison", arguments: {} } }, api);
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /401/);
});

test("pagination follows next_token", async () => {
  let n = 0;
  const api = {
    get: async () => (n++ === 0 ? { data: [{ day: today, score: 70 }], next_token: "abc" } : { data: [{ day: shiftDay(today, -1), score: 90 }] }),
    raw: async () => "",
  };
  const out = await callTool("readiness_drivers", {}, api);
  assert.equal(n, 2);
  assert.equal(out.day, today);
});
