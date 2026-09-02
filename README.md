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

`portal/` is the production launcher for the collection. It serves the arcade,
starts each game only after someone presses Play, and stops an inactive game
server after 15 minutes. It also provides first-party, pseudonymous analytics
at `/admin` when `ADMIN_TOKEN` is configured.

Deployment templates for systemd, Nginx, and its environment file are in
`deploy/`. Pixel Brawl must be built with `npm run build` before deployment.
