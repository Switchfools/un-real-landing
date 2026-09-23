# un-real.ai

A future worth aligning for. Our mission: alignment, coexistence, and human–AI symbiosis.

The deployable website lives entirely in `site/`: plain HTML, CSS, and JavaScript
with local assets, no build step, and no runtime dependencies. The previous
commercial site remains available in Git history before this rewrite.

## Preview

With Node.js 22 or later:

```sh
npm run dev
```

Open http://127.0.0.1:4173/ or http://127.0.0.1:4173/un-real-landing/ to check the
GitHub Pages subpath. Dependencies are not needed for preview. Alternatively,
serve `site/` with any static HTTP server.

## Checks

```sh
npm ci
npx playwright install chromium
npm run assets:check
npm run check
```

`npm test` checks numerical integration, bounds, projection, and timing.
`npm run test:browser` checks desktop/mobile rendering, both hosting paths,
links, assets, accessibility, pause/resume, visibility, resizing, reduced
motion, and static fallbacks. Playwright and axe are development tools only.

## The butterfly

`site/scripts/lorenz.js` owns the simulation and fixed orthographic projection.
It uses the classical Lorenz parameters (10, 28, 8/3), deterministic seeds, and
RK4 integration. The X–Y view has a fixed 12° roll to preserve the original
logo's diagonal, foreshortened butterfly. There are no camera controls.

The renderer advances at fixed time steps, caps density at 2×, and suspends
work when offscreen, hidden, or manually paused. Reduced motion, unavailable
canvas, and disabled JavaScript retain the static SVG. All content and
navigation work without motion.

After changing the simulation or projection, run `npm run assets` to regenerate
the fallback and favicon SVGs. `npm run assets:check` catches drift in CI. Run
`node scripts/render-brand.mjs` with Playwright installed to refresh the PNG
icons and social image. Keep `site/assets/brand/lockup.svg`, the original logo,
as the visual reference; compare the animated mark's diagonal lobes and narrow
waist against it. See [the Lorenz parameters](https://blogs.mathworks.com/cleve/2014/04/28/periodic-solutions-to-the-lorenz-equations/).

## GitHub Pages

1. In the repository, open **Settings → Pages → Build and deployment** and
   select **GitHub Actions** as the source.
2. Merge or push this rewrite to `main`. The workflow validates the site,
   uploads only `site/`, and deploys it. Pull requests run validation only.
   Manual dispatch on `main` can retry a deployment.
3. Confirm the **Validate and deploy Pages** workflow succeeds, then visit
   https://switchfools.github.io/un-real-landing/ and check the logo, navigation,
   email link, and mobile layout. The deployment URL also appears in the
   `github-pages` environment.

No application secrets are required. A failed check prevents deployment; the
previous Pages deployment stays live. To roll back, revert the relevant commit
on `main` and let the workflow redeploy.

### Connect un-real.ai later

Verify domain ownership in GitHub, add `un-real.ai` in the repository's Pages
settings, then configure your DNS provider using
[GitHub's custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
Enable HTTPS once available. Update the canonical URL and absolute Open Graph
URLs in the HTML to `https://un-real.ai/`. Relative assets support either hosting
location. Actions-based deployment does not require a CNAME file.

## Content

Edit `site/index.html` directly. Contact links use `mailto:contact-us@un-real.ai`;
there is no form backend, tracking, or data storage. Verify that mailbox
operationally before launch. Update the copyright year when needed. The page
describes commitments, not established projects or research results.
