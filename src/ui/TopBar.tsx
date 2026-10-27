import * as A from '../actions'
import { editor } from '../store/editor'
import { lib } from '../store/library'
import { ui, type Panel, type View } from '../store/ui'
import { IconPlus, IconSearch } from './Icons'
import { Dropdown, type MenuItem } from './Menu'

const panel = (p: Panel) => () => ui.set({ panel: ui.get().panel === p ? null : p })
const view = (v: View) => () => ui.set({ view: v })

export function TopBar() {
  const text = ui.use((s) => s.filter.text)
  const importing = lib.use((s) => s.importing)

  const fileMenu = (): MenuItem[] => [
    { label: 'Add Photos …', kbd: 'Ctrl+Shift+I', onClick: () => A.pickFiles() },
    { label: 'Add Folder …', onClick: () => A.pickFiles({ folder: true }) },
    { sep: true },
    { label: 'Export …', kbd: 'Ctrl+Shift+E', onClick: () => ui.set({ dialog: 'export' }), disabled: !ui.get().selection.length && !ui.get().current },
  ]
  const editMenu = (): MenuItem[] => {
    const ed = editor.get()
    return [
      { label: 'Undo', kbd: 'Ctrl+Z', onClick: A.doUndo, disabled: ed.index <= 0 },
      { label: 'Redo', kbd: 'Ctrl+Y', onClick: A.doRedo, disabled: ed.index >= ed.history.length - 1 },
      { sep: true },
      { label: 'Select All', kbd: 'Ctrl+A', onClick: () => document.dispatchEvent(new CustomEvent('gs-select-all')) },
      { label: 'Select None', kbd: 'Ctrl+D', onClick: () => ui.set({ selection: [] }) },
      { sep: true },
      { label: 'Copy Edit Settings', kbd: 'Ctrl+C', onClick: () => A.copySettings() },
      { label: 'Choose Settings to Copy …', kbd: 'Ctrl+Shift+C', onClick: () => ui.set({ dialog: 'copySettings' }) },
      { label: 'Paste Edit Settings', kbd: 'Ctrl+V', onClick: () => A.pasteSettings(), disabled: !A.hasClipboard() },
    ]
  }
  const photoMenu = (): MenuItem[] => [
    { label: 'Auto Settings', kbd: 'Shift+A', onClick: () => A.autoSettings() },
    { label: 'Black & White', kbd: 'V', onClick: () => A.toggleBW() },
    { label: 'Reset Edits', kbd: 'Ctrl+R', onClick: () => A.resetEdits() },
    { sep: true },
    { label: 'Rotate Left', kbd: 'Ctrl+[', onClick: () => A.rotate(-1) },
    { label: 'Rotate Right', kbd: 'Ctrl+]', onClick: () => A.rotate(1) },
    { label: 'Flip Horizontal', onClick: () => A.flip('h') },
    { label: 'Flip Vertical', onClick: () => A.flip('v') },
    { sep: true },
    { heading: 'Rating' },
    ...[0, 1, 2, 3, 4, 5].map((r) => ({ label: r ? '★'.repeat(r) : 'No Stars', kbd: String(r), onClick: () => A.setRating(r) })),
    { sep: true },
    { label: 'Flag as Picked', kbd: 'Z', onClick: () => A.setFlag(1) },
    { label: 'Flag as Rejected', kbd: 'X', onClick: () => A.setFlag(-1) },
    { label: 'Remove Flag', kbd: 'U', onClick: () => A.setFlag(0) },
    { sep: true },
    ui.get().source.kind === 'trash'
      ? { label: 'Restore', onClick: A.restoreSelected }
      : { label: 'Delete …', kbd: 'Del', onClick: A.deleteSelected },
  ]
  const viewMenu = (): MenuItem[] => {
    const s = ui.get()
    return [
      { label: 'Photo Grid', kbd: 'G', checked: s.view === 'grid', onClick: view('grid') },
      { label: 'Square Grid', kbd: 'Shift+G', checked: s.view === 'square', onClick: view('square') },
      { label: 'Detail', kbd: 'D', checked: s.view === 'detail', onClick: view('detail') },
      { label: 'Compare', kbd: 'Alt+C', checked: s.view === 'compare', onClick: view('compare') },
      { sep: true },
      { label: 'Edit', kbd: 'E', checked: s.panel === 'edit', onClick: panel('edit') },
      { label: 'Crop & Rotate', kbd: 'C', checked: s.panel === 'crop', onClick: panel('crop') },
      { label: 'Info', kbd: 'I', checked: s.panel === 'info', onClick: panel('info') },
      { label: 'Keywords', kbd: 'K', checked: s.panel === 'keywords', onClick: panel('keywords') },
      { label: 'Presets', kbd: 'P', checked: s.panel === 'presets', onClick: panel('presets') },
      { label: 'Versions', kbd: 'Shift+V', checked: s.panel === 'versions', onClick: panel('versions') },
      { sep: true },
      { label: 'Left Panel', kbd: 'Ctrl+Shift+P', checked: s.left, onClick: () => ui.set({ left: !s.left }) },
      { label: 'Filmstrip', kbd: 'Ctrl+F', checked: s.filmstrip, onClick: () => ui.set({ filmstrip: !s.filmstrip }) },
      { label: 'Histogram', kbd: 'Ctrl+0', checked: s.histogram, onClick: () => ui.set({ histogram: !s.histogram }) },
      { label: 'Show Clipping', kbd: 'J', checked: s.clip, onClick: () => ui.set({ clip: !s.clip }) },
      { sep: true },
      { label: 'Start Slideshow', kbd: 'Ctrl+Enter', onClick: () => ui.set({ dialog: 'slideshow' }) },
      { label: 'Full Screen', kbd: 'F', onClick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) },
    ]
  }
  const helpMenu = (): MenuItem[] => [
    { label: 'Keyboard Shortcuts', kbd: 'Ctrl+/', onClick: () => ui.set({ dialog: 'shortcuts' }) },
    { label: 'About GradeStudio', onClick: () => ui.set({ dialog: 'about' }) },
  ]

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        GradeStudio
      </div>
      <Dropdown label="File" items={fileMenu} />
      <Dropdown label="Edit" items={editMenu} />
      <Dropdown label="Photo" items={photoMenu} />
      <Dropdown label="View" items={viewMenu} />
      <Dropdown label="Help" items={helpMenu} />
      <div className="top-spacer" />
      <label className="search" title="Search photos (name, title, keyword, camera)">
        <IconSearch size={15} />
        <input
          placeholder="Search photos"
          value={text}
          onChange={(e) => ui.set((s) => ({ filter: { ...s.filter, text: e.target.value } }))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              ui.set((s) => ({ filter: { ...s.filter, text: '' } }))
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      </label>
      <div className="top-spacer" />
      {importing && (
        <span style={{ color: 'var(--c-text-3)', marginRight: 8 }}>
          Import {importing.done}/{importing.total}
        </span>
      )}
      <button className="add-btn" onClick={() => A.pickFiles()} title="Add photos">
        <IconPlus size={16} /> Add
      </button>
    </div>
  )
}
