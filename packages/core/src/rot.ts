/** Row-major 3x3 rotation matrix. Just enough rotation math for bodies and importers; Euler angles are XYZ (three.js order) in radians. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]
export type Euler = [number, number, number]

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}

export function transpose(a: Mat3): Mat3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
}

export function apply(m: Mat3, v: readonly number[]): [number, number, number] {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]
}

/** Rotation about each axis in turn: R = Rx * Ry * Rz (the order three.js calls 'XYZ'). */
export function fromEuler([x, y, z]: Euler): Mat3 {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z)
  return [c * e, -c * f, d, a * f + b * d * e, a * e - b * d * f, -b * c, b * f - a * d * e, b * e + a * d * f, a * c]
}

export function toEuler(m: Mat3): Euler {
  const y = Math.asin(Math.max(-1, Math.min(1, m[2])))
  if (Math.abs(m[2]) < 0.9999999) return [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])]
  return [Math.atan2(m[7], m[4]), y, 0]
}

/** URDF's fixed-axis roll, pitch, yaw: R = Rz(yaw) * Ry(pitch) * Rx(roll). */
export function fromRpy([r, p, y]: Euler): Mat3 {
  return mul(fromEuler([0, 0, y]), mul(fromEuler([0, p, 0]), fromEuler([r, 0, 0])))
}

/** Unit quaternion (x, y, z, w) for Euler XYZ angles. */
export function quatFromEuler([x, y, z]: Euler): [number, number, number, number] {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2)
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2)
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3]
}
