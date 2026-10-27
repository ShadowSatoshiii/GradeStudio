// Small per-photo color classifiers (e.g. lip against skin, sky against
// landscape), learned from sure samples of both sides.

/**
 * Two-class color classifier (Fisher discriminant) learned from samples.
 * Returns a score that is 0 at the mean of `a` and 1 at the mean of `b`, and
 * how well the classes separate (projected mean distance / spread).
 */
export function fisher(a: number[][], b: number[][]): { score: (v: number[]) => number; separation: number } | null {
  if (a.length < 6 || b.length < 6) return null
  const mean = (list: number[][]) => [0, 1, 2].map((k) => list.reduce((s, v) => s + v[k], 0) / list.length)
  const ma = mean(a)
  const mb = mean(b)
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const [list, m] of [
    [a, ma],
    [b, mb],
  ] as [number[][], number[]][])
    for (const v of list) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i * 3 + j] += (v[i] - m[i]) * (v[j] - m[j])
  const n = a.length + b.length
  for (let k = 0; k < 9; k++) S[k] /= n
  for (let k = 0; k < 3; k++) S[k * 4] += 0.002
  const inv = invert3(S)
  if (!inv) return null
  const dm = [mb[0] - ma[0], mb[1] - ma[1], mb[2] - ma[2]]
  const wv = [0, 1, 2].map((i) => inv[i * 3] * dm[0] + inv[i * 3 + 1] * dm[1] + inv[i * 3 + 2] * dm[2])
  const proj = (v: number[]) => wv[0] * v[0] + wv[1] * v[1] + wv[2] * v[2]
  const pa = proj(ma)
  const pb = proj(mb)
  if (Math.abs(pb - pa) < 1e-6) return null
  const score = (v: number[]) => (proj(v) - pa) / (pb - pa)
  let spread = 0
  for (const v of a) spread += score(v) ** 2
  for (const v of b) spread += (score(v) - 1) ** 2
  return { score, separation: 1 / Math.sqrt(spread / n + 1e-6) }
}

/** Color features for skin/lip/eye classification: brightness and two color directions. */
export function colorFeat(d: Uint8ClampedArray, i: number): number[] {
  const r = d[i]
  const g = d[i + 1]
  const b = d[i + 2]
  const l = 0.299 * r + 0.587 * g + 0.114 * b
  return [l / 255, (r - b) / (l + 20), (r - g) / (l + 20)]
}


function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det)
}
