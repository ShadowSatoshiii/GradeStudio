import { useEffect, useMemo, useState } from 'react'
import * as A from '../actions'
import { formatShutter } from '../engine/exif'
import { cloneParams, normalizeParams, type Params } from '../engine/params'
import { applyPreset, BUILTIN_PRESETS, diffFromDefault, type Preset } from '../engine/presets'
import { PROFILES } from '../engine/profiles'
import { change, editor, saveParams, setPreview } from '../store/editor'
import { lib, uid, updatePhoto, updatePhotos, type Photo } from '../store/library'
import { deletePreset, loadPresets, presetStore, savePreset } from '../store/presets'
import { targets, toast, ui } from '../store/ui'
import { LABEL_COLORS, LABEL_NAMES, Stars } from './GridView'
import { IconClose, IconPlus } from './Icons'
import { openContextMenu } from './Menu'
import { Slider } from './Slider'

function useTargetPhotos(): Photo[] {
  const photos = lib.use((s) => s.photos)
  ui.use((s) => s.selection)
  ui.use((s) => s.current)
  ui.use((s) => s.view)
  return targets()
    .map((id) => photos[id])
    .filter(Boolean)
}

const fmtDate = (t?: number) => (t ? new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '–')
const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`)

// ---------- Info ----------

export function InfoPanel() {
  const list = useTargetPhotos()
  const p = list[0]
  if (!p)
    return (
      <>
        <div className="panel-head">Info</div>
        <div className="panel-empty">Select a photo to see its details.</div>
      </>
    )
  const multi = list.length > 1
  const setAll = (patch: Partial<Photo>) => updatePhotos(list.map((x) => x.id), () => patch)
  const field = (k: 'title' | 'caption' | 'copyright', label: string, area = false) => {
    const vals = new Set(list.map((x) => x[k]))
    const value = vals.size === 1 ? [...vals][0] : ''
    const ph = vals.size > 1 ? 'Multiple values' : ''
    const fieldKey = k + p.id + list.length
    const props = {
      defaultValue: value,
      placeholder: ph,
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.target.value !== value && setAll({ [k]: e.target.value } as Partial<Photo>),
      onKeyDown: (e: React.KeyboardEvent) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !area) (e.target as HTMLInputElement).blur()
      },
    }
    return (
      <div className="field">
        <label>{label}</label>
        {area ? <textarea key={fieldKey} rows={3} {...props} /> : <input key={fieldKey} {...props} />}
      </div>
    )
  }
  const x = p.exif
  return (
    <>
      <div className="panel-head">Info{multi && <span style={{ fontWeight: 400, color: 'var(--c-text-3)' }}> · {list.length} photos</span>}</div>
      <div className="panel-scroll">
        <div className="form">
          {!multi && (
            <div className="field">
              <label>File name</label>
              <input
                key={'n' + p.id}
                defaultValue={p.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && updatePhoto(p.id, { name: e.target.value.trim() })}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
            </div>
          )}
          {field('title', 'Title')}
          {field('caption', 'Caption', true)}
          {field('copyright', 'Copyright')}
          <div className="field">
            <label>Rating</label>
            <Stars value={multi ? 0 : p.rating} onSet={(v) => A.setRating(v, list.map((y) => y.id))} size={16} />
          </div>
          <div className="field">
            <label>Color label</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.keys(LABEL_COLORS).map((k) => (
                <button
                  key={k}
                  title={LABEL_NAMES[k]}
                  onClick={() => A.setLabel(k as Photo['label'], list.map((y) => y.id))}
                  style={{ width: 20, height: 20, borderRadius: 10, background: LABEL_COLORS[k], outline: !multi && p.label === k ? '2px solid #fff' : 'none', outlineOffset: 2 }}
                />
              ))}
            </div>
          </div>
        </div>
        {!multi && (
          <>
            <div className="sub-title" style={{ padding: '4px 16px 8px' }}>
              Capture
            </div>
            <div className="kv">
              <span className="k">Captured</span>
              <span className="v">{fmtDate(p.captureDate)}</span>
              <span className="k">Camera</span>
              <span className="v">{[x?.make, x?.model].filter(Boolean).join(' ') || '–'}</span>
              <span className="k">Lens</span>
              <span className="v">{x?.lens || '–'}</span>
              <span className="k">Exposure</span>
              <span className="v">
                {x?.fNumber ? `f/${x.fNumber.toFixed(1)}` : '–'} · {formatShutter(x?.exposureTime)} · {x?.iso ? `ISO ${x.iso}` : '–'}
              </span>
              <span className="k">Focal length</span>
              <span className="v">{x?.focalLength ? `${Math.round(x.focalLength)} mm` : '–'}</span>
              <span className="k">Flash</span>
              <span className="v">{x?.flash === undefined ? '–' : x.flash ? 'fired' : 'did not fire'}</span>
              {x?.lat !== undefined && x.lon !== undefined && (
                <>
                  <span className="k">GPS</span>
                  <span className="v">
                    {x.lat.toFixed(5)}, {x.lon.toFixed(5)}
                  </span>
                </>
              )}
            </div>
            <div className="sub-title" style={{ padding: '4px 16px 8px' }}>
              File
            </div>
            <div className="kv">
              <span className="k">Dimensions</span>
              <span className="v">
                {p.width} × {p.height} px ({((p.width * p.height) / 1e6).toFixed(1)} MP)
              </span>
              <span className="k">Size</span>
              <span className="v">{fmtSize(p.size)}</span>
              <span className="k">Type</span>
              <span className="v">{p.type}</span>
              <span className="k">Added</span>
              <span className="v">{fmtDate(p.addedAt)}</span>
              <span className="k">Edited</span>
              <span className="v">{fmtDate(p.editedAt)}</span>
              {x?.software && (
                <>
                  <span className="k">Software</span>
                  <span className="v">{x.software}</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ---------- Keywords ----------

export function KeywordsPanel() {
  const list = useTargetPhotos()
  const all = lib.use((s) => s.photos)
  const [text, setText] = useState('')
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of Object.values(all)) for (const k of p.keywords) m.set(k, (m.get(k) ?? 0) + 1)
    return m
  }, [all])
  if (!list.length)
    return (
      <>
        <div className="panel-head">Keywords</div>
        <div className="panel-empty">Select photos to add keywords.</div>
      </>
    )
  const shared = list[0].keywords.filter((k) => list.every((p) => p.keywords.includes(k)))
  const partial = [...new Set(list.flatMap((p) => p.keywords))].filter((k) => !shared.includes(k))
  const add = (raw: string) => {
    const words = raw
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean)
    if (!words.length) return
    void updatePhotos(
      list.map((p) => p.id),
      (p) => ({ keywords: [...new Set([...p.keywords, ...words])] }),
    )
    setText('')
  }
  const remove = (k: string) => updatePhotos(list.map((p) => p.id), (p) => ({ keywords: p.keywords.filter((x) => x !== k) }))
  const suggestions = [...counts.entries()]
    .filter(([k]) => !shared.includes(k) && (!text || k.toLowerCase().includes(text.toLowerCase())))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
  return (
    <>
      <div className="panel-head">Keywords{list.length > 1 && <span style={{ fontWeight: 400, color: 'var(--c-text-3)' }}> · {list.length} photos</span>}</div>
      <div className="panel-scroll">
        <div className="form">
          <div className="field">
            <label>Add keywords (separate with commas)</label>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') add(text)
              }}
              placeholder="e.g. vacation, beach"
            />
          </div>
        </div>
        <div className="tags">
          {shared.length === 0 && partial.length === 0 && <span style={{ color: 'var(--c-text-3)' }}>No keywords yet</span>}
          {shared.map((k) => (
            <span className="tag" key={k}>
              {k}
              <button onClick={() => remove(k)} title="Remove">
                <IconClose size={11} />
              </button>
            </span>
          ))}
          {partial.map((k) => (
            <span className="tag" key={k} style={{ opacity: 0.6 }} title="Only on some of the selected photos">
              {k}
              <button onClick={() => remove(k)} title="Remove">
                <IconClose size={11} />
              </button>
            </span>
          ))}
        </div>
        {suggestions.length > 0 && (
          <>
            <div className="sub-title" style={{ padding: '6px 16px 6px' }}>
              Suggestions
            </div>
            <div className="tags">
              {suggestions.map(([k, n]) => (
                <button key={k} className="chip" onClick={() => add(k)}>
                  <IconPlus size={11} /> {k} <span style={{ color: 'var(--c-text-3)' }}>{n}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ---------- Presets ----------

const KEYS_FOR_PRESET: (keyof Params)[] = ['profile', 'profileAmount', 'bw', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'curve', 'wb', 'temp', 'tint', 'vibrance', 'saturation', 'mixHue', 'mixSat', 'mixLum', 'grayMix', 'grade', 'texture', 'clarity', 'dehaze', 'vignette', 'grain', 'sharpen', 'noise', 'optics']

export function PresetsPanel() {
  const photoId = editor.use((s) => s.photoId)
  const view = ui.use((s) => s.view)
  const user = presetStore.use((s) => s.list)
  const loaded = presetStore.use((s) => s.loaded)
  const [open, setOpen] = useState<Record<string, boolean>>({ 'My Presets': true, Portrait: true })
  const [active, setActive] = useState<Preset | null>(null)
  const [amount, setAmount] = useState(100)
  const [base, setBase] = useState<Params | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => {
    if (!loaded) void loadPresets()
  }, [loaded])
  useEffect(() => () => setPreview(null), [])
  const inEditor = (view === 'detail' || view === 'compare') && !!photoId
  const groups = useMemo(() => {
    const m = new Map<string, Preset[]>()
    m.set('My Presets', user)
    for (const p of BUILTIN_PRESETS) m.set(p.group, [...(m.get(p.group) ?? []), p])
    return [...m]
  }, [user])

  const apply = (p: Preset) => {
    if (inEditor) {
      const b = active ? base! : cloneParams(editor.get().params)
      setBase(b)
      setActive(p)
      setAmount(100)
      change(applyPreset(b, p, 1), `Preset: ${p.name}`)
    } else {
      // Grid: apply to all selected photos.
      const ids = targets()
      for (const id of ids) {
        const ph = lib.get().photos[id]
        if (ph) void saveParams(id, applyPreset(normalizeParams(ph.params), p, 1))
      }
      toast(`“${p.name}” applied to ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}`)
    }
  }

  const create = async () => {
    const params = diffFromDefault(editor.get().params, KEYS_FOR_PRESET)
    if (!Object.keys(params).length) {
      toast('No changes to save')
      return
    }
    const p: Preset = { id: uid(), name: name.trim() || 'My Preset', group: 'My Presets', params }
    await savePreset(p)
    setNaming(false)
    setName('')
    toast(`Preset “${p.name}” saved`)
  }

  return (
    <>
      <div className="panel-head">
        Presets
        <span className="spacer" />
        {inEditor && (
          <button className="icon-btn" title="Create a preset from the current settings" onClick={() => setNaming(true)}>
            <IconPlus size={16} />
          </button>
        )}
      </div>
      {naming && (
        <div className="form" style={{ borderBottom: '1px solid var(--c-line-2)' }}>
          <div className="field">
            <label>Preset name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') void create()
                if (e.key === 'Escape') setNaming(false)
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn quiet small" onClick={() => setNaming(false)}>
              Cancel
            </button>
            <button className="btn primary small" onClick={() => void create()}>
              Save
            </button>
          </div>
        </div>
      )}
      {active && inEditor && (
        <div className="section-body" style={{ paddingTop: 10, borderBottom: '1px solid var(--c-line-2)' }}>
          <Slider
            def={{ key: 'presetAmount', label: `Amount: ${active.name}`, min: 0, max: 200, step: 1 }}
            value={amount}
            defaultValue={100}
            onChange={(v) => {
              setAmount(v)
              change(applyPreset(base!, active, v / 100), `Preset Amount: ${active.name}`)
            }}
          />
        </div>
      )}
      <div className="panel-scroll">
        {!inEditor && <div className="panel-empty" style={{ padding: '14px 18px 4px' }}>Click a preset to apply it to the selected photos.</div>}
        {groups.map(([gname, list]) => (
          <div key={gname} className={`section${open[gname] ? '' : ' closed'}`}>
            <button className="section-head" onClick={() => setOpen((o) => ({ ...o, [gname]: !o[gname] }))}>
              <span>{gname}</span>
              <span style={{ color: 'var(--c-text-3)', fontWeight: 400 }}>{list.length}</span>
              <span className="chev">▾</span>
            </button>
            {open[gname] && (
              <div style={{ paddingBottom: 8 }}>
                {list.length === 0 && <div style={{ padding: '0 16px 8px', color: 'var(--c-text-3)' }}>Use + to save the current settings as a preset.</div>}
                {list.map((p) => (
                  <button
                    key={p.id}
                    className={`lp-item${active?.id === p.id ? ' active' : ''}`}
                    style={{ paddingLeft: 24 }}
                    onMouseEnter={() => inEditor && setPreview(applyPreset(active ? base! : editor.get().params, p, 1))}
                    onMouseLeave={() => setPreview(null)}
                    onClick={() => {
                      setPreview(null)
                      apply(p)
                    }}
                    onContextMenu={(e) =>
                      !p.builtIn &&
                      openContextMenu(e, [
                        {
                          label: 'Update with Current Settings',
                          disabled: !inEditor,
                          onClick: () => void savePreset({ ...p, params: diffFromDefault(editor.get().params, KEYS_FOR_PRESET) }),
                        },
                        { label: 'Delete', onClick: () => void deletePreset(p.id) },
                      ])
                    }
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="sub-title" style={{ padding: '14px 16px 6px' }}>
          Profile
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: '0 16px 12px' }}>
          {PROFILES.map((pr) => (
            <button
              key={pr.id}
              title={pr.name}
              disabled={!inEditor}
              onMouseEnter={() => inEditor && setPreview({ ...editor.get().params, profile: pr.id, profileAmount: 100, bw: pr.bw ? true : editor.get().params.bw })}
              onMouseLeave={() => setPreview(null)}
              onClick={() => {
                setPreview(null)
                change({ ...editor.get().params, profile: pr.id, profileAmount: 100, ...(pr.bw ? { bw: true } : {}) }, `Profile: ${pr.name}`)
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch', color: 'var(--c-text-2)', fontSize: 11 }}
            >
              <span style={{ height: 34, borderRadius: 4, background: pr.swatch, outline: editor.get().params.profile === pr.id ? '2px solid var(--c-accent-2)' : 'none' }} />
              {pr.name}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

// ---------- Versions ----------

export function VersionsPanel() {
  const photoId = editor.use((s) => s.photoId)
  const view = ui.use((s) => s.view)
  const photo = lib.use((s) => (photoId ? s.photos[photoId] : undefined))
  const [name, setName] = useState('')
  if (!(view === 'detail' || view === 'compare') || !photo)
    return (
      <>
        <div className="panel-head">Versions</div>
        <div className="panel-empty">Versions are available in the detail view.</div>
      </>
    )
  const create = async () => {
    const v = { id: uid(), name: name.trim() || `Version ${photo.versions.length + 1}`, date: Date.now(), auto: false, params: cloneParams(editor.get().params) }
    await updatePhoto(photo.id, { versions: [v, ...photo.versions] })
    setName('')
    toast(`Version “${v.name}” saved`)
  }
  const restore = (params: Params, label: string) => change(cloneParams(params), label)
  return (
    <>
      <div className="panel-head">Versions</div>
      <div className="form" style={{ borderBottom: '1px solid var(--c-line-2)' }}>
        <div className="field">
          <label>Save the current state as a version</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={name}
              placeholder={`Version ${photo.versions.length + 1}`}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') void create()
              }}
            />
            <button className="btn primary small" onClick={() => void create()}>
              Create
            </button>
          </div>
        </div>
      </div>
      <div className="panel-scroll">
        <button className="lp-item" onMouseEnter={() => setPreview(normalizeParams(undefined))} onMouseLeave={() => setPreview(null)} onClick={() => (setPreview(null), restore(normalizeParams(undefined), 'Version: Original'))}>
          <span>Original</span>
          <span className="count">unedited</span>
        </button>
        {photo.versions.map((v) => (
          <button
            key={v.id}
            className="lp-item"
            onMouseEnter={() => setPreview(normalizeParams(v.params))}
            onMouseLeave={() => setPreview(null)}
            onClick={() => (setPreview(null), restore(normalizeParams(v.params), `Version: ${v.name}`))}
            onContextMenu={(e) =>
              openContextMenu(e, [
                {
                  label: 'Rename …',
                  onClick: () => {
                    const n = prompt('New name', v.name)
                    if (n) void updatePhoto(photo.id, { versions: photo.versions.map((x) => (x.id === v.id ? { ...x, name: n } : x)) })
                  },
                },
                { label: 'Overwrite with Current State', onClick: () => void updatePhoto(photo.id, { versions: photo.versions.map((x) => (x.id === v.id ? { ...x, params: cloneParams(editor.get().params), date: Date.now() } : x)) }) },
                { sep: true },
                { label: 'Delete', onClick: () => void updatePhoto(photo.id, { versions: photo.versions.filter((x) => x.id !== v.id) }) },
              ])
            }
          >
            <span>{v.name}</span>
            <span className="count">{new Date(v.date).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </button>
        ))}
        {photo.versions.length === 0 && <div className="panel-empty" style={{ paddingTop: 16 }}>No versions yet. Hover over a version to preview it; click to restore it.</div>}
      </div>
    </>
  )
}
