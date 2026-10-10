<div align="center">

<img src="assets/banner.svg" alt="oura-mcp: talk to your Oura Ring from anywhere with any AI" width="100%">

<br>

A remote [MCP](https://modelcontextprotocol.io) server that plugs your **Oura Ring** data into Claude, running on **Cloudflare Workers**.
No laptop left on. No server to babysit. Free to host.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mehmetaktug/oura-mcp)

[![CI](https://img.shields.io/github/actions/workflow/status/mehmetaktug/oura-mcp/ci.yml?branch=main&style=for-the-badge&label=tests)](https://github.com/mehmetaktug/oura-mcp/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![MCP](https://img.shields.io/badge/protocol-MCP-7C3AED?style=for-the-badge)
![Read only](https://img.shields.io/badge/access-read--only-2EA44F?style=for-the-badge)
![Cost](https://img.shields.io/badge/hosting-free%20tier-black?style=for-the-badge)

</div>

---

## ✨ What you get

> *"How did I sleep this week, and what is dragging my readiness down?"*

Ask in plain language. Claude pulls the numbers straight from your ring and answers.

<div align="center">
<img src="assets/rings.svg" alt="Animated Sleep, Readiness and Activity rings" width="640">
</div>

| 🗣️ You ask | 🔍 It reads |
|---|---|
| "Show my sleep and readiness for the last 7 days" | `daily_sleep`, `daily_readiness` |
| "How much sleep debt do I have?" | `sleep_summary` |
| "Am I doing better than last week?" | `weekly_comparison` |
| "Is my HRV trending up or down this month?" | `hrv_trend` |
| "Why is my readiness lower than usual?" | `readiness_drivers` |
| "Did that late workout hurt my sleep?" | `workout`, `daily_sleep` |
| "What was my resting heart rate last night?" | `sleep`, `heartrate` |
| "How stressed was I on Monday?" | `daily_stress` |
| "What is my VO2 max and cardiovascular age?" | `vO2_max`, `daily_cardiovascular_age` |
| "How much battery does my ring have left?" | `ring_battery_level` |

## 🧠 How it works

```mermaid
flowchart LR
    A["🤖 Claude<br/>web, desktop, mobile"] -- "MCP over HTTPS" --> B["☁️ Your Cloudflare Worker<br/>oura-mcp"]
    B -- "OAuth2 bearer token" --> C["💍 Oura API v2"]
    B <-- "rotating tokens" --> D[("🔐 Durable Object")]
```

- 🏠 **Your own deployment.** It runs in *your* Cloudflare account with *your* Oura API app. Your health data never passes through anyone else's server.
- 🔒 **Read only.** The server never writes anything to your Oura account.
- 🔁 **Safe token rotation.** Oura refresh tokens are single use. One Durable Object rotates them, so concurrent requests cannot break your login.
- 🧰 **Raw data plus smart tools.** `oura_data` reads 19 collections, and four analysis tools do the maths for you.
- ✅ **Tested.** The analysis code is pure functions with a unit test suite that runs in CI on every push.

## 📸 See it in action

<table>
<tr>
<td width="50%"><img src="assets/screenshot-sleep.png" alt="Asking about sleep debt"></td>
<td width="50%"><img src="assets/screenshot-weekly.png" alt="Comparing this week with last week"></td>
</tr>
<tr>
<td align="center"><sub>"How much sleep debt do I have?"</sub></td>
<td align="center"><sub>"Am I doing better than last week?"</sub></td>
</tr>
</table>

<sub>Illustrative examples with sample data. Your own numbers come live from your ring.</sub>

## 🧠 Smart tools

You do not have to ask Claude to crunch raw JSON. These tools return ready-made answers:

| Tool | What it answers |
|---|---|
| `sleep_summary` | Night by night score, hours, efficiency, HRV and lowest heart rate, with averages, best and worst night, and **sleep debt** against your target (default 7.5 h) |
| `weekly_comparison` | **This week vs last week** for sleep, readiness, activity and steps, with change and percent change |
| `hrv_trend` | Nightly HRV, rolling average, min and max, and whether you are **trending up, down or flat** |
| `readiness_drivers` | What is **helping or dragging** today's readiness: the three weakest and three strongest contributors |

<details>
<summary><b>📚 All supported collections (raw tool)</b></summary>

| Group | Collections |
|---|---|
| 😴 Sleep | `daily_sleep`, `sleep`, `sleep_time`, `rest_mode_period` |
| ⚡ Readiness and stress | `daily_readiness`, `daily_stress`, `daily_resilience` |
| 🏃 Activity | `daily_activity`, `workout`, `session` |
| ❤️ Heart and body | `heartrate`, `daily_spo2`, `daily_cardiovascular_age`, `vO2_max` |
| 🏷️ Context | `tag`, `enhanced_tag` |
| 💍 Device and profile | `ring_configuration`, `ring_battery_level`, `personal_info` |

Daily collections take `start_date` and `end_date`. Time series (`heartrate`, `ring_battery_level`) take `start_datetime` and `end_datetime`. Any record can be fetched with `document_id`, and large results page with `next_token`.

</details>

## 🚀 Setup in 6 steps

**You need:** a free [Cloudflare](https://dash.cloudflare.com/sign-up) account, an Oura account, and Node.js 18 or newer.

**1. Create an Oura API app** at [developer.ouraring.com](https://developer.ouraring.com). You will add the redirect URI in step 4.

**2. Deploy** (or use the button above)

```sh
git clone https://github.com/mehmetaktug/oura-mcp && cd oura-mcp
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler prints your URL, for example `https://oura-mcp.<your-subdomain>.workers.dev`.

**3. Set your secrets**

```sh
npx wrangler secret put OURA_CLIENT_ID
npx wrangler secret put OURA_CLIENT_SECRET
npx wrangler secret put MCP_SECRET     # long random string: openssl rand -hex 24
```

**4. Add the redirect URI** to your Oura app:

```
https://<your-worker-host>/callback
```

**5. Connect your ring.** Open this in a browser and approve access:

```
https://<your-worker-host>/<MCP_SECRET>/login
```

**6. Add the connector.** In claude.ai open **Settings → Connectors → Add custom connector**, paste the URL below and choose **No sign-in**:

```
https://<your-worker-host>/<MCP_SECRET>/mcp
```

<img src="assets/screenshot-setup.png" alt="Add custom connector dialog" width="720">

That is it. Start a new chat and ask about your sleep. 🎉

## 🛡️ Security model

| | |
|---|---|
| 🔑 **Secret URL** | The path contains `MCP_SECRET`. Anyone who knows the full URL can read your Oura data, so treat it like a password. Every other path returns `404`. |
| 🔄 **Rotate anytime** | Run `npx wrangler secret put MCP_SECRET` with a new value and update your connector. |
| 🧱 **Want more?** | Put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) for real authentication. |
| 👀 **Read only** | No tool can modify your Oura account. |

## 🧪 Local development

```sh
cp .dev.vars.example .dev.vars   # fill in the values
npx wrangler dev
npm test                          # run the unit tests
```

Use `http://localhost:8787/callback` as an extra redirect URI in your Oura app while testing.

## 🩹 Troubleshooting

| Symptom | Fix |
|---|---|
| `Not connected to Oura yet` | Do step 5 once. |
| `token refresh failed` | Your Oura access was revoked or expired. Repeat step 5. |
| Oura shows `400 invalid_request` | The redirect URI in your Oura app must match `https://<your-worker-host>/callback` exactly. |
| Want your own domain | Add a `routes` entry with `custom_domain: true` to `wrangler.jsonc`. |

## 🗺️ Ideas for contributions

- More analysis tools: correlations with tags, anomaly detection, stress and recovery balance
- Optional API key header authentication
- Webhook support for push updates
- Response trimming for token efficiency

PRs and issues are welcome. ⭐ If this is useful to you, a star helps others find it.

## ⚖️ Disclaimer

Unofficial community project. Not affiliated with or endorsed by Oura. Your data is yours: use at your own risk and never share your secret URL.

You run your own copy with your own Oura API app, so you are responsible for following the [Oura API and MCP Agreement](https://cloud.ouraring.com/legal/api-agreement) and applicable privacy laws.

## 📄 License

[MIT](LICENSE)
