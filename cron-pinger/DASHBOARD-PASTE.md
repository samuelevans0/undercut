# Deploying the pinger without a Workers API token

Pages-scoped Cloudflare tokens cannot deploy Workers. Rather than provisioning a
wider token, paste this Worker once through the dashboard. It never needs to
change afterwards.

1. Cloudflare dashboard, Workers and Pages, Create, Create Worker.
2. Name it `undercut-pinger`. Deploy the placeholder, then Edit Code.
3. Replace the contents with `worker.js` from this folder. Deploy.
4. Settings, Variables:
   - `UNDERCUT_ORIGIN` = `https://undercut.pages.dev` (no trailing slash)
   - `POLL_SECRET` = the same value set as a secret on the Pages app
   **Click Deploy after adding variables.** A variable is not live until you do.
   This exact step was missed once on My Email and cost real debugging time.
5. Settings, Triggers, Cron Triggers, Add: `* * * * *`.

## Verifying it works

Cloudflare dashboard, the Worker, Logs. You should see one invocation a minute
with four subrequests. On the Pages side, check that `sources.last_polled_at`
is advancing:

    npx wrangler d1 execute undercut-db --remote --command "SELECT id, last_polled_at, last_status, consecutive_failures FROM sources"
