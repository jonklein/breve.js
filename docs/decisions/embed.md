# Embedding a simulation in another page

**Context.** A simulation should be droppable into any web page (a project page, a blog post) with the picture only: no editors, sliders or buttons.

**Decision.**
- `packages/embed` exposes `breve.run(target, scriptSource, sceneConfig, options?)`. It runs the simulation on the page's main thread (no worker, so no extra files to host), draws it with the same code the workbench uses, and pauses while scrolled out of view.
- The drawing code lives in `packages/view` (`WorldView` and its layers), shared by the workbench and the embed.
- The embed is built with **esbuild** into one file, `dist/breve.js` (small: about 800 KB, 220 KB gzipped; no physics) and `dist/breve-physics.js` (adds the physics engine, for creatures). esbuild is used only for this build; the workbench still uses Vite and core packages are still plain TypeScript.
- Distribution for now is copying the built file into the host site (`kleininen/priv/static/js/breve/`). It is not published to npm.

**Consequences.** Rebuild with `npm run build -w @breve/embed` and copy `dist/breve.js` when the engine changes. The workbench also has `?embed` (for example `/?embed#boids`) to show only the running simulation in an iframe.
