import * as THREE from 'three'

/**
 * A material for flat pictures. Facing the camera: each instance is a flat square centered on its position, always turned to the viewer
 * (and, with `turn`, rotated on screen to point along its own direction, `instanceDir`). Lying on the ground: an ordinary instanced square, laid flat and turned to its heading by `ground`'s geometry (see `groundSquare`). The picture's see-through parts are cut out,
 * and an instance can still be faded with `instanceAlpha`. It is not lit: a picture is drawn as it is.
 */
export function spriteMaterial(facing: 'camera' | 'ground', turn: boolean): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: 0.4 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nattribute vec3 instanceDir;\nvarying float vInstanceAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;')
    // a picture lying on the ground is placed by its instance matrix like any shape; only a camera-facing one needs its own projection
    if (facing === 'camera') shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float spriteSize = length(instanceMatrix[0].xyz);
        vec2 spriteOffset = position.xy * spriteSize;
        ${turn ? `
        // on screen, "up" in the picture points along the agent's direction
        vec2 way = (viewMatrix * vec4(instanceDir, 0.0)).xy;
        float wayLength = length(way);
        way = wayLength > 1e-4 ? way / wayLength : vec2(0.0, 1.0);
        spriteOffset = vec2(spriteOffset.x * way.y + spriteOffset.y * way.x, -spriteOffset.x * way.x + spriteOffset.y * way.y);` : ''}
        vec4 mvPosition = vec4(centre.xy + spriteOffset, centre.z, 1.0);
        gl_Position = projectionMatrix * mvPosition;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;')
  }
  return m
}

/** Load a picture for a sprite set; `changed` runs once it has arrived. */
export function loadSprite(url: string, changed: () => void): THREE.Texture {
  const t = new THREE.TextureLoader().load(url, changed, undefined, () => console.warn(`could not load the picture ${url}`))
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** A unit square lying flat on the ground, its picture readable from above with the picture's up along +z (the way an agent moves), a little above the ground. */
export function groundSquare(lift: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(1, 1)
  g.rotateX(-Math.PI / 2)
  g.rotateY(Math.PI)
  g.translate(0, lift, 0)
  return g
}
