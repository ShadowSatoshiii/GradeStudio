import { useState } from 'react'
import * as A from '../actions'
import { DEFAULT_EXPORT, download, fileName, outputSize, renderPhoto, zip, type ExportOptions } from '../engine/export'
import { flushSave } from '../store/editor'
import { lib } from '../store/library'
import { targets, toast, ui } from '../store/ui'

const EXPORT_KEY = 'gradestudio.export'

function loadExportOpts(): ExportOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPORT_KEY) ?? '{}')
    return { ...DEFAULT_EXPORT, ...saved, watermark: { ...DEFAULT_EXPORT.watermark, ...(saved.watermark ?? {}) }, sharpen: { ...DEFAULT_EXPORT.sharpen, ...(saved.sharpen ?? {}) } }
  } catch {
    return DEFAULT_EXPORT
  }
}

const close = () => ui.set({ dialog: null })

function Modal({ title, children, width }: { title: string; children: React.ReactNode; width?: number }) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="dialog" style={width ? { width } : undefined} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function ExportDialog() {
  const [o, setO] = useState<ExportOptions>(loadExportOpts)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const ids = targets()
  const photos = ids.map((id) => lib.get().photos[id]).filter(Boolean)
  const set = (patch: Partial<ExportOptions>) => setO((x) => ({ ...x, ...patch }))
  const first = photos[0]
  const dims = first ? outputSize(first, o) : [0, 0]

  const run = async () => {
    flushSave()
    localStorage.setItem(EXPORT_KEY, JSON.stringify(o))
    setBusy({ done: 0, total: photos.length })
    try {
      // Wait a moment for the latest edit to be stored.
      await new Promise((r) => setTimeout(r, 120))
      const fresh = ids.map((id) => lib.get().photos[id]).filter(Boolean)
      const files: { name: string; blob: Blob }[] = []
      for (let i = 0; i < fresh.length; i++) {
        files.push({ name: fileName(fresh[i], o, i), blob: await renderPhoto(fresh[i], o) })
        setBusy({ done: i + 1, total: fresh.length })
      }
      if (files.length === 1) download(files[0].blob, files[0].name)
      else download(await zip(files), `GradeStudio-Export-${new Date().toISOString().slice(0, 10)}.zip`)
      toast(`${files.length} ${files.length === 1 ? 'photo' : 'photos'} exported`)
      close()
    } catch (e) {
      toast('Export failed: ' + (e as Error).message)
      setBusy(null)
    }
  }

  return (
    <Modal title={`Export ${photos.length} ${photos.length === 1 ? 'Photo' : 'Photos'}`}>
      <div className="row">
        <label>File type</label>
        <select className="select" value={o.format} onChange={(e) => set({ format: e.target.value as ExportOptions['format'] })}>
          <option value="jpeg">JPG</option>
          <option value="png">PNG</option>
          <option value="webp">WebP</option>
        </select>
      </div>
      {o.format !== 'png' && (
        <div className="row">
          <label>Quality</label>
          <input className="range" style={{ flex: 1 }} type="range" min={10} max={100} value={o.quality} onChange={(e) => set({ quality: +e.target.value })} />
          <span style={{ width: 36, textAlign: 'right' }}>{o.quality}</span>
        </div>
      )}
      <div className="row">
        <label>Image size</label>
        <select className="select" value={o.size} onChange={(e) => set({ size: e.target.value as ExportOptions['size'] })}>
          <option value="full">Full size</option>
          <option value="long">Long edge</option>
          <option value="short">Short edge</option>
        </select>
      </div>
      {o.size !== 'full' && (
        <div className="row">
          <label>Pixels</label>
          <input type="number" min={64} max={16000} value={o.pixels} onChange={(e) => set({ pixels: Math.max(64, +e.target.value || 2048) })} />
        </div>
      )}
      <div className="row">
        <label>File name</label>
        <select className="select" value={o.naming} onChange={(e) => set({ naming: e.target.value as ExportOptions['naming'] })}>
          <option value="original">Original name</option>
          <option value="suffix">Original name + "-edited"</option>
          <option value="sequence">Custom name + number</option>
        </select>
      </div>
      {o.naming === 'sequence' && (
        <div className="row">
          <label>Name</label>
          <input type="text" value={o.baseName} onChange={(e) => set({ baseName: e.target.value })} />
        </div>
      )}
      <div className="row">
        <label>Output sharpening</label>
        <select className="select" value={o.sharpen.media} onChange={(e) => set({ sharpen: { ...o.sharpen, media: e.target.value as ExportOptions['sharpen']['media'] } })}>
          <option value="none">None</option>
          <option value="screen">Screen</option>
          <option value="matte">Matte paper</option>
          <option value="glossy">Glossy paper</option>
        </select>
        {o.sharpen.media !== 'none' && (
          <select className="select" value={o.sharpen.level} onChange={(e) => set({ sharpen: { ...o.sharpen, level: e.target.value as ExportOptions['sharpen']['level'] } })}>
            <option value="low">Low</option>
            <option value="standard">Standard</option>
            <option value="high">High</option>
          </select>
        )}
      </div>
      <div className="row">
        <label>Watermark</label>
        <input type="checkbox" checked={o.watermark.enabled} onChange={(e) => set({ watermark: { ...o.watermark, enabled: e.target.checked } })} />
        {o.watermark.enabled && (
          <input type="text" value={o.watermark.text} placeholder="© Your Name" onChange={(e) => set({ watermark: { ...o.watermark, text: e.target.value } })} />
        )}
      </div>
      {o.watermark.enabled && (
        <>
          <div className="row">
            <label>Position</label>
            <select className="select" value={o.watermark.position} onChange={(e) => set({ watermark: { ...o.watermark, position: e.target.value as ExportOptions['watermark']['position'] } })}>
              <option value="br">Bottom right</option>
              <option value="bl">Bottom left</option>
              <option value="tr">Top right</option>
              <option value="tl">Top left</option>
              <option value="c">Center</option>
            </select>
            <select className="select" value={o.watermark.dark ? 'dark' : 'light'} onChange={(e) => set({ watermark: { ...o.watermark, dark: e.target.value === 'dark' } })}>
              <option value="light">White</option>
              <option value="dark">Black</option>
            </select>
          </div>
          <div className="row">
            <label>Size · Opacity</label>
            <input className="range" style={{ flex: 1 }} type="range" min={1} max={15} value={o.watermark.size} onChange={(e) => set({ watermark: { ...o.watermark, size: +e.target.value } })} />
            <input className="range" style={{ flex: 1 }} type="range" min={10} max={100} value={o.watermark.opacity} onChange={(e) => set({ watermark: { ...o.watermark, opacity: +e.target.value } })} />
          </div>
        </>
      )}
      {first && (
        <p style={{ margin: '4px 0 0', fontSize: 11.5 }}>
          {photos.length === 1 ? `${fileName(first, o, 0)} · ${dims[0]} × ${dims[1]} px` : `${photos.length} files as ZIP · first photo ${dims[0]} × ${dims[1]} px`}
        </p>
      )}
      {busy && (
        <div className="progress" style={{ position: 'static', width: '100%', marginTop: 12 }}>
          Exporting {busy.done} of {busy.total} …
          <div className="bar">
            <div style={{ width: `${(busy.done / busy.total) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="actions">
        <button className="btn quiet" onClick={close} disabled={!!busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={run} disabled={!!busy || !photos.length}>
          Export
        </button>
      </div>
    </Modal>
  )
}

export function CopySettingsDialog() {
  const [sel, setSel] = useState<A.SettingGroup[]>(A.SETTING_GROUPS.filter((g) => g.id !== 'crop').map((g) => g.id))
  return (
    <Modal title="Copy Edit Settings" width={380}>
      {A.SETTING_GROUPS.map((g) => (
        <label key={g.id} className="row" style={{ marginBottom: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={sel.includes(g.id)} onChange={(e) => setSel(e.target.checked ? [...sel, g.id] : sel.filter((x) => x !== g.id))} />
          <span>{g.label}</span>
        </label>
      ))}
      <div className="actions">
        <button className="btn quiet" onClick={() => setSel(sel.length ? [] : A.SETTING_GROUPS.map((g) => g.id))}>
          {sel.length ? 'None' : 'All'}
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn quiet" onClick={close}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!sel.length}
          onClick={() => {
            A.copySettings(sel)
            close()
          }}
        >
          Copy
        </button>
      </div>
    </Modal>
  )
}

export function DeleteForeverDialog() {
  const n = targets().length
  return (
    <Modal title="Delete Permanently?" width={380}>
      <p>
        {n} {n === 1 ? 'photo' : 'photos'} and all of their edits will be removed from GradeStudio. This cannot be undone.
      </p>
      <div className="actions">
        <button className="btn quiet" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" style={{ background: 'var(--c-danger)' }} onClick={() => A.deleteSelectedForever()}>
          Delete Permanently
        </button>
      </div>
    </Modal>
  )
}

const SHORTCUTS: [string, string][] = [
  ['G / Shift+G', 'Photo grid / square grid'],
  ['D', 'Detail view'],
  ['Alt+C', 'Compare before/after'],
  ['E / C / M / H', 'Edit / crop / masking / remove'],
  ['\\', 'Show original (hold)'],
  ['J', 'Show clipping'],
  ['W', 'White balance picker'],
  ['Shift+A', 'Auto settings'],
  ['V', 'Black & white'],
  ['Ctrl+R', 'Reset edits'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste edit settings'],
  ['0–5', 'Set star rating'],
  ['Z / X / U', 'Pick / reject / remove flag'],
  ['6–9', 'Color label red, yellow, green, blue'],
  ['Ctrl+[ / Ctrl+]', 'Rotate left / right'],
  ['← → ↑ ↓', 'Previous / next photo'],
  ['Ctrl+A / Ctrl+D', 'Select all / select none'],
  ['Del', 'Move to Deleted'],
  ['Ctrl+Shift+E', 'Export'],
  ['I / K / P / Shift+V', 'Info / keywords / presets / versions'],
  ['Double-click a slider', 'Reset the slider'],
  ['Ctrl+/', 'This list'],
]

export function ShortcutsDialog() {
  return (
    <Modal title="Keyboard Shortcuts" width={520}>
      <div className="kv" style={{ gridTemplateColumns: '170px 1fr', padding: 0 }}>
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span className="k" style={{ color: 'var(--c-text)' }}>
              {k}
            </span>
            <span className="v" style={{ color: 'var(--c-text-2)' }}>
              {v}
            </span>
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  )
}

export function AboutDialog() {
  return (
    <Modal title="About GradeStudio" width={420}>
      <p>
        GradeStudio is a non-destructive photo editor and library. Photos and edits stay on this device (IndexedDB) and are never uploaded. The original file is never
        changed; only the edit settings are stored.
      </p>
      <p style={{ color: 'var(--c-text-3)' }}>
        Free software under the GPL-3.0 license. Rendering runs on the GPU via WebGL2.{' '}
        <a href="https://github.com/canyando4699-pixel/GradeStudio" target="_blank" rel="noreferrer">
          Source code on GitHub
        </a>
      </p>
      <div className="actions">
        <button className="btn primary" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  )
}
