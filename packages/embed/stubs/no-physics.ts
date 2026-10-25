// Stands in for the physics engine in the small build, so scenes with creatures say what to do instead of failing obscurely.
export function loadRapier(): never {
  throw new Error('this build of breve has no physics engine: use dist/breve-physics.js for scenes with creatures')
}
