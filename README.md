# un-real.ai

A future worth aligning for. Our mission: alignment, coexistence, and human–AI symbiosis.

The source lives in `site/` and essays in `content/essays/`. A small build step
turns Markdown into static HTML and writes the deployable website to `dist/`.
The published site has no runtime dependencies. The previous commercial site
remains available in Git history before the rewrite.

The build gives CSS and JavaScript content-based filenames so browsers always
load matching files after a deployment instead of mixing cached releases.

## Essay Studio

```sh
npm ci
npm run studio
```

Open http://127.0.0.1:4310/. The local Studio has a Markdown editor, live reader
preview, a library of drafts, selected-passage comments, image uploads, saved
revisions, and audio. Use **Save draft** or Cmd/Ctrl+S to write to disk. Unsaved
edits have browser recovery when local storage is available. No database or
cloud account is needed to write.

**The Imperfect Wish** is imported as a draft with a proposed 132-word abstract.
Its original Markdown is preserved in the revision history. The expanded opening
argument remains in the body as “The argument at a glance.” The source claims and
references have not been fact-checked as part of the import.

Every essay opens with **The idea in brief**, an editable abstract of at most
180 words. The full reasoning follows a visible divider. The editor and published
pages share the same Markdown renderer, including section anchors and footnotes.

Files are ordinary Markdown, with media alongside them:

| Location | Purpose |
| --- | --- |
| `content/drafts/<slug>.md` | Current working manuscript and YAML metadata |
| `content/workbench/<slug>/comments.md` | Selected passages, notes and resolution state |
| `content/workbench/<slug>/revisions/*.md` | Original import and prior saved manuscripts |
| `content/workbench/<slug>/releases/*.md` | Earlier prepared releases |
| `content/essay-assets/<slug>/` | Uploaded images, recordings and generated narration |
| `content/essays/<slug>.md` | Explicitly prepared publication copy |

The Studio binds only to the loopback interface. It is a local tool, not a hosted
CMS. Only prepared essays and their referenced media enter `dist/`; comments,
drafts, history and the editor are excluded. These files are still normal source
files, so committing them shares them with anyone who can read the repository.

### Narration

In **Audio**, connect an ElevenLabs API key for the current server session, choose
a voice from your library (or paste its ID), and give it a narrator credit. Brian,
a deep male American voice, is the default. Use **Generate short preview** to judge it before generating
the full essay. No browser speech synthesis is used. The integration uses
ElevenLabs Multilingual v2 with a measured reading speed; voice selection determines
the narrator's timbre. Generated audio is disclosed as AI narration.

Alternatively, copy `.env.example` to `.env` or `.env.local` and fill in
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` before starting the Studio.
Both files are ignored by Git; `.env.local` takes precedence. The browser never receives a stored API key.
Generation happens only when requested in the UI, sends the saved manuscript to
ElevenLabs, and uses the account's credits. Voice browsing requires the key's
`voices_read` permission; speech generation can also use a voice ID directly.
The imported essay includes a Brian voice audition in its Audio panel.
The provider integration follows the
[ElevenLabs speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

Long essays become consecutive audio parts, with automatic advancement, a part
selector, speed control and downloads. Completed parts are cached to allow retries
without regenerating them. A text fingerprint flags outdated narration. You can
also attach a human or AI recording (MP3, M4A, WAV or OGG, up to 60 MB), or remove
audio before release. Images support PNG, JPEG, WebP, GIF and AVIF up to 12 MB.

## Preview

With Node.js 22 or later:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4173/ or http://127.0.0.1:4173/un-real-landing/ to check the
GitHub Pages subpath. After editing, run `npm run build` in another terminal
and refresh, or restart `npm run dev`. Any static HTTP server can serve `dist/`.
Do not edit the generated `dist/` files.

## Publish an essay

In the Studio, resolve open comments, review the abstract and full text, and use
**Prepare release → Prepare final Markdown**. This validates the essay and writes
`content/essays/<slug>.md` with `draft: false`. It neither commits nor deploys.
Later edits remain in the working draft until another release is prepared.
Run `npm run dev` to review the public page, then commit the final Markdown and
its referenced assets and push when ready.

For a file-only workflow:

1. Copy `content/essays/_template.md` to a new file such as
   `content/essays/alignment-and-agency.md`.
2. Fill in the title, description, summary, publication date, author, and `action` in
   the YAML front matter, then write the essay in Markdown. The action becomes
   a dedicated **From belief to action** section after the essay.
3. Change `draft: true` to `draft: false` when ready. Run `npm run dev` to review
   the listing and the page at `/essays/alignment-and-agency/`.
4. Commit the Markdown and push to `main`. GitHub Actions builds and deploys it
   automatically, with the newest essays first on the landing page.

Drafts and files beginning with `_` are excluded from the published website.
No essays are published by default. See [the writing guide](content/essays/README.md)
for formatting and publishing details.

## Checks

```sh
npm ci
npx playwright install chromium webkit
npm run assets:check
npm run check
```

`npm test` checks numerical integration, bounds, 3D projection, fluid timing,
Markdown publishing, revision persistence, save conflicts, release isolation,
safe rendering, footnotes, and narration generation with a mocked provider.
`npm run test:browser` checks Chromium, mobile, and Safari/WebKit rendering, both hosting paths,
links, assets, accessibility, pause/resume, visibility, resizing, reduced
motion, dragging/resetting the 3D view, essay layouts, and static fallbacks.
The browser suite also exercises the Studio in an isolated temporary workspace:
editing, comments, revisions, images, audio uploads, export, release and local API
access controls. It never changes the real essay. Playwright, axe, Marked, and YAML
are development/build tools only. To use an already installed Chrome for the
Chromium projects, set `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`.

## The butterfly

`site/scripts/lorenz.js` owns the simulation and perspective camera.
It uses the classical Lorenz parameters (10, 28, 8/3), deterministic seeds, and
RK4 integration. The initial view has a 12° roll to preserve the original
logo's diagonal butterfly. All three coordinates affect the perspective;
depth changes the size, brightness, and overlap of the particles. The camera
drifts gently around the initial view, and dragging explores the volume.
The reset button returns to the logo view. On touchscreens, horizontal drags
adjust the view while vertical swipes retain normal page scrolling.

`FLOW_SPEED` is 0.085 simulation seconds per real second (roughly seven times
slower than the previous animation). Fixed simulation steps and interpolation
keep the motion fluid across display refresh rates. Adjust `FLOW_SPEED` to tune
the flow without changing the attractor's parameters or initial shape.

The renderer advances at fixed time steps, caps density at 2×, and suspends
work when offscreen, hidden, or manually paused. With a reduced-motion device
setting, it starts with the static SVG and a visible **Play motion** button.
Explicitly playing overrides that default for this site; playing or pausing
is remembered in local browser storage. Blocked storage does not prevent
playback. Unavailable canvas or disabled JavaScript retain the static SVG.
All content and navigation work without motion.

After changing the simulation or projection, run `npm run assets` to regenerate
the fallback and favicon SVGs. `npm run assets:check` catches drift in CI. Run
`node scripts/render-brand.mjs` with Playwright installed to refresh the PNG
icons and social image. Keep `site/assets/brand/lockup.svg`, the original logo,
as the visual reference; compare the animated mark's diagonal lobes and narrow
waist against it. See [the Lorenz parameters](https://blogs.mathworks.com/cleve/2014/04/28/periodic-solutions-to-the-lorenz-equations/).

## GitHub Pages

1. In the repository, open **Settings → Pages → Build and deployment** and
   select **GitHub Actions** as the source.
2. Merge or push to `main`. The workflow builds the site and essays, runs the
   checks, uploads only `dist/`, and deploys it. Pull requests run validation only.
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
URLs in `site/index.html` to `https://un-real.ai/`; essay metadata uses that
canonical base automatically. Relative assets support either hosting location.
Actions-based deployment does not require a CNAME file.

## Content

Edit `site/index.html` directly. Contact links use `mailto:contact-us@un-real.ai`;
there is no form backend or tracking. Only the animation preference is saved
locally in the browser. Verify that mailbox
operationally before launch. Update the copyright year when needed. The page
describes our commitments and their application in Karteria, without claiming
research results or proven fitness outcomes.

The **Mission in practice** section (`#practice`) introduces Karteria as our
first integration: an endurance fitness app in private development. Its copy
reflects the athlete-reviewed coaching and plan-approval flows in the Karteria
repository. Link visitors to the public [Karteria landing](https://karteria.ai/);
update the development status only when public access actually changes.

`site/assets/karteria/logo.svg` and `stride.svg` are unchanged copies of
`landing/assets/` in the Karteria repository, originally supplied in its brand
handoff. Keep their original geometry and colors. The track lines around the
mark are decorative; the section does not show a simulated app or athlete data.
