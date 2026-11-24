# Ten Winners: deployment guide

A weekly community draw for the Pi Browser. Tickets cost 1 Testnet Pi in Sandbox. Accounts can buy bundles of 1, 5, 10, 25, 50 or 100, up to 100 tickets per draw in Sandbox. The draw runs Sundays at 20:00 UTC. Ten winners split 90% of the pool equally.

No npm packages are needed. The front end is static (`public/`), the back end is Vercel serverless functions (`api/`), and data lives in Upstash Redis. The server verifies the SDK access token with the Pi Platform API and uses the returned identity to create a signed session.

## Before you start: read this

1. **Legal.** A paid ticket + chance + prize is a lottery in most countries and often needs a license. Get local legal advice before using real Pi.
2. **Pi approval.** Pi Network reviews apps in its ecosystem. Payments only work for apps registered in the Pi Developer Portal, and approval of this concept is Pi's decision, not yours or mine.
3. **Payouts are manual for now.** Pi's frontend SDK only takes payments (user to app). Paying winners (app to user) needs a Pi backend SDK and your app wallet. Until you add that, `/api/payouts` lists every prize and refund to pay out.
4. **Branding.** This app uses its own icon (`public/icon.svg`). Do not add the Pi Network logo or use "Pi" in the app name without written permission from Pi (see their Trademark Guidelines).

## Deploy step by step

**1. Put the project on GitHub.** Create a repository and upload this folder (the `.env.example` file is safe to commit, real keys are not).

**2. Create the Vercel project.** In Vercel choose *Add New → Project*, import the repository, leave *Framework Preset* on **Other**, then deploy once.

**3. Add the database.** In your Vercel project open *Storage* (or the Marketplace), add **Upstash Redis** and connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.

**4. Register the app with Pi.** Open `develop.pi` in the Pi Browser, create an app, and set its URL to your Vercel address (for example `https://ten-winners.vercel.app`). Copy the **Server API Key**. Follow the Developer Portal steps for domain verification: if it asks you to host a validation key, paste it into `public/validation-key.txt` and redeploy (the file is served at `/validation-key.txt`). App Studio validation uses the separate `public/pi-app-validation.txt` file..

**5. Set environment variables** (Vercel → Settings → Environment Variables, then redeploy):

| Name | Value |
|---|---|
| `PI_SANDBOX` | `true` for Sandbox SDK mode in a nonproduction environment |
| `PI_SANDBOX_PURCHASES` | `true` to enable Sandbox purchases explicitly |
| `PI_SANDBOX_API_KEY` | Server API Key for the Pi Testnet app |
| `PI_SANDBOX_REDIS_URL`, `PI_SANDBOX_REDIS_TOKEN` | REST credentials for a separate Sandbox Redis database |
| `CRON_SECRET` | a long random string (Vercel sends it to the cron job) |
| `ADMIN_SECRET` | a different long random string |
| `APP_SESSION_SECRET` | a random secret of at least 32 characters for signed app sessions |

**6. Test in the Sandbox.** Scope these Sandbox variables and a separate session secret to an isolated Vercel Preview with Vercel system environment variables enabled. For local development outside Vercel, set `NODE_ENV=development`. Make the development URL reachable from Pi Sandbox and use a separate Redis database.

1. In Pi Browser, open `develop.pinet.com` and select the Pi Testnet app. Enter the isolated development URL. Open **Run Development App in the Sandbox** in the app checklist and follow the generated Sandbox URL.
2. If a code appears, open the Pi mobile app and go to **Pi Utilities → Authorize Sandbox**. Enter the code there, then return to the Sandbox.
3. Confirm the Test mode banner, select **Connect with Pi** and authorize payments. Note your ticket count and pool, choose **Buy 1**, and verify that the wallet identifies the network as Testnet before confirming 1 Testnet Pi.
4. Expect one additional ticket, a pool increase of 0.9 and one credited purchase under **Account → Transactions**. Reload and reconnect to confirm those values persist. Cancel a second payment at the wallet and confirm the count and credited transaction total stay the same.
5. After buying 1, **Buy 100** should be disabled. Test a 100-ticket purchase with a fresh test account or a fresh draw and confirm all six bundles disable after crediting.

Run `node --test` for the payment tests. Set `TEST_REDIS_SERVER` and `TEST_REDIS_CLI` to local Redis executables to include the ledger test. The test starts an isolated loopback-only Redis instance with persistence disabled.

**7. Test the draw.** Call the cron job by hand:
`curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-APP.vercel.app/api/cron-draw`
It only draws rounds whose time has passed, and each round is drawn once.

**8. Production behavior.** The purchase API returns HTTP 403 in production, and the state endpoint reports purchases as disabled.

## Paying winners and refunds

`curl -H "Authorization: Bearer YOUR_ADMIN_SECRET" https://YOUR-APP.vercel.app/api/payouts` lists pending prizes and refunds (user id, amount). Pay them from the app wallet, then mark each one: `POST /api/payouts` with `{"key":"<key from the list>"}`. To automate this, add a Pi backend SDK A2U call inside `api/payouts.js`.

## Good to know

- **Draw time** is 20:00 UTC (`DRAW_HOUR_UTC` in `api/_lib/core.js` and the cron in `vercel.json`; change both together). On Vercel's free plan a cron job can run anywhere within its hour.
- **Fair draw:** a secret seed is created per round and its hash is shown before sales. After the draw the seed is revealed, and `pick()` in `core.js` reproduces the winners. The operator can still see the seed in the database, so this is transparency, not a trustless draw.
- **Settings:** price, Sandbox ticket tiers and cap, winner count and 90/10 split are at the top of `api/_lib/core.js`.
- **Under 10 tickets sold:** the draw is cancelled and refunds are queued. Verified Sandbox payments that arrive after a round closes or exceed the 100-ticket account cap are also queued for a test refund.
- **Nicknames** are not checked for uniqueness. Pi usernames are never shown publicly.
- **Pi Browser support:** the Pi SDK is loaded from `sdk.minepi.com`; outside the Pi Browser the app is read-only.
- **Docs used:** Pi Platform docs (`Pi.init`, `Pi.authenticate`, `Pi.createPayment`, and the Platform API `/me` and `/payments` approve/complete/cancel endpoints). Pi may change them, so recheck before launch.
