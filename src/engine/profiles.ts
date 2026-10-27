// Own color profiles ("looks"), baked into a 33³ 3D LUT. The neutral profile is the identity.
export const LUT_N = 33

type Fn = (r: number, g: number, b: number) => [number, number, number]

export interface Profile {
  id: string
  name: string
  group: 'Standard' | 'Creative' | 'B&W'
  bw?: boolean
  fn?: Fn
  /** Preview swatch gradient for the profile browser. */
  swatch: string
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const sCurve = (x: number, k: number) => {
  // Smooth contrast around 0.5, k > 0 adds contrast.
  const y = x < 0.5 ? 0.5 * Math.pow(2 * x, 1 + k) : 1 - 0.5 * Math.pow(2 * (1 - x), 1 + k)
  return clamp(y)
}
const sat = (r: number, g: number, b: number, k: number): [number, number, number] => {
  const l = lum(r, g, b)
  return [clamp(l + (r - l) * k), clamp(l + (g - l) * k), clamp(l + (b - l) * k)]
}
const lift = (x: number, black: number, white: number) => black + x * (white - black)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

export const PROFILES: Profile[] = [
  { id: 'color', name: 'Color', group: 'Standard', swatch: 'linear-gradient(135deg,#d9774a,#4b8bd6)' },
  {
    id: 'vivid',
    name: 'Vivid',
    group: 'Standard',
    swatch: 'linear-gradient(135deg,#ff6a3d,#2f7bff)',
    fn: (r, g, b) => sat(sCurve(r, 0.12), sCurve(g, 0.12), sCurve(b, 0.12), 1.22),
  },
  {
    id: 'landscape',
    name: 'Landscape',
    group: 'Standard',
    swatch: 'linear-gradient(135deg,#3f9e4d,#3f7fd0)',
    fn: (r, g, b) => {
      const [r1, g1, b1] = sat(r, g, b, 1.12)
      // richer greens and blues, slightly deeper skies
      const greenish = clamp((g1 - Math.max(r1, b1)) * 3)
      const blueish = clamp((b1 - Math.max(r1, g1)) * 3)
      return [clamp(r1 - greenish * 0.03), clamp(g1 + greenish * 0.02 - blueish * 0.02), clamp(b1 + blueish * 0.03)].map((x) => sCurve(x, 0.06)) as [number, number, number]
    },
  },
  {
    id: 'portrait',
    name: 'Portrait',
    group: 'Standard',
    swatch: 'linear-gradient(135deg,#e7a98a,#9c6b55)',
    fn: (r, g, b) => {
      const [r1, g1, b1] = sat(r, g, b, 0.94)
      return [clamp(sCurve(r1, -0.06) + 0.008), sCurve(g1, -0.06), clamp(sCurve(b1, -0.06) - 0.006)]
    },
  },
  {
    id: 'neutral',
    name: 'Neutral',
    group: 'Standard',
    swatch: 'linear-gradient(135deg,#9a8f86,#6f7a86)',
    fn: (r, g, b) => sat(sCurve(r, -0.14), sCurve(g, -0.14), sCurve(b, -0.14), 0.9),
  },
  { id: 'mono', name: 'Monochrome', group: 'B&W', bw: true, swatch: 'linear-gradient(135deg,#eee,#222)' },
  {
    id: 'noir',
    name: 'Noir',
    group: 'B&W',
    bw: true,
    swatch: 'linear-gradient(135deg,#fff,#000 70%)',
    fn: (r, g, b) => {
      const y = sCurve(lum(r, g, b), 0.45)
      return [y, y, y]
    },
  },
  {
    id: 'selenium',
    name: 'Selenium',
    group: 'B&W',
    bw: true,
    swatch: 'linear-gradient(135deg,#efe9f2,#2b2230)',
    fn: (r, g, b) => {
      const y = sCurve(lum(r, g, b), 0.15)
      return [clamp(y + 0.02 * (1 - y)), y, clamp(y + 0.035 * (1 - y))]
    },
  },
  {
    id: 'film-warm',
    name: 'Warm Film',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#f0c27a,#5a3a2a)',
    fn: (r, g, b) => {
      const [r1, g1, b1] = sat(r, g, b, 0.92)
      return [lift(sCurve(r1, 0.08), 0.04, 1), lift(sCurve(g1, 0.08), 0.03, 0.97), lift(sCurve(b1, 0.1), 0.05, 0.9)]
    },
  },
  {
    id: 'film-cool',
    name: 'Cool Film',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#a8d0e0,#243848)',
    fn: (r, g, b) => {
      const [r1, g1, b1] = sat(r, g, b, 0.9)
      return [lift(sCurve(r1, 0.06), 0.02, 0.95), lift(sCurve(g1, 0.06), 0.04, 0.99), lift(sCurve(b1, 0.06), 0.07, 1)]
    },
  },
  {
    id: 'fade',
    name: 'Faded',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#d8d0c4,#7d7a76)',
    fn: (r, g, b) => {
      const [r1, g1, b1] = sat(r, g, b, 0.75)
      return [lift(r1, 0.1, 0.94), lift(g1, 0.1, 0.94), lift(b1, 0.11, 0.93)]
    },
  },
  {
    id: 'matte',
    name: 'Matte',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#c9c1b6,#3d3b39)',
    fn: (r, g, b) => [lift(sCurve(r, 0.1), 0.07, 0.97), lift(sCurve(g, 0.1), 0.07, 0.97), lift(sCurve(b, 0.1), 0.08, 0.96)],
  },
  {
    id: 'cinema',
    name: 'Cinema',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#f2a65a,#1f5a66)',
    fn: (r, g, b) => {
      // teal shadows, warm highlights
      const y = lum(r, g, b)
      const t = clamp(y * 1.4 - 0.2)
      const [r1, g1, b1] = [sCurve(r, 0.14), sCurve(g, 0.14), sCurve(b, 0.14)]
      return [clamp(r1 + mix(-0.04, 0.04, t)), clamp(g1 + mix(0.015, 0.01, t)), clamp(b1 + mix(0.05, -0.05, t))]
    },
  },
  {
    id: 'retro',
    name: 'Retro',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#e9c27c,#6e8a6a)',
    fn: (r, g, b) => {
      const [r1, g1, b1] = sat(r, g, b, 0.85)
      return [lift(sCurve(r1, 0.05), 0.06, 0.98), lift(sCurve(g1, 0.03), 0.06, 0.95), lift(b1 * 0.92, 0.09, 0.86)]
    },
  },
  {
    id: 'golden',
    name: 'Golden Hour',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#ffcf6b,#b0532a)',
    fn: (r, g, b) => {
      const [r1, g1, b1] = sat(r, g, b, 1.08)
      return [clamp(r1 * 1.04 + 0.02), clamp(g1 * 1.0 + 0.008), clamp(b1 * 0.88)]
    },
  },
  {
    id: 'pastel',
    name: 'Pastel',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#f6c9d8,#b9d8f0)',
    fn: (r, g, b) => {
      const [r1, g1, b1] = sat(r, g, b, 0.7)
      return [lift(sCurve(r1, -0.12), 0.12, 1), lift(sCurve(g1, -0.12), 0.12, 1), lift(sCurve(b1, -0.12), 0.14, 1)]
    },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    group: 'Creative',
    swatch: 'linear-gradient(135deg,#e8d2a6,#4a3320)',
    fn: (r, g, b) => {
      const y = sCurve(lum(r, g, b), 0.08)
      return [clamp(y * 1.07 + 0.03), clamp(y * 0.96 + 0.01), clamp(y * 0.78)]
    },
  },
]

export const profileById = (id: string) => PROFILES.find((p) => p.id === id) ?? PROFILES[0]

/** RGBA8 3D LUT data, r fastest, then g, then b. Null for the identity. */
export function buildProfileLut(id: string): Uint8Array | null {
  const prof = profileById(id)
  if (!prof.fn) return null
  const n = LUT_N
  const out = new Uint8Array(n * n * n * 4)
  let k = 0
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const [R, G, B] = prof.fn(r / (n - 1), g / (n - 1), b / (n - 1))
        out[k++] = Math.round(clamp(R) * 255)
        out[k++] = Math.round(clamp(G) * 255)
        out[k++] = Math.round(clamp(B) * 255)
        out[k++] = 255
      }
  return out
}
