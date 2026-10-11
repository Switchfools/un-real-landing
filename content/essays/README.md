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

ChatGPT can call `get_visual_guide`, reuse images with `list_images`, and upload
actual raster-image bytes with `stage_image` (up to 2 MB). It must put the returned
Markdown in a proposal for your review. Image staging itself changes no manuscript.

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
