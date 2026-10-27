import { useEffect, useState } from 'react'
import * as A from './actions'
import { neutralize } from './engine/color'
import { apply, frameToSource, orientedSize } from './engine/transform'
import { editor, flushSave, patchParams, restorePending, saveBeforeUnload } from './store/editor'
import { importFiles, lib, loadLibrary } from './store/library'
import { step, toast, ui, type Panel } from './store/ui'
import { BottomBar } from './ui/BottomBar'
import { DetailView, type ViewInfo } from './ui/DetailView'
import { AboutDialog, CopySettingsDialog, DeleteForeverDialog, ExportDialog, ShortcutsDialog } from './ui/Dialogs'
import { EditPanel } from './ui/EditPanel'
import { Filmstrip } from './ui/Filmstrip'
import { gridRows, GridView } from './ui/GridView'
import { IconCrop, IconHeal, IconInfo, IconMask, IconPresets, IconRedEye, IconShare, IconSliders, IconTag, IconVersions } from './ui/Icons'
import { deleteSelectedSpot, RedEyePanel, RemovePanel, RetouchOverlay } from './ui/RetouchTool'
import { PointPicker } from './ui/ExtraTools'
import { Slideshow } from './ui/Slideshow'
import { maskKey, MaskOverlay, MaskPanel } from './ui/MaskTool'
import { maskUI } from './store/maskops'
import { InfoPanel, KeywordsPanel, PresetsPanel, VersionsPanel } from './ui/LibraryPanels'
import { CropOverlay, CropPanel, rotateCropAspect } from './ui/CropTool'
import { LeftPanel } from './ui/LeftPanel'
import { ContextMenuHost } from './ui/Menu'
import { TopBar } from './ui/TopBar'

const TOOLS: { id: Panel; icon: React.ReactNode; title: string }[] = [
  { id: 'edit', icon: <IconSliders />, title: 'Edit (E)' },
  { id: 'crop', icon: <IconCrop />, title: 'Crop & Rotate (C)' },
  { id: 'heal', icon: <IconHeal />, title: 'Remove (H)' },
  { id: 'mask', icon: <IconMask />, title: 'Masking (M)' },
  { id: 'redeye', icon: <IconRedEye />, title: 'Red Eye' },
]
const LIB_TOOLS: { id: Panel; icon: React.ReactNode; title: string }[] = [
  { id: 'presets', icon: <IconPresets />, title: 'Presets & Profiles (P)' },
  { id: 'versions', icon: <IconVersions />, title: 'Versions (Shift+V)' },
  { id: 'info', icon: <IconInfo />, title: 'Info (I)' },
  { id: 'keywords', icon: <IconTag />, title: 'Keywords (K)' },
]

function Rail() {
  const panel = ui.use((s) => s.panel)
  const selection = ui.use((s) => s.selection)
  const current = ui.use((s) => s.current)
  return (
    <div className="rail">
      {TOOLS.map((t) => (
        <button key={t.id} className={`icon-btn${panel === t.id ? ' active' : ''}`} title={t.title} onClick={() => ui.set({ panel: panel === t.id ? null : t.id })}>
          {t.icon}
        </button>
      ))}
      <div className="rail-sep" />
      {LIB_TOOLS.map((t) => (
        <button key={t.id} className={`icon-btn${panel === t.id ? ' active' : ''}`} title={t.title} onClick={() => ui.set({ panel: panel === t.id ? null : t.id })}>
          {t.icon}
        </button>
      ))}
      <div className="rail-spacer" />
      <button className="icon-btn" title="Export (Ctrl+Shift+E)" disabled={!selection.length && !current} onClick={() => ui.set({ dialog: 'export' })}>
        <IconShare />
      </button>
    </div>
  )
}

function RightPanel() {
  const panel = ui.use((s) => s.panel)
  if (!panel) return null
  return (
    <aside className="right">
      {panel === 'edit' && <EditPanel />}
      {panel === 'crop' && <CropPanel />}
      {panel === 'mask' && <MaskPanel />}
      {panel === 'heal' && <RemovePanel />}
      {panel === 'redeye' && <RedEyePanel />}
      {panel === 'presets' && <PresetsPanel />}
      {panel === 'versions' && <VersionsPanel />}
      {panel === 'info' && <InfoPanel />}
      {panel === 'keywords' && <KeywordsPanel />}
    </aside>
  )
}

/** White balance picker: click a neutral area of the photo. */
function WBPicker({ v }: { v: ViewInfo }) {
  return (
    <div
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
      onClick={(e) => {
        const r = v.renderer
        const sm = r.info?.small
        if (!sm) return
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const [ox, oy] = apply(v.toFrame, e.clientX - rect.left, e.clientY - rect.top)
        const [ow, oh] = r.orientedSize(v.params)
        const [sx, sy] = frameToSource(v.params, ow, oh, ox, oy)
        if (sx < 0 || sy < 0 || sx > 1 || sy > 1) return
        const cx = Math.round(sx * (sm.w - 1))
        const cy = Math.round(sy * (sm.h - 1))
        const acc: [number, number, number] = [0, 0, 0]
        let n = 0
        for (let y = cy - 1; y <= cy + 1; y++)
          for (let x = cx - 1; x <= cx + 1; x++) {
            if (x < 0 || y < 0 || x >= sm.w || y >= sm.h) continue
            const i = (y * sm.w + x) * 3
            acc[0] += sm.lin[i]
            acc[1] += sm.lin[i + 1]
            acc[2] += sm.lin[i + 2]
            n++
          }
        const wb = neutralize([acc[0] / n, acc[1] / n, acc[2] / n])
        patchParams({ wb: 'custom', temp: wb.temp, tint: wb.tint }, 'White Balance Picker')
        ui.set({ tool: null })
      }}
    />
  )
}

function Center() {
  const view = ui.use((s) => s.view)
  const current = ui.use((s) => s.current)
  const filmstrip = ui.use((s) => s.filmstrip)
  const tool = ui.use((s) => s.tool)
  const layout = ui.use((s) => s.compareLayout)
  const panel = ui.use((s) => s.panel)
  const maskSel = maskUI.use((s) => s.maskId)
  const maskOverlay = maskUI.use((s) => s.overlay)
  const maskIndex = editor.use((s) => s.params.masks.findIndex((m) => m.id === maskSel))
  const exists = lib.use((s) => (current ? !!s.photos[current] : false))
  const detail = (view === 'detail' || view === 'compare') && current && exists
  return (
    <main className="center">
      {detail ? (
        view === 'compare' ? (
          <div className={`compare${layout === 'tb' ? ' tb' : ''}`}>
            <DetailView id={current} before label="Before" />
            <DetailView id={current} label="After" />
          </div>
        ) : (
          <DetailView
            id={current}
            frameMode={panel === 'crop'}
            passive={!!tool || panel === 'crop' || panel === 'heal' || panel === 'redeye' || (panel === 'mask' && !!maskSel)}
            overlayMask={panel === 'mask' && maskOverlay ? maskIndex : -1}
            overlay={panel === 'crop' ? (v) => <CropOverlay v={v} /> : tool === 'wb' ? (v) => <WBPicker v={v} /> : tool === 'focus' || tool === 'pointcolor' ? (v) => <PointPicker v={v} kind={tool} /> : panel === 'mask' ? (v) => <MaskOverlay v={v} /> : panel === 'heal' ? (v) => <RetouchOverlay v={v} /> : panel === 'redeye' ? (v) => <RetouchOverlay v={v} redeye /> : undefined}
          />
        )
      ) : (
        <GridView square={view === 'square'} />
      )}
      {detail && filmstrip && <Filmstrip />}
      <BottomBar />
    </main>
  )
}

function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const s = ui.get()
      if (s.dialog) return
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key
      const lower = k.toLowerCase()
      const handled = () => e.preventDefault()
      if (ctrl) {
        if (lower === 'z' && !e.shiftKey) return handled(), A.doUndo()
        if (lower === 'y' || (lower === 'z' && e.shiftKey)) return handled(), A.doRedo()
        if (lower === 'r') return handled(), A.resetEdits()
        if (lower === 'c' && e.shiftKey) return handled(), ui.set({ dialog: 'copySettings' })
        if (lower === 'c') return handled(), A.copySettings()
        if (lower === 'v') return handled(), A.pasteSettings()
        if (lower === 'a') return handled(), document.dispatchEvent(new CustomEvent('gs-select-all'))
        if (lower === 'd') return handled(), ui.set({ selection: [] })
        if (lower === 'e' && e.shiftKey) return handled(), ui.set({ dialog: 'export' })
        if (lower === 'i' && e.shiftKey) return handled(), A.pickFiles()
        if (lower === 'p' && e.shiftKey) return handled(), ui.set({ left: !s.left })
        if (lower === 'f') return handled(), ui.set({ filmstrip: !s.filmstrip })
        if (k === '0') return handled(), ui.set({ histogram: !s.histogram })
        if (k === '[') return handled(), A.rotate(-1)
        if (k === ']') return handled(), A.rotate(1)
        if (k === '/' || k === '#') return handled(), ui.set({ dialog: 'shortcuts' })
        if (k === 'Enter') return handled(), ui.set({ dialog: 'slideshow' })
        return
      }
      if (e.altKey && lower === 'c') return handled(), ui.set({ view: s.current ? 'compare' : s.view })
      if (e.altKey) return
      const detail = s.view === 'detail' || s.view === 'compare'
      if (detail && s.panel === 'mask' && maskKey(e)) return handled()
      if (detail && (s.panel === 'heal' || s.panel === 'redeye') && (k === 'Delete' || k === 'Backspace')) {
        handled()
        if (deleteSelectedSpot()) return
        return
      }
      if (detail && s.panel === 'crop') {
        const ed = editor.get()
        const p = lib.get().photos[ed.photoId ?? '']
        if (k === 'Enter' || k === 'Escape') return handled(), ui.set({ panel: 'edit', tool: null })
        if (lower === 'a' && !e.shiftKey) return handled(), ui.set({ cropLocked: !s.cropLocked })
        if (lower === 'x' && p) {
          handled()
          const [ow, oh] = orientedSize(p.width, p.height, ed.params.crop.rot90)
          return rotateCropAspect(ed.params.crop, ow, oh)
        }
        if (lower === 'o') {
          const order = ['thirds', 'grid', 'golden', 'diagonal', 'none'] as const
          return handled(), ui.set({ cropOverlay: order[(order.indexOf(s.cropOverlay) + 1) % order.length] })
        }
      }
      switch (k) {
        case 'ArrowLeft':
          return handled(), step(-1)
        case 'ArrowRight':
          return handled(), step(1)
        case 'ArrowUp':
        case 'ArrowDown': {
          handled()
          if (detail) return step(k === 'ArrowUp' ? -1 : 1)
          const r = gridRows.findIndex((row) => row.includes(s.current ?? ''))
          if (r < 0) return step(0)
          const col = gridRows[r].indexOf(s.current!)
          const nr = gridRows[Math.max(0, Math.min(gridRows.length - 1, r + (k === 'ArrowUp' ? -1 : 1)))]
          const id = nr[Math.min(col, nr.length - 1)]
          return ui.set({ current: id, selection: [id], anchor: id })
        }
        case 'Enter':
          if (!detail && s.current) ui.set({ view: 'detail', zoom: 'fit' })
          return
        case 'Escape':
          if (s.tool) return ui.set({ tool: null })
          if (detail) return ui.set({ view: 'grid' })
          return ui.set({ selection: [] })
        case 'Delete':
        case 'Backspace':
          return handled(), A.deleteSelected()
        case '\\':
          return handled(), ui.set({ showOriginal: true })
        case ' ':
          handled()
          if (!detail && s.current) ui.set({ view: 'detail', zoom: 'fit' })
          return
      }
      if (/^[0-5]$/.test(k) && !e.shiftKey) return A.setRating(+k)
      if (/^[6-9]$/.test(k)) return A.setLabel((['red', 'yellow', 'green', 'blue'] as const)[+k - 6])
      switch (lower) {
        case 'g':
          return ui.set({ view: e.shiftKey ? 'square' : 'grid' })
        case 'd':
          return s.current ? ui.set({ view: 'detail', zoom: 'fit' }) : undefined
        case 'e':
          if (s.current) ui.set({ view: detail ? s.view : 'detail', panel: 'edit' })
          return
        case 'c':
          if (s.current) ui.set({ view: 'detail', panel: s.panel === 'crop' ? 'edit' : 'crop', tool: null })
          return
        case 'm':
          if (s.current) ui.set({ view: 'detail', panel: s.panel === 'mask' ? 'edit' : 'mask', tool: null })
          return
        case 'h':
          if (s.current) ui.set({ view: 'detail', panel: s.panel === 'heal' ? 'edit' : 'heal', tool: null })
          return
        case 'j':
          return ui.set({ clip: !s.clip })
        case 'i':
          return ui.set({ panel: s.panel === 'info' ? null : 'info' })
        case 'k':
          return handled(), ui.set({ panel: s.panel === 'keywords' ? null : 'keywords' })
        case 'p':
          return ui.set({ panel: s.panel === 'presets' ? null : 'presets' })
        case 'w':
          if (detail) ui.set({ tool: s.tool === 'wb' ? null : 'wb', panel: 'edit' })
          return
        case 'v':
          if (e.shiftKey) return ui.set({ panel: s.panel === 'versions' ? null : 'versions' })
          return A.toggleBW()
        case 'a':
          if (e.shiftKey) A.autoSettings()
          return
        case 'z':
          return A.setFlag(1)
        case 'x':
          return A.setFlag(-1)
        case 'u':
          return A.setFlag(0)
        case 'f':
          return document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === '\\') ui.set({ showOriginal: false })
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
}

function useDropImport() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const overH = (e: DragEvent) => isFiles(e) && e.preventDefault()
    const drop = async (e: DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const src = ui.get().source
      const ids = await importFiles(files, src.kind === 'album' ? src.id : undefined)
      if (ids.length) toast(`${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} added`)
      else if (files.length) toast('No supported image files found')
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overH)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overH)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}

export default function App() {
  const loaded = lib.use((s) => s.loaded)
  const left = ui.use((s) => s.left)
  const dialog = ui.use((s) => s.dialog)
  const toastMsg = ui.use((s) => s.toast)
  const importing = lib.use((s) => s.importing)
  const over = useDropImport()
  useKeyboard()
  useEffect(() => {
    void loadLibrary().then(restorePending)
    window.addEventListener('beforeunload', saveBeforeUnload)
    return () => window.removeEventListener('beforeunload', saveBeforeUnload)
  }, [])
  // Leaving a photo saves its edits.
  useEffect(
    () =>
      ui.subscribe(() => {
        const cur = ui.get().current
        if (editor.get().photoId && editor.get().photoId !== cur) flushSave()
      }),
    [],
  )
  if (!loaded) return <div className="app" />
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        {left && <LeftPanel />}
        <Center />
        <RightPanel />
        <Rail />
      </div>
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'copySettings' && <CopySettingsDialog />}
      {dialog === 'deleteForever' && <DeleteForeverDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'about' && <AboutDialog />}
      {dialog === 'slideshow' && <Slideshow />}
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {over && <div className="drop-overlay">Drop photos here</div>}
      {importing && (
        <div className="progress">
          Adding photos … {importing.done}/{importing.total}
          <div className="bar">
            <div style={{ width: `${(importing.done / importing.total) * 100}%` }} />
          </div>
        </div>
      )}
      <ContextMenuHost />
    </div>
  )
}
