# Next 0: after the Cloudflare set-up

Done as planned (`plan_0.md`). `wrangler deploy --dry-run` reads the 10 files in `dist/`;
`wrangler dev` serves them with the intended `Cache-Control`; `npm run distcheck` passes
(`_headers` ships but is not served).

Next:

- The first real deploy needs `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` in CI), then `npm run deploy`.
- A custom domain goes in `wrangler.jsonc` under `routes` with `"custom_domain": true`.
- Measure the deployed build: `OURS_URL=https://ink-raid.<account>.workers.dev/ npm run perf`.
- The main chunk is 712 KB (203 KB gzipped). Cloudflare serves it with Brotli, which helps, but
  splitting the title screen from the game would bring time to interaction down further.
