import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { shapeGeometry } from '../src/style'
import { Trails } from '../src/trails'

test('every shape makes a sensible, smooth-normaled mesh of about unit size', () => {
  for (const shape of ['cone', 'sphere', 'cube', 'rounded', 'capsule', 'octahedron', 'tetrahedron', 'disc', 'cylinder', undefined]) {
    const g = shapeGeometry(shape, 'cone')
    assert.ok(g.attributes.position.count > 8, `${shape} has geometry`)
    assert.ok(g.attributes.normal, `${shape} has normals`)
    g.computeBoundingBox()
    const size = g.boundingBox!.getSize(new THREE.Vector3())
    assert.ok(Math.max(size.x, size.y, size.z) > 0.4 && Math.max(size.x, size.y, size.z) < 1.5, `${shape} is about unit size (${size.toArray().map((v) => v.toFixed(2))})`)
  }
  // lattice cells default to a sharp unit cube; asking for rounded softens it
  const sharp = shapeGeometry(undefined, 'cube'), soft = shapeGeometry('rounded', 'cube')
  assert.ok(soft.attributes.position.count > sharp.attributes.position.count)
  sharp.computeBoundingBox()
  assert.deepEqual(sharp.boundingBox!.getSize(new THREE.Vector3()).toArray(), [1, 1, 1])
})

test('elongated shapes lie along +z, the way agents are heading', () => {
  for (const shape of ['cone', 'capsule', 'cylinder']) {
    const g = shapeGeometry(shape, 'cone')
    g.computeBoundingBox()
    const s = g.boundingBox!.getSize(new THREE.Vector3())
    assert.ok(s.z > s.x && s.z > s.y, `${shape} is longest along z`)
  }
})

test('trails keep the last N positions per thing and fade toward the tail', () => {
  const scene = new THREE.Scene()
  const t = new Trails(scene)
  const rgb = [1, 0.5, 0.25, 0, 1, 0]
  for (let step = 0; step < 6; step++) t.push(2, [step, 0, 0, 0, step, 0], rgb, 4, 1)
  const lines = scene.children[0] as THREE.LineSegments
  // 2 things, a history of 4 points each: 3 segments per thing
  assert.equal(lines.geometry.drawRange.count, 2 * 3 * 2)
  const pos = lines.geometry.attributes.position.array as Float32Array
  assert.deepEqual([...pos.slice(0, 6)], [5, 0, 0, 4, 0, 0], 'the newest segment runs from the latest position to the one before')
  const col = lines.geometry.attributes.color.array as Float32Array
  assert.ok(col[0] > col[3] && col[3] > 0, 'brightness falls along the segment')
  assert.ok(col[6] < col[0], 'older segments are dimmer')
  t.dispose()
  assert.equal(scene.children.length, 0)
})
