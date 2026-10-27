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
4. Optional, for a domain of your own, see below.

## A custom domain

1. `fly certs add www.example.com` (and `fly certs add example.com` for the bare domain, if you want both).
2. `fly certs show www.example.com` (or `fly certs setup`) prints the DNS records to create at your registrar:
   - a subdomain such as `www`: a `CNAME` to `breve-js.fly.dev`;
   - a bare domain: an `A` record to the app's IPv4 address and an `AAAA` to its IPv6 address (`fly ips list` shows them; run
     `fly ips allocate-v4 --shared` first if there is no IPv4 yet).
   Some registrars also want the `_acme-challenge` CNAME that `fly certs show` lists, which lets the certificate be issued before DNS moves.
3. Wait for DNS to spread (minutes to an hour), then `fly certs check www.example.com` until it says the certificate is issued.
   Fly renews it by itself. HTTPS is already forced in `fly.toml`.
4. Nothing in the site is tied to a hostname (all links are relative), so no code change is needed.

## What runs

- One small machine (`shared-cpu-1x`, 256 MB). It stops when idle and wakes on the next request (`min_machines_running = 0` in
  `fly.toml`; set it to 1 to keep it warm).
- Pages and the example files are served with `no-cache`; everything under `/assets/` has a hash in its name and is cached for a year.
- `/api/*` answers 404: the assistant, the in-app docs and the language-model controllers need the local server
  (`packages/server`, which holds the API key), and this deployment does not run it.

## Checking a build without Fly

`docker build -t breve .` then `docker run -p 8080:8080 breve` and open http://localhost:8080.
