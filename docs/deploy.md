# Deploying the site to Fly

The workbench is a static site (`packages/workbench/dist`). The `Dockerfile` builds it with Node and serves it with nginx
(`deploy/nginx.conf`); `fly.toml` runs that image. A push to `main` deploys it (`.github/workflows/deploy.yml`), the same way
the kleininen site does.

## One-time setup

1. Create the app (the name is global; if `breve-js` is taken, pick another and change `app` in `fly.toml`):
   `fly apps create breve-js`
2. Make a deploy token and store it in the GitHub repository as the secret `FLY_API_TOKEN` (Settings > Secrets and variables > Actions):
   `fly tokens create deploy -a breve-js`
3. Deploy once by hand to check it, or just merge to `main`:
   `fly deploy --remote-only --ha=false`
4. Optional, for a domain of your own: `fly certs add <domain>`, then point DNS at the addresses `fly certs setup <domain>` prints.

## What runs

- One small machine (`shared-cpu-1x`, 256 MB). It stops when idle and wakes on the next request (`min_machines_running = 0` in
  `fly.toml`; set it to 1 to keep it warm).
- Pages and the example files are served with `no-cache`; everything under `/assets/` has a hash in its name and is cached for a year.
- `/api/*` answers 404: the assistant, the in-app docs and the language-model controllers need the local server
  (`packages/server`, which holds the API key), and this deployment does not run it.

## The placeholder password

Every page has a small inline script that asks for a password (`spiderland`) on any host except `localhost`. It is a placeholder
until the project is public, not security: the password is in the page source. To remove it, delete the `<script>` block that
mentions `breve.pass` from the `<head>` of the six HTML files in `packages/workbench` (`index.html` and `explore/`, `sim/`,
`gallery/`, `blog/`, `about/`).

## Checking a build without Fly

`docker build -t breve .` then `docker run -p 8080:8080 breve` and open http://localhost:8080 (the password applies only off
localhost, so it will not ask).
