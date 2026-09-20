# Supabase keep-alive worker

A Cloudflare Worker on a daily cron trigger that makes one REST request to the
Supabase project, so the free tier never sees 7 consecutive idle days and
auto-pauses the database.

Unlike a GitHub Actions `schedule:`, this keeps running when the repo goes
quiet — GitHub disables scheduled workflows after 60 days without commits.

## Deploy

From this directory, with Node installed:

```sh
npx wrangler login        # once, opens a browser
npx wrangler deploy
```

`wrangler deploy` registers the cron trigger along with the script; there is
nothing to configure in the dashboard afterwards. Confirm it landed:

```sh
npx wrangler deployments list
npx wrangler tail          # watch live logs, including scheduled runs
```

## Verify

Trigger the same ping by hand, either way:

```sh
curl https://drawn-together-keepalive.<your-subdomain>.workers.dev
npx wrangler dev --test-scheduled   # then: curl 'localhost:8787/__scheduled'
```

A healthy response is `{"ok": true, ...}` with `status: 200` per target.

## Adding another project

Append to `TARGETS` in `src/index.js` and redeploy. Only publishable (anon)
keys belong in that list — they are already public in the shipped client
config. Never put a service-role key here.

## Cost

Workers Free allows cron triggers and 100k requests/day; one request a day is
free indefinitely.
