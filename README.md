# Ten Winners: deployment guide

A monthly community draw for the Pi Browser. Players buy 1 π tickets (max 10 each). On the 1st of every month at 12:00 UTC, 10 random winners split 90% of the pool equally; 10% is used to organize the game. Winners are shown by in-app nickname.

No npm packages are needed. The front end is static (`public/`), the back end is Vercel serverless functions (`api/`), and data lives in Upstash Redis. Pi sign-in exchanges the SDK access token with Pi App Studio server-side and stores only the returned App Studio identity in a signed HttpOnly cookie.

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
| `PI_API_KEY` | Server API Key from the Developer Portal |
| `PI_SANDBOX` | `true` for testing, `false` for the live network |
| `CRON_SECRET` | a long random string (Vercel sends it to the cron job) |
| `ADMIN_SECRET` | a different long random string |
| `APP_SESSION_SECRET` | a random secret of at least 32 characters for signed app sessions |

**6. Test in the sandbox.** Keep `PI_SANDBOX=true` and open the sandbox link from the Developer Portal in the Pi Browser. Connect, set a nickname, buy a ticket, and confirm the count and pool change. Then check on desktop and mobile browsers: the app loads and shows the game, and says to open the Pi Browser to buy.

**7. Test the draw.** Call the cron job by hand:
`curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR-APP.vercel.app/api/cron-draw`
It only draws rounds whose time has passed, and each round is drawn once.

**8. Go live.** Set `PI_SANDBOX=false`, redeploy, and submit the app in the Developer Portal.

## Paying winners and refunds

`curl -H "Authorization: Bearer YOUR_ADMIN_SECRET" https://YOUR-APP.vercel.app/api/payouts` lists pending prizes and refunds (user id, amount). Pay them from the app wallet, then mark each one: `POST /api/payouts` with `{"key":"<key from the list>"}`. To automate this, add a Pi backend SDK A2U call inside `api/payouts.js`.

## Good to know

- **Draw time** is 12:00 UTC (`DRAW_HOUR_UTC` in `api/_lib/core.js` and the cron in `vercel.json`; change both together). On Vercel's free plan a cron job can run anywhere within its hour.
- **Fair draw:** a secret seed is created per round and its hash is shown before sales. After the draw the seed is revealed, and `pick()` in `core.js` reproduces the winners. The operator can still see the seed in the database, so this is transparency, not a trustless draw.
- **Settings:** price, 10-ticket limit, winners count and 90/10 split are at the top of `api/_lib/core.js`.
- **Under 10 tickets:** the draw is cancelled and refunds are queued. Payments that arrive after a round closes, or beyond the 10-ticket limit, are also queued as refunds.
- **Nicknames** are not checked for uniqueness. Pi usernames are never shown publicly.
- **Pi Browser support:** the Pi SDK is loaded from `sdk.minepi.com`; outside the Pi Browser the app is read-only.
- **Docs used:** Pi Platform docs (`Pi.init`, `Pi.authenticate`, `Pi.createPayment`, and the Platform API `/me` and `/payments` approve/complete/cancel endpoints). Pi may change them, so recheck before launch.
