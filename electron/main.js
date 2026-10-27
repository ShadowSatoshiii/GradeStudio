// Desktop shell for GradeStudio. Serves the built app (dist/) from its own
// app:// origin, so the photo library (IndexedDB) always lives in one place:
// the Electron user data folder (%APPDATA%\GradeStudio on Windows).
import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const DIST = path.join(import.meta.dirname, '..', 'dist')
const ORIGIN = 'app://gradestudio'
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
])

// One window only: a second start brings the open one to the front.
if (!app.requestSingleInstanceLock()) app.quit()

let win = null

async function serve(request) {
  const { pathname } = new URL(request.url)
  const file = path.join(DIST, decodeURIComponent(pathname === '/' ? '/index.html' : pathname))
  if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 })
  try {
    const body = await readFile(file)
    return new Response(body, { headers: { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'GradeStudio',
    backgroundColor: '#141414',
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, spellcheck: false },
  })
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  // Links open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) e.preventDefault()
  })
  // Exports ask where to save, starting in the pictures folder.
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'Export', defaultPath: path.join(app.getPath('pictures'), item.getFilename()) })
  })
  win.on('closed', () => (win = null))
  win.loadURL(ORIGIN + '/')
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  // GradeStudio has its own menu bar inside the window.
  Menu.setApplicationMenu(null)
  protocol.handle('app', serve)
  createWindow()
})

app.on('window-all-closed', () => app.quit())
