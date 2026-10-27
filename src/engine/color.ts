// Color math shared by the renderer (uniforms) and CPU analysis.

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

export const LUMA = [0.2126, 0.7152, 0.0722] as const

/** CIE xy chromaticity of a Planckian (blackbody) light source, 1667..25000 K. */
function planckXY(k: number): [number, number] {
  const t = Math.min(25000, Math.max(1667, k))
  let x: number
  if (t <= 4000) x = -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
  else x = -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039
  let y: number
  if (t <= 2222) y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
  else if (t <= 4000) y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
  else y = 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483
  return [x, y]
}

/** Linear sRGB of a light source at `k` Kelvin, normalized to Y = 1. */
function whiteRgb(k: number): [number, number, number] {
  const [x, y] = planckXY(k)
  const X = x / y
  const Z = (1 - x - y) / y
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z
  const g = -0.9689 * X + 1.8758 + 0.0415 * Z
  const b = 0.0557 * X - 0.204 + 1.057 * Z
  return [r, g, b]
}

const REF = whiteRgb(6500)

/**
 * Per-channel gains for the relative temperature/tint sliders (-100..100) used
 * for already-rendered photos (JPEG/PNG). Positive temp warms, positive tint
 * shifts toward magenta. Gains keep the luminance of gray constant.
 */
export function wbGains(temp: number, tint: number): [number, number, number] {
  // Slider -> mired shift of the light we "correct" for.
  const mired = 1e6 / 6500 - temp * 0.95
  const k = 1e6 / Math.max(30, mired)
  const w = whiteRgb(k)
  let r = REF[0] / w[0]
  let g = REF[1] / w[1]
  let b = REF[2] / w[2]
  g *= Math.pow(2, (-tint / 100) * 0.42)
  const lum = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
  r /= lum
  g /= lum
  b /= lum
  return [r, g, b]
}

/**
 * Finds temp/tint that make the given linear RGB neutral (gray).
 * Coarse-to-fine search over the slider ranges.
 */
export function neutralize(rgb: [number, number, number]): { temp: number; tint: number } {
  const cost = (t: number, n: number) => {
    const gn = wbGains(t, n)
    const r = rgb[0] * gn[0]
    const g = rgb[1] * gn[1]
    const b = rgb[2] * gn[2]
    const m = (r + g + b) / 3 || 1
    return ((r - m) ** 2 + (g - m) ** 2 + (b - m) ** 2) / (m * m)
  }
  let best = { temp: 0, tint: 0 }
  let bestC = Infinity
  let span = 100
  let cx = 0
  let cy = 0
  for (let iter = 0; iter < 5; iter++) {
    const stepCount = 10
    for (let i = -stepCount; i <= stepCount; i++) {
      for (let j = -stepCount; j <= stepCount; j++) {
        const t = Math.max(-100, Math.min(100, cx + (i / stepCount) * span))
        const n = Math.max(-100, Math.min(100, cy + (j / stepCount) * span))
        const c = cost(t, n)
        if (c < bestC) {
          bestC = c
          best = { temp: t, tint: n }
        }
      }
    }
    cx = best.temp
    cy = best.tint
    span /= 4
  }
  return { temp: Math.round(best.temp), tint: Math.round(best.tint) }
}

export function linToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

export function oklabToLin(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}
