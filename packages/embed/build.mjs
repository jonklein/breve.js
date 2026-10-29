// Builds the two embeddable files into dist/:
//   breve.js          small: everything except the physics engine
//   breve-physics.js  with physics, for scenes that have creatures (about 4 MB larger before compression)
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const stub = fileURLToPath(new URL('./stubs/no-physics.ts', import.meta.url))
const noPhysics = {
  name: 'no-physics',
  setup(b) {
    b.onResolve({ filter: /(physics\/rapier|^\.\/rapier)$/ }, () => ({ path: stub }))
  },
}
const common = { entryPoints: ['src/index.ts'], bundle: true, format: 'iife', globalName: 'breve', minify: true, target: 'es2022', logLevel: 'warning' }
await build({ ...common, plugins: [noPhysics], outfile: 'dist/breve.js' })
await build({ ...common, outfile: 'dist/breve-physics.js' })
console.log('built dist/breve.js and dist/breve-physics.js')
