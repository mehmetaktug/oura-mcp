// MCP tool definitions and JSON-RPC handling. `api.get(path, params)` is injected so this file
// has no Cloudflare dependency and can be tested with a fake API.
import { hrvTrend, readinessDrivers, shiftDay, sleepSummary, weeklyComparison } from "./analysis.js";

const DAILY = [
  "daily_sleep", "daily_readiness", "daily_activity", "daily_stress", "daily_resilience",
  "daily_spo2", "daily_cardiovascular_age", "sleep", "sleep_time", "workout", "session",
  "tag", "enhanced_tag", "rest_mode_period", "vO2_max",
];
export const COLLECTIONS = [...DAILY, "heartrate", "ring_battery_level", "ring_configuration", "personal_info"];

const READ_ONLY = { readOnlyHint: true, openWorldHint: true };
const daysProp = (def, max = 90) => ({ type: "integer", minimum: 1, maximum: max, description: `How many days back (default ${def})` });

export const TOOLS = [
  {
    name: "oura_data",
    description:
      "Fetch raw data from the Oura Ring API v2.\n" +
      "Pick a `collection`.\n" +
      "- Daily collections use `start_date`/`end_date` (YYYY-MM-DD). If both are omitted the last 7 days are returned.\n" +
      "- heartrate and ring_battery_level use `start_datetime`/`end_datetime` (ISO-8601). If omitted the last 24 hours are returned.\n" +
      "- personal_info and ring_configuration take no dates.\n" +
      "- `document_id` fetches a single record. Use `next_token` from a previous reply to page through large results.",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string", enum: COLLECTIONS },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        start_datetime: { type: "string", description: "ISO-8601" },
        end_datetime: { type: "string", description: "ISO-8601" },
        document_id: { type: "string" },
        next_token: { type: "string" },
      },
      required: ["collection"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Oura Ring data" },
  },
  {
    name: "sleep_summary",
    description: "Night by night sleep report: score, hours asleep, efficiency, HRV, lowest heart rate, plus averages, best and worst night and sleep debt against a target.",
    inputSchema: {
      type: "object",
      properties: { days: daysProp(7), target_hours: { type: "number", minimum: 4, maximum: 12, description: "Nightly sleep target in hours (default 7.5)" } },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Sleep summary" },
  },
  {
    name: "weekly_comparison",
    description: "Compare the last 7 days with the 7 days before: sleep score, readiness score, activity score and steps, with change and percent change.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, title: "This week vs last week" },
  },
  {
    name: "hrv_trend",
    description: "Heart rate variability trend from nightly sleep: daily values, rolling average, min, max and whether HRV is trending up, down or flat.",
    inputSchema: { type: "object", properties: { days: daysProp(30) }, additionalProperties: false },
    annotations: { ...READ_ONLY, title: "HRV trend" },
  },
  {
    name: "readiness_drivers",
    description: "What is helping or dragging the latest readiness score: the three weakest and three strongest contributors.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, title: "Readiness drivers" },
  },
];

const today = () => new Date().toISOString().slice(0, 10);
const clampDays = (v, def) => Math.min(90, Math.max(1, Math.trunc(Number(v) || def)));

async function rows(api, collection, startDay, endDay) {
  const out = [];
  let next;
  for (let page = 0; page < 5; page++) {
    const params = { start_date: startDay, end_date: shiftDay(endDay, 1), ...(next ? { next_token: next } : {}) };
    const res = await api.get(`/v2/usercollection/${collection}`, params);
    out.push(...(res.data ?? []));
    next = res.next_token;
    if (!next) break;
  }
  return out;
}

export async function callTool(name, args, api) {
  const end = today();
  switch (name) {
    case "oura_data":
      return api.raw(args);
    case "sleep_summary": {
      const days = clampDays(args.days, 7);
      const start = shiftDay(end, -(days - 1));
      const [daily, sessions] = await Promise.all([rows(api, "daily_sleep", start, end), rows(api, "sleep", shiftDay(start, -1), end)]);
      return sleepSummary({ daily, sessions: sessions.filter((s) => s.day >= start), targetHours: args.target_hours ?? 7.5 });
    }
    case "weekly_comparison": {
      const start = shiftDay(end, -13);
      const [sleep, readiness, activity] = await Promise.all(["daily_sleep", "daily_readiness", "daily_activity"].map((c) => rows(api, c, start, end)));
      return weeklyComparison({ sleep, readiness, activity, endDay: end });
    }
    case "hrv_trend": {
      const days = clampDays(args.days, 30);
      const start = shiftDay(end, -(days - 1));
      return hrvTrend({ sessions: await rows(api, "sleep", start, end) });
    }
    case "readiness_drivers":
      return readinessDrivers({ readiness: await rows(api, "daily_readiness", shiftDay(end, -6), end) });
    default:
      return undefined;
  }
}

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
export { err as rpcError };

export async function handleRpc(msg, api) {
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "oura-mcp-worker", version: "1.1.0" },
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params?.name)) return err(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await callTool(params.name, params.arguments ?? {}, api);
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        return ok(id, { content: [{ type: "text", text }] });
      } catch (e) {
        return ok(id, { isError: true, content: [{ type: "text", text: String(e.message ?? e) }] });
      }
    }
    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}
