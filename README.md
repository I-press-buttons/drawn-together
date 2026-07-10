# Drawn Together

A zero-dependency party card game: draw question cards of increasing rarity
and talk. Built with a static frontend (vanilla HTML/CSS/JS) and a Python
stdlib server — no frameworks, no build step, no pip installs.

![Drawing a card](docs/screenshots/card-light.png)

## Features

- **108 built-in questions** across five rarity tiers (common → mythic),
  with a glow reveal for legendary and mythic draws
- **Custom question packs** — create, edit, enable/disable, export and
  import packs as JSON
- **Greatest hits** — heart a question mid-game and replay your favorites
  as their own round
- **Retire questions** you never want to see again (with undo)
- **Optional score tracking**, discard pile, light/dark theme
- Fully responsive, keyboard-navigable, respects `prefers-reduced-motion`

| Dark mode | Pack manager | Mobile |
|---|---|---|
| ![Dark mode](docs/screenshots/card-dark.png) | ![Pack manager](docs/screenshots/packs-modal.png) | ![Mobile](docs/screenshots/card-mobile.png) |

## Run locally

Requires Python 3.9+ — nothing else.

```sh
python3 server.py
# open http://localhost:8080
```

Data files (`question_packs.json`, `user_data.json`) are written next to
`server.py`, or to `$DATA_DIR` if set. Port and bind address are
configurable via `PORT` and `HOST`.

## Deploy with Docker

Build the image and run it with a named volume so packs and favorites
survive container restarts and upgrades:

```sh
docker build -t drawn-together .
docker run -d --name drawn-together \
  -p 8080:8080 \
  -v drawn-together-data:/data \
  --restart unless-stopped \
  drawn-together
```

The game is now at `http://localhost:8080` (or `http://<host-ip>:8080`
from other devices on your network).

### Upgrade to a new version

```sh
docker build -t drawn-together .
docker rm -f drawn-together
docker run -d --name drawn-together -p 8080:8080 \
  -v drawn-together-data:/data --restart unless-stopped drawn-together
```

Your data lives in the `drawn-together-data` volume, so it survives the
container being replaced.

### Move the image to another machine (no registry needed)

```sh
docker save drawn-together | gzip > drawn-together.tar.gz
# copy the file over, then on the target machine:
docker load < drawn-together.tar.gz
docker run -d --name drawn-together -p 8080:8080 \
  -v drawn-together-data:/data --restart unless-stopped drawn-together
```

## Hosted web version (GitHub Pages + Supabase)

The same game deploys as a static site where invited users sign in with an
email magic link and keep their packs and favorites in
[Supabase](https://supabase.com), synced across devices. Anyone can play the
base deck without signing in.

One-time setup:

1. Create a free Supabase project and run `supabase/schema.sql` in its SQL
   editor.
2. In Authentication → Sign In / Up, disable **Allow new users to sign up**
   (accounts become invite-only; invite emails from the Users page).
3. In Authentication → URL Configuration, set the site URL to your Pages URL
   (e.g. `https://<user>.github.io/<repo>/`).
4. Put your project URL and publishable key in `config.web.js`.
5. In the repo settings, enable Pages with source "GitHub Actions".

Every push to `main` redeploys the site via `.github/workflows/pages.yml`.
The publishable key is safe to commit — row-level security is what protects
each user's data.

## Tests

```sh
python3 -m unittest test_server.py
```

## Project layout

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | Frontend (vanilla, no build step) |
| `questions.json` | The 108 built-in questions |
| `server.py` | Python stdlib server: static files + pack/marks API |
| `test_server.py` | API test suite (`unittest`) |
| `Dockerfile` | Container image (`python:3.12-slim`) |
