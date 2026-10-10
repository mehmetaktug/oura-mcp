// Oura Ring MCP server as a Cloudflare Worker (streamable HTTP, stateless JSON).
// Public URL: https://<host>/<MCP_SECRET>/mcp   (anything else returns 404)
import { DurableObject } from "cloudflare:workers";
import { COLLECTIONS, handleRpc, rpcError } from "./tools.js";

const API = "https://api.ouraring.com";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";

// ---- Token store: one Durable Object so the single-use refresh token is rotated safely ----
export class TokenStore extends DurableObject {
  async saveState(state) {
    await this.ctx.storage.put(`state:${state}`, Date.now() + 10 * 60 * 1000);
  }

  async consumeState(state) {
    const exp = await this.ctx.storage.get(`state:${state}`);
    await this.ctx.storage.delete(`state:${state}`);
    return typeof exp === "number" && exp > Date.now();
  }

  async saveTokens(t) {
    await this.ctx.storage.put("tokens", t);
  }

  async isConnected() {
    return Boolean(await this.ctx.storage.get("tokens"));
  }

  async accessToken() {
    return this.ctx.blockConcurrencyWhile(async () => {
      let t = await this.ctx.storage.get("tokens");
      if (!t) {
        if (!this.env.OURA_TOKENS_B64) throw new Error("Not connected to Oura yet. Open https://<your-worker-host>/<MCP_SECRET>/login in a browser once.");
        t = JSON.parse(atob(this.env.OURA_TOKENS_B64));
        await this.ctx.storage.put("tokens", t);
      }
      if (t.expiresAt - Date.now() > 5 * 60 * 1000) return t.accessToken;

      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: t.refreshToken,
          client_id: this.env.OURA_CLIENT_ID,
          client_secret: this.env.OURA_CLIENT_SECRET,
        }),
      });
      if (!res.ok) throw new Error(`Oura token refresh failed (${res.status}). Open /<MCP_SECRET>/login again to reconnect.`);
      const j = await res.json();
      t = {
        accessToken: j.access_token,
        refreshToken: j.refresh_token,
        expiresAt: Date.now() + (j.expires_in ?? 86400) * 1000,
      };
      await this.ctx.storage.put("tokens", t);
      return t.accessToken;
    });
  }
}

// ---- Oura API access (injected into the tools) ----
function makeApi(env) {
  const bearer = async () => env.TOKENS.get(env.TOKENS.idFromName("main")).accessToken();
  const getText = async (path, params) => {
    const q = new URLSearchParams(params);
    const res = await fetch(`${API}${path}${q.size ? "?" + q : ""}`, { headers: { authorization: `Bearer ${await bearer()}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Oura API ${res.status}: ${text.slice(0, 500)}`);
    return text;
  };
  return {
    get: async (path, params = {}) => JSON.parse(await getText(path, params)),
    raw: (args) => {
      const c = args.collection;
      if (!COLLECTIONS.includes(c)) throw new Error(`Unknown collection: ${c}`);
      let path = `/v2/usercollection/${c}`;
      const q = {};
      if (args.document_id) path += `/${encodeURIComponent(args.document_id)}`;
      else if (c !== "personal_info" && c !== "ring_configuration") {
        if (c === "heartrate" || c === "ring_battery_level") {
          q.start_datetime = args.start_datetime ?? new Date(Date.now() - 864e5).toISOString();
          q.end_datetime = args.end_datetime ?? new Date().toISOString();
        } else {
          const day = (d) => d.toISOString().slice(0, 10);
          q.start_date = args.start_date ?? day(new Date(Date.now() - 7 * 864e5));
          q.end_date = args.end_date ?? day(new Date(Date.now() + 864e5));
        }
        if (args.next_token) q.next_token = args.next_token;
      }
      return getText(path, q);
    },
  };
}

const SCOPES = "email personal daily heartrate tag workout session spo2 ring_configuration stress heart_health";
const page = (title, body, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${body}</p>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

async function startLogin(req, env) {
  const stub = env.TOKENS.get(env.TOKENS.idFromName("main"));
  const state = crypto.randomUUID();
  await stub.saveState(state);
  const u = new URL("https://cloud.ouraring.com/oauth/authorize");
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: env.OURA_CLIENT_ID,
    redirect_uri: `${new URL(req.url).origin}/callback`,
    scope: SCOPES,
    state,
  });
  return Response.redirect(u.toString(), 302);
}

async function finishLogin(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return page("Oura login failed", "Oura returned an error. Start again from the /login link.", 400);
  const stub = env.TOKENS.get(env.TOKENS.idFromName("main"));
  if (!code || !state || !(await stub.consumeState(state))) {
    return page("Invalid or expired login", "Start again from the /login link.", 400);
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/callback`,
      client_id: env.OURA_CLIENT_ID,
      client_secret: env.OURA_CLIENT_SECRET,
    }),
  });
  if (!res.ok) return page("Token exchange failed", `Oura answered ${res.status}. Check your client id, secret and redirect URI.`, 502);
  const j = await res.json();
  await stub.saveTokens({
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in ?? 86400) * 1000,
  });
  return page("Connected to Oura", "You can close this tab and add the MCP URL to your AI app.");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/callback" && req.method === "GET") return finishLogin(req, env);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && parts[1] === "login" && req.method === "GET" && env.MCP_SECRET && safeEqual(parts[0], env.MCP_SECRET)) {
      return startLogin(req, env);
    }
    if (parts.length !== 2 || parts[1] !== "mcp" || !env.MCP_SECRET || !safeEqual(parts[0], env.MCP_SECRET)) {
      return new Response("Not found", { status: 404 });
    }
    if (req.method === "GET" || req.method === "DELETE") return new Response("Method not allowed", { status: 405 });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    let body;
    try { body = await req.json(); } catch { return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 }); }
    const api = makeApi(env);
    const headers = { "content-type": "application/json" };
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleRpc(m, api)))).filter(Boolean);
      return out.length ? new Response(JSON.stringify(out), { headers }) : new Response(null, { status: 202 });
    }
    const out = await handleRpc(body, api);
    return out ? new Response(JSON.stringify(out), { headers }) : new Response(null, { status: 202 });
  },
};
