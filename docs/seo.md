# Discovery and sharing

The public website is **https://un-real.ai/**. The writing workspace at
`https://studio.un-real.ai` is private and sends `noindex, nofollow`; its essays
become discoverable only after an explicitly approved publication reaches Pages.

## What each deployment produces

- Consistent HTTPS canonical, Open Graph and Twitter metadata, using `un-real.ai`.
- Organization and WebSite structured data for the mission; BlogPosting and
  breadcrumbs for each published essay, using its actual author and publication date.
- An essay index at `/essays/`, with ordinary HTML links and the same mission.
- `/sitemap.xml`, `/robots.txt`, and an excerpt RSS feed at `/feed.xml`.
- A 1200×630 PNG sharing card with each essay's title, author and brand. Its URL
  changes with the image bytes so updated cards have a fresh URL.
- Copy-link/native sharing, a LinkedIn share link, further reading and a link
  back to the mission. These never post automatically and load no tracking scripts.
- A helpful `404.html` excluded from indexing.

Only published Markdown is included. Templates, drafts, comments, revisions,
unused private media and Studio content stay out of the pages, index, feed and
sitemap. Unpublishing removes the generated article and its discovery entries.
We omit `lastmod` and `dateModified` rather than inventing editorial update dates
from build times. Static HTML keeps the mission and full essays readable without
JavaScript. Shared preview cards use Sharp and the existing licensed Inter fonts
only during the build; visitors download no image-rendering dependency.

`scripts/seo.mjs` owns the production base URL and metadata. A build can override
`siteUrl` for another HTTPS host/subpath; internal navigation and assets remain
relative. GitHub Pages should keep its `un-real.ai` custom domain and **Enforce
HTTPS** enabled. The GitHub repository address redirects to that canonical host.

## Google Search Console

1. Open [Search Console](https://search.google.com/search-console/), add a
   **Domain** property for `un-real.ai`, and choose DNS TXT verification.
2. Copy the exact Google-provided verification value. In GoDaddy's DNS settings,
   add a TXT record with Name `@` and that value. Keep the existing TXT records.
   No verification token is generated or guessed by this repository.
3. Return to Google and verify ownership. Submit `https://un-real.ai/sitemap.xml`
   under **Sitemaps**.
4. Use **URL Inspection** on the homepage and the first published essay. Check
   Google's selected canonical and request indexing after significant changes.
5. Review indexing reports and search queries over time. Use actual impressions
   and clicks to improve titles and descriptions; don't infer rankings from a
   successful deployment.

Google's [canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls),
[Article structured data guidance](https://developers.google.com/search/docs/appearance/structured-data/article)
and [sitemap documentation](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
describe these signals. Neither a sitemap nor structured data guarantees indexing,
a rich result, ranking, or virality.

## Write for the mission and the reader

Focus on the questions behind the mission: how AI systems can respect human
agency, what beneficial coexistence means in practice, and how human–AI symbiosis
can expand capabilities. Make each essay answer a specific question with a clear
position, examples, uncertainty and sources the reader can inspect. Describe
Karteria as work in development rather than claiming unverified results.

Use a descriptive title and a short, distinct `description` that explains why
the essay matters. Start the `summary` with the actual argument. Keep author names
consistent, supply meaningful image alt text, and link to relevant published
essays naturally. Keep the slug stable after publication. Every `action` should
tell the reader one thing they can test, build, discuss or change.

After publishing, check the live article and card. Share a useful excerpt and
its canonical link with a relevant audience, invite disagreement, and ask what
people tried as a result. Search discovery and human distribution complement
each other; adding keywords alone is not a publication strategy.
