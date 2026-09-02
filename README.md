# Slopgames

A small collection of AI-generated browser games. Each game is self-contained
and has its own setup instructions.

## Games

### DuoStrike

`duostrike/` is a two-player co-op FPS adventure. Team up, explore the map,
complete tasks, and fight enemies together.

To run it:

```bash
cd duostrike
npm install
npm start
```

Then open <http://localhost:3000> in two browser tabs.

### Pixel Brawl

`pixel brawl/` is a pixel-art arena brawler with several multiplayer modes,
including Gem Grab, Showdown, Bounty, and Duel.

To run it:

```bash
cd "pixel brawl"
npm install
npm run dev
```

Then open the local URL shown by Vite, usually <http://localhost:5173>.

## Notes

These games are experiments and may change over time. See each game's README
for more detailed controls, modes, and testing instructions.

## Slopgames portal

`portal/` is the production launcher for the collection and the site you get at
<https://slopgames.al007ex.com>. It is a dependency-free Node server that:

- renders the arcade home page and the per-game landing pages,
- starts a game server only after someone presses Play, and stops it again once
  the last player leaves (15 minutes idle by default),
- records first-party, pseudonymous analytics, readable at `/admin` with the
  `ADMIN_TOKEN`.

Run it locally with:

```bash
cd portal
npm start
```

### Adding a game

Games live in the `games` object at the top of `portal/server.mjs`. One entry
holds both what the launcher needs (`dir`, `port`, `health`) and what the page
shows (`name`, `blurb`, `art`, `tags`, `players`), so adding a game means adding
an object, dropping a 16:9 image into `portal/public/art/`, and adding a proxy
block for its port to the Nginx config.

The home page is rendered from that same object, so the card, the filter chips,
the sitemap and the JSON-LD all pick the new game up on their own.

### Serving a game under a sub-path

Each game is proxied at `/<slug>/`, so nothing a game loads may be an absolute
path — `/js/main.js` would resolve against the domain root rather than the
game. DuoStrike loads its modules relatively and reaches `shared/` through the
`#shared/` specifier, which resolves through `package.json` `"imports"` in Node
and through the import map in `client/index.html` in the browser. Pixel Brawl is
built with Vite's `base` set to `/pixel-brawl/` in production.

## Deployment

Templates live in `deploy/`:

| File | Installed to |
| --- | --- |
| `slopgames.service` | `/etc/systemd/system/slopgames.service` |
| `slopgames.al007ex.com.nginx.conf` | `/etc/nginx/sites-available/` (symlinked into `sites-enabled/`) |
| `slopgames.env.example` | copy to `/etc/slopgames/portal.env` and fill in |

Pixel Brawl must be built before it will serve in production:

```bash
cd "pixel brawl" && npm install && npm run build
```

TLS is a Let's Encrypt certificate for `slopgames.al007ex.com`, issued with
certbot's Nginx authenticator and renewed automatically by `certbot.timer`.
Because the renewal uses that authenticator, the vhost deliberately does not
define an ACME webroot location. Verify renewal with:

```bash
certbot renew --cert-name slopgames.al007ex.com --dry-run
```
