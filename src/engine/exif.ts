// Small EXIF reader for JPEG files (camera, lens, exposure, capture date, GPS).

export interface Exif {
  make?: string
  model?: string
  lens?: string
  date?: string
  exposureTime?: number
  fNumber?: number
  iso?: number
  focalLength?: number
  flash?: boolean
  lat?: number
  lon?: number
  software?: string
}

const TAGS: Record<number, keyof Exif | 'exifPtr' | 'gpsPtr'> = {
  0x010f: 'make',
  0x0110: 'model',
  0x0131: 'software',
  0x8769: 'exifPtr',
  0x8825: 'gpsPtr',
  0x829a: 'exposureTime',
  0x829d: 'fNumber',
  0x8827: 'iso',
  0x9003: 'date',
  0x9209: 'flash',
  0x920a: 'focalLength',
  0xa434: 'lens',
}

export function readExif(buf: ArrayBuffer): Exif | undefined {
  const v = new DataView(buf)
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return undefined
  let off = 2
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off)
    const len = v.getUint16(off + 2)
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10)
    if ((marker & 0xff00) !== 0xff00) break
    off += 2 + len
  }
  return undefined
}

function parseTiff(v: DataView, base: number): Exif | undefined {
  try {
    const le = v.getUint16(base) === 0x4949
    const u16 = (o: number) => v.getUint16(base + o, le)
    const u32 = (o: number) => v.getUint32(base + o, le)
    const out: Exif = {}
    let latRef = ''
    let lonRef = ''
    const str = (o: number, n: number) => {
      let s = ''
      for (let i = 0; i < n; i++) {
        const c = v.getUint8(base + o + i)
        if (c === 0) break
        s += String.fromCharCode(c)
      }
      return s.trim()
    }
    const value = (entry: number): number | string | number[] | undefined => {
      const type = u16(entry + 2)
      const count = u32(entry + 4)
      const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 1
      const dataOff = size * count > 4 ? u32(entry + 8) : entry + 8
      if (type === 2) return str(dataOff, count)
      const one = (o: number) => {
        if (type === 3) return u16(o)
        if (type === 4) return u32(o)
        if (type === 9) return v.getInt32(base + o, le)
        if (type === 5) return u32(o) / (u32(o + 4) || 1)
        if (type === 10) return v.getInt32(base + o, le) / (v.getInt32(base + o + 4, le) || 1)
        return v.getUint8(base + o)
      }
      if (count === 1) return one(dataOff)
      return Array.from({ length: Math.min(count, 8) }, (_, i) => one(dataOff + i * size))
    }
    const ifd = (o: number, gps = false) => {
      const n = u16(o)
      for (let i = 0; i < n; i++) {
        const e = o + 2 + i * 12
        const tag = u16(e)
        if (gps) {
          const val = value(e)
          if ((tag === 2 || tag === 4) && Array.isArray(val)) {
            const [d, m, s] = val
            const deg = d + m / 60 + s / 3600
            if (tag === 2) out.lat = deg
            else out.lon = deg
          }
          if (tag === 1) latRef = val as string
          if (tag === 3) lonRef = val as string
          continue
        }
        const name = TAGS[tag]
        if (!name) continue
        const val = value(e)
        if (name === 'exifPtr') ifd(val as number)
        else if (name === 'gpsPtr') ifd(val as number, true)
        else if (name === 'flash') out.flash = ((val as number) & 1) === 1
        else (out as Record<string, unknown>)[name] = val
      }
    }
    ifd(u32(4))
    if (out.lat !== undefined && latRef === 'S') out.lat = -out.lat
    if (out.lon !== undefined && lonRef === 'W') out.lon = -out.lon
    return out
  } catch {
    return undefined
  }
}

/** "2024:05:01 13:22:10" → epoch ms. */
export function exifDate(s?: string): number | undefined {
  if (!s) return undefined
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (!m) return undefined
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  return Number.isFinite(t) ? t : undefined
}

export function formatShutter(t?: number): string {
  if (!t) return '–'
  if (t >= 1) return `${t.toFixed(t >= 10 ? 0 : 1)} s`
  return `1/${Math.round(1 / t)} s`
}
