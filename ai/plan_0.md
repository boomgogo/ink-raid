# Plan 0: deploy on Cloudflare with wrangler

The game is a static Vite build with no server, so it goes up as a Worker with static assets only
(Cloudflare now recommends this over Pages for new projects).

- `wrangler.jsonc`: name `ink-raid`, `assets.directory` `./dist`, no `main`.
- `public/_headers`: `/assets/*` immutable for a year (content-hashed names); `/fonts/*` a week.
  `index.html` keeps the default revalidate, so a deploy shows up on the next visit.
- `wrangler` as a dev dependency; scripts `deploy` (build, then `wrangler deploy`) and `cf:dev`.
- `.wrangler/` in `.gitignore`; a Deploy section in `README.md`.
- Check: `wrangler deploy --dry-run`, `wrangler dev` headers, `npm run distcheck`.
