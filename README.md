# oura-mcp

A remote [MCP](https://modelcontextprotocol.io) server for your Oura Ring data, running on Cloudflare Workers.
Connect it once to claude.ai (web, desktop, mobile) or any MCP client that supports remote servers, and ask things like
"How did I sleep this week?" without keeping a computer running.

Unofficial project. Not affiliated with or endorsed by Oura.

## How it works

- You deploy your own copy to your own Cloudflare account (free plan is enough).
- You use your own Oura API application, so your data and credentials never touch anyone else's server.
- One tool, `oura_data`, reads 19 Oura API v2 collections: `daily_sleep`, `daily_readiness`, `daily_activity`,
  `daily_stress`, `daily_resilience`, `daily_spo2`, `daily_cardiovascular_age`, `sleep`, `sleep_time`, `workout`,
  `session`, `tag`, `enhanced_tag`, `rest_mode_period`, `vO2_max`, `heartrate`, `ring_battery_level`,
  `ring_configuration`, `personal_info`.
- Read only. The server never writes to your Oura account.
- OAuth tokens live in a Durable Object. Oura refresh tokens are single use, so one object rotates them safely.

## Setup

1. **Create an Oura API app** at <https://developer.ouraring.com>. You will add the redirect URI in step 4.
2. **Deploy.**
   ```sh
   git clone https://github.com/<you>/oura-mcp && cd oura-mcp
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   Wrangler prints your URL, for example `https://oura-mcp.<your-subdomain>.workers.dev`.
3. **Set secrets.**
   ```sh
   npx wrangler secret put OURA_CLIENT_ID
   npx wrangler secret put OURA_CLIENT_SECRET
   npx wrangler secret put MCP_SECRET     # a long random string, e.g. output of: openssl rand -hex 24
   ```
4. **Add the redirect URI** `https://<your-worker-host>/callback` to your Oura app.
5. **Connect your Oura account.** Open `https://<your-worker-host>/<MCP_SECRET>/login` in a browser and approve access.
6. **Add the connector.** In claude.ai go to Settings, Connectors, Add custom connector, and paste
   `https://<your-worker-host>/<MCP_SECRET>/mcp`. Choose "No sign-in".

## Security model

The URL path contains `MCP_SECRET`. Anyone who knows the full URL can read your Oura data, so treat it like a password.
Requests to any other path return 404. To rotate it, run `wrangler secret put MCP_SECRET` again and update your connector.
If you want stronger protection, put the Worker behind Cloudflare Access.

## Local development

```sh
cp .dev.vars.example .dev.vars   # fill in the values
npx wrangler dev
```

## Notes

- Oura personal access tokens are deprecated, so this uses OAuth2.
- If tools start returning "token refresh failed", repeat step 5 to reconnect.
- Custom domain: add a `routes` entry with `custom_domain: true` to `wrangler.jsonc`.

## License

MIT
