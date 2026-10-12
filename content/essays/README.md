# Essays: from belief to action

Write here in Markdown. GitHub Actions builds the essays into static pages,
adds them to the homepage, and deploys them with the site.

The canonical public URL is `https://un-real.ai/essays/<slug>/`. Publishing also
updates the essay index, sitemap and RSS feed and generates a sharing image from
the title and author. Write a distinct, accurate `description`; it appears in
search and social metadata. See [the SEO and distribution guide](../../docs/seo.md).

For iterative writing, run `npm run studio` and open http://127.0.0.1:4310/.
Working copies live in `content/drafts/`. **Prepare release** creates a separate
validated copy in this directory, without deploying it. Comments and previous
versions remain Markdown files in `content/workbench/`.

Copy `_template.md` to a lowercase, hyphen-separated filename, for example
`alignment-and-agency.md`. The filename sets the URL: `/essays/alignment-and-agency/`.
Keep it stable after publication so existing links continue to work.

Fill in the front matter:

```yaml
---
title: "Your essay title"
description: "A short introduction used on the homepage and in link previews."
subtitle: "An optional subtitle for the article itself."
summary: |
  State the conclusion first. Include the main reasons and consequences so
  a busy reader understands the argument without reading the whole essay.
date: "2026-09-23"
author: "Nicolás Vergara"
draft: true
action: "One concrete next step the reader can take."
---
```

Write the body below the closing `---`. The title appears automatically, so
start with a paragraph and use `##` for sections. Markdown supports links,
lists, emphasis, blockquotes, code blocks, and tables. Place images in
`content/essay-assets/<slug>/` and reference them from the published page with,
for example, `![A meaningful description](../../assets/essays/my-essay/diagram.png)`.
Only media referenced by published essays is copied into the website. The Studio
uploads images and inserts the Markdown for you, including an optional caption.
Legacy images in `site/assets/essays/` still work; that whole static directory is
always public.

The `summary` is required at publication and limited to 180 words. Aim for
100–150 words. It renders in a separate **The idea in brief** section above the
full essay; the description remains the shorter listing and social-preview text.
Do not repeat the title or author in the body. Headings become section links;
footnotes use `[^1]` references and `[^1]: Source details` definitions. Raw HTML is
shown as text, and unsafe link schemes are suppressed.

For a small formatted disclosure, figure/caption or table, use an explicit `html`
code block. Its preview is sanitized with a strict allowlist: no scripts, event
handlers, CSS, forms, embeds, SVG/MathML or external image requests. Image sources
must use the essay's portable local asset reference. Ordinary raw HTML remains
escaped. To show HTML as literal code, use a `text` code block instead.

```html
<details><summary>What would change my mind?</summary>
<p>A repeatable experiment that challenges this assumption.</p></details>
```

For a flow diagram, use a `diagram` code block containing JSON. A title is required;
use 1–12 nodes with unique IDs and labels up to 80 characters. Optional `column`
(0–2) and `row` (0–11) position nodes on a grid; the defaults are column 0 and the
node's array index. Up to 24 edges connect node IDs. Edge labels appear in the
accessible **Diagram in words** description. Diagrams render without JavaScript.

```diagram
{"title":"Belief into action","nodes":[{"id":"belief","label":"State a belief"},{"id":"test","label":"Test an assumption"}],"edges":[{"from":"belief","to":"test","label":"Choose a small experiment"}]}
```

ChatGPT can call `get_visual_guide`, reuse images with `list_images`, and pass
generated or attached images through `stage_chatgpt_image` (up to 12 MB). The file
handoff copies the image into private Studio storage; no public hosting is needed.
If ChatGPT cannot pass a generated image as a file, attach/select it in the chat
or upload it in Studio. Other clients can use `stage_image` with actual base64
bytes (up to 2 MB). Put the returned Markdown in a proposal for your review.
Image staging itself changes no manuscript.

### Interactive visualizations

Use a `visualization` JSON fence for generated JavaScript with a strictly limited
drawing interface. It must define a synchronous `render(input)` function that
returns `{commands: [...], caption?: "..."}`. It runs in a separate interpreter;
there is no `window`, DOM, network, storage, browser messaging, timer, or module
loader. Do not paste browser code, HTML, D3/CDN imports or event handlers into it.
Use native JavaScript mathematics and the drawing commands below.

```visualization
{"title":"Explore a growth curve","description":"Move the growth slider to compare illustrative curves. This is a simplified model, not a prediction.","height":320,"controls":[{"id":"growth","label":"Growth","type":"range","min":0.5,"max":2,"step":0.05,"value":1}],"code":"function render({width,height,values}) { const points=[]; for(let i=0;i<=80;i++){const x=i/80;points.push([30+x*(width-60),height-30-Math.pow(x,values.growth)*(height-60)]);} return {commands:[{type:'polyline',points,stroke:'#e5ad72',lineWidth:3}],caption:'Growth: '+values.growth}; }","fallback":{"commands":[{"type":"line","x1":30,"y1":290,"x2":610,"y2":30,"stroke":"#e5ad72","lineWidth":3}]}}
```

Required: `title`, `description`, `code`. Optional: `height` (200–640; default
400), `animated` (default false), `controls`, and `fallback`. The fallback is a
static drawing in a 640 × height coordinate space. Always explain the main idea
in `description` so it remains understandable without interaction.

`input` provides `width`, `height`, `values` (only this diagram's controls),
`pointer: {x, y, down}`, `time` (elapsed animation seconds) and `reducedMotion`.
Pointer coordinates come only from the canvas; arrow keys move it and Space
toggles its pressed state. Variables inside the interpreter can retain state
between frames. Reset creates a fresh interpreter. Render once on Run and after
input changes; animation advances only after the reader chooses Play.

Controls (up to eight, unique lowercase `id` and accessible `label`):

- `range`: `min`, `max`, `step`, numeric `value`.
- `select`: `options` (2–12 strings), selected string `value`.
- `toggle`: boolean `value`.

Each drawing command has a `type` and its coordinates:

| Type | Fields |
| --- | --- |
| `line` | `x1`, `y1`, `x2`, `y2` |
| `rect` | `x`, `y`, `width`, `height` |
| `circle` | `x`, `y`, `r` |
| `path` | `d` containing only SVG path commands and numeric coordinates |
| `polyline` | `points: [[x,y], ...]` |
| `text` | `x`, `y`, `text`, optional `size` (8–64), `align` (left/center/right) |

Commands may include `fill` and `stroke` (hex colors or `transparent`),
`lineWidth` (0–20) and `opacity` (0–1). Coordinates must be finite and within
±10,000. Paths are drawing data, not arbitrary SVG markup. All text is literal.

Keep the JSON under 60 KB, code under 24 KB, and output under 180 KB. A frame may
contain at most 1,200 commands and 12,000 path/polyline coordinate values. The
interpreter has a 16 MB heap, a 40 ms execution deadline, and a separate worker
watchdog. Large or invalid drawings stop with a recovery message. At most one
visualization runs at a time, up to 15 animation frames per second. Review the
code diff and interactive preview before approving; publish separately.

Studio validates visual definitions and fallback drawings before saving a new
ChatGPT proposal version. Invalid visuals in older proposals show an explanation
while their text and diff remain readable. Ask ChatGPT to read `previewErrors`
with `get_proposal` and correct the pending proposal using `revise_proposal`.
Approval and publication remain blocked until those errors are fixed. Use filled
shapes for broad areas instead of strokes wider than 20; the original proposal
version stays in history.

Highlight text in either the manuscript or reader preview, then choose
**Comment on selection**. Save to persist notes. Notes record the selected quote
and nearby context; if a passage changes or becomes ambiguous, the Studio asks
you to reselect and reattach it. Resolve all notes before preparing a release.
History can restore an earlier manuscript while retaining notes for review.

**Export .md** downloads the current manuscript, including YAML metadata. Media
remains in the asset directory, and comments remain in their Markdown sidecar;
copy those folders too when moving an entire workspace between computers.

Attach a recording or generate one with ElevenLabs in the Audio panel. The Studio
writes `audio` metadata with narrator credit, AI disclosure, a text fingerprint
and an ordered track list. Text changes make the recording stale and block release
until it is replaced or removed. Images and Markdown formatting do not become
spoken markup; links read as their labels and footnote definitions are omitted.

The `action` field appears in a **From belief to action** section after the
essay, alongside an invitation to get in touch. Make it specific: a question
to investigate, an assumption to test, a change in practice, or something to
build. Published essays require this field.

To publish, change `draft` to `false`, choose the actual publication date,
preview with `npm run dev`, and commit/push to `main`. Dates order the list;
they do not schedule publication. Files beginning with `_` and essays with
`draft: true` are never included in the deployed artifact. The template and
this guide are also excluded. With no published essays, the homepage shows
an empty state rather than sample posts.

Generated pages go into `dist/`, which is ignored by Git. Rebuild with
`npm run build` after editing; do not edit generated HTML. Setting an essay
back to `draft: true` removes its generated page on the next deployment.
