# Site structure: home, workbench, gallery

**Context.** The workbench was the whole app, served at `/`. The project needs a front door, and examples need a place to be browsed.

**Options.** (a) One page with client-side routing. (b) One HTML file per page, built by Vite as a multi-page app.

**Decision.** (b). Pages are `/` (home), `/sim/` (the workbench), `/gallery/` and `/about/`; Docs is the workbench's Docs tab, reached as `/sim/?tab=docs`. Each page calls `mountNav` (`src/site-nav.ts`), so the navigation is one piece of code. `vite.config.ts` lists the pages as static `rollupOptions.input` (no logic, no plugins).
- The home page loads nothing heavy up front: each demo imports `@breve/embed`, fetches its scene and script, and starts only when its card nears the screen (the embed already pauses off screen).
- Old links to the workbench (`/?embed#boids`) are redirected by the home page's script to `/sim/` with the same query and hash.
- Gallery pictures are `examples/<id>/thumb.jpg`, made by `scripts/thumbs.mjs` from the running workbench (Playwright is used by the script but is not a dependency). A missing picture shows a plain tile.
- Sharing: `/sim/#s=<code>`, where the code is the project's JSON, deflated (`CompressionStream`) and base64url-encoded (`src/share.ts`). Opening one saves it as one of your own projects. The gallery's Fork opens `/sim/?fork=<id>`.

- A project opened from a share link is **held**: the workers get a do-nothing script and the page shows a banner (read the script, then Run, or delete the project). Scripts are programs and run in the page's origin, where they can call the local assistant API (which holds the API key) and anything else the origin can reach, so running a stranger's script without a look is the real risk of sharing. Approval is trust, not a sandbox: once approved, the script has full power. Forks of a held project are held too. A QuickJS sandbox (milestones, "Later") would be the real fix.

**Consequences.** Hosting must serve `/sim/`, `/gallery/` and `/about/` as directories (any static host does). Examples gain `tags` in `examples/index.json`. Long scripts make long share links; a hosted store can replace the code later without changing the page.

## Editor drawer and tree-first JSON (2026-10-26)

The workbench's editor (scene, script, experiment, assistant, docs) is a drawer that slides over the left edge instead of a permanent half of the page, so the simulation has the stage. It opens from the header button, the edge tab or the E key, closes with Esc or the close button, and the choice is remembered. It overlays rather than pushes, so the canvases never resize. A red dot on the button and tab says there is a problem to look at while the drawer is closed. JSON files open as the tree of fields by default (the text view is one click away, and the last choice is remembered); `?embed` hides all of this as before.

## Front page and Explore (2026-10-26)

`/` is now a marketing-style front page: a real simulation (boids, through the same `@breve/embed` the old home page used) fills the window behind a headline, two buttons and four one-line points. The page that used to be the home page (hero, three live demos, what you can do) is now `/explore/`, one click in, and the site navigation has an Explore link. The background is a decoration: it does not take mouse input, it pauses on request (and starts paused when the system asks for reduced motion), and if it cannot start the page reads fine without it. The words are plain statements of what is already true of the project; the headline and tagline are public positioning, so they are the owner's to rewrite.
