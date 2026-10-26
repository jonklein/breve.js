# Site structure: home, workbench, gallery

**Context.** The workbench was the whole app, served at `/`. The project needs a front door, and examples need a place to be browsed.

**Options.** (a) One page with client-side routing. (b) One HTML file per page, built by Vite as a multi-page app.

**Decision.** (b). Pages are `/` (home), `/sim/` (the workbench), `/gallery/` and `/about/`; Docs is the workbench's Docs tab, reached as `/sim/?tab=docs`. Each page calls `mountNav` (`src/site-nav.ts`), so the navigation is one piece of code. `vite.config.ts` lists the pages as static `rollupOptions.input` (no logic, no plugins).
- The home page loads nothing heavy up front: each demo imports `@breve/embed`, fetches its scene and script, and starts only when its card nears the screen (the embed already pauses off screen).
- Old links to the workbench (`/?embed#boids`) are redirected by the home page's script to `/sim/` with the same query and hash.
- Gallery pictures are `examples/<id>/thumb.jpg`, made by `scripts/thumbs.mjs` from the running workbench (Playwright is used by the script but is not a dependency). A missing picture shows a plain tile.
- Sharing: `/sim/#s=<code>`, where the code is the project's JSON, deflated (`CompressionStream`) and base64url-encoded (`src/share.ts`). Opening one saves it as one of your own projects. The gallery's Fork opens `/sim/?fork=<id>`.

**Consequences.** Hosting must serve `/sim/`, `/gallery/` and `/about/` as directories (any static host does). Examples gain `tags` in `examples/index.json`. Long scripts make long share links; a hosted store can replace the code later without changing the page.
