# Essays: from belief to action

Write here in Markdown. GitHub Actions builds the essays into static pages,
adds them to the homepage, and deploys them with the site.

Copy `_template.md` to a lowercase, hyphen-separated filename, for example
`alignment-and-agency.md`. The filename sets the URL: `/essays/alignment-and-agency/`.
Keep it stable after publication so existing links continue to work.

Fill in the front matter:

```yaml
---
title: "Your essay title"
description: "A short introduction used on the homepage and in link previews."
date: "2026-09-23"
author: "Nicolás Vergara"
draft: true
action: "One concrete next step the reader can take."
---
```

Write the body below the closing `---`. The title appears automatically, so
start with a paragraph and use `##` for sections. Markdown supports links,
lists, emphasis, blockquotes, code blocks, and tables. Place images in
`site/assets/essays/` and reference them from the published page with, for
example, `![A meaningful description](../../assets/essays/diagram.png)`.

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
