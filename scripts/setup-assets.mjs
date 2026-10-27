// Puts the on-device AI files where the app expects them:
// - public/mediapipe: the MediaPipe vision runtime, copied from node_modules
// - public/models:    the selfie segmentation model, downloaded once from Google
// Runs automatically after `npm install`; run again with `npm run setup`.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const RUNTIME = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']
const MODEL = {
  file: 'selfie_multiclass_256x256.tflite',
  url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
  sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0',
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function copyRuntime() {
  const from = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
  const to = path.join(root, 'public', 'mediapipe')
  await mkdir(to, { recursive: true })
  for (const f of RUNTIME) await copyFile(path.join(from, f), path.join(to, f))
  console.log('MediaPipe runtime copied to public/mediapipe')
}

async function fetchModel() {
  const dir = path.join(root, 'public', 'models')
  const file = path.join(dir, MODEL.file)
  const existing = await readFile(file).catch(() => null)
  if (existing && sha256(existing) === MODEL.sha256) return console.log(`Model ${MODEL.file} is up to date`)

  console.log(`Downloading ${MODEL.file} (16 MB) …`)
  const res = await fetch(MODEL.url)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const data = Buffer.from(await res.arrayBuffer())
  if (sha256(data) !== MODEL.sha256) throw new Error('Downloaded model does not match the expected checksum')
  await mkdir(dir, { recursive: true })
  await writeFile(file, data)
  console.log(`Model saved to public/models/${MODEL.file}`)
}

try {
  await copyRuntime()
  await fetchModel()
} catch (e) {
  // Never break `npm install`: the editor works without these files, only the
  // automatic masks (subject, sky, background, people) need them.
  console.warn(`\nCould not set up the AI files: ${e.message}`)
  console.warn('Automatic masks stay unavailable until `npm run setup` succeeds.\n')
}
