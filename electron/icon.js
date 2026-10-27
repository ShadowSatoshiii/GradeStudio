// Renders public/icon.svg into a Windows icon (release/icon.ico).
// Run with Electron: npx electron electron/icon.js
import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SIZES = [256, 64, 48, 40, 32, 24, 20, 16]
const root = path.join(import.meta.dirname, '..')

app.whenReady().then(async () => {
  const svg = await readFile(path.join(root, 'public', 'icon.svg'))
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  // The SVG is rasterized at each size (sharp small icons, not a scaled-down 256 px image).
  const pngs = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,${svg.toString('base64')}'
    await img.decode()
    return ${JSON.stringify(SIZES)}.map((s) => {
      const c = document.createElement('canvas')
      c.width = c.height = s
      c.getContext('2d').drawImage(img, 0, 0, s, s)
      return c.toDataURL('image/png').slice(22)
    })
  })()`)
  const images = pngs.map((b) => Buffer.from(b, 'base64'))

  // ICO: 6-byte header, one 16-byte entry per image, then the PNG data.
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach((png, i) => {
    const e = 6 + 16 * i
    const s = SIZES[i] >= 256 ? 0 : SIZES[i]
    head.writeUInt8(s, e)
    head.writeUInt8(s, e + 1)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(png.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  await mkdir(path.join(root, 'release'), { recursive: true })
  await writeFile(path.join(root, 'release', 'icon.ico'), Buffer.concat([head, ...images]))
  app.quit()
})
