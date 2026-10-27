import * as A from '../actions'
import { lib } from '../store/library'
import { ui, type View } from '../store/ui'
import { Stars } from './GridView'
import { IconCompare, IconDetail, IconFilmstrip, IconFlag, IconFlagFilled, IconLeftPanel, IconPhotoGrid, IconReject, IconRotateLeft, IconRotateRight, IconSquareGrid } from './Icons'

export function BottomBar() {
  const view = ui.use((s) => s.view)
  const current = ui.use((s) => s.current)
  const selection = ui.use((s) => s.selection)
  const thumbSize = ui.use((s) => s.thumbSize)
  const zoom = ui.use((s) => s.zoom)
  const filmstrip = ui.use((s) => s.filmstrip)
  const left = ui.use((s) => s.left)
  const showOriginal = ui.use((s) => s.showOriginal)
  const photo = lib.use((s) => (current ? s.photos[current] : undefined))
  const detail = view === 'detail' || view === 'compare'
  const hasTarget = detail ? !!photo : selection.length > 0
  const ref = detail ? photo : selection.length === 1 ? lib.get().photos[selection[0]] : undefined

  const V = ({ v, icon, title }: { v: View; icon: React.ReactNode; title: string }) => (
    <button className={`icon-btn${view === v ? ' active' : ''}`} title={title} onClick={() => (v === 'detail' || v === 'compare') && !current ? undefined : ui.set({ view: v })} disabled={(v === 'detail' || v === 'compare') && !current}>
      {icon}
    </button>
  )

  return (
    <div className="bottombar">
      <div className="bb-group">
        <button className={`icon-btn${left ? ' active' : ''}`} title="Left Panel (Ctrl+Shift+P)" onClick={() => ui.set({ left: !left })}>
          <IconLeftPanel />
        </button>
        <div className="bb-sep" />
        <V v="grid" icon={<IconPhotoGrid />} title="Photo Grid (G)" />
        <V v="square" icon={<IconSquareGrid />} title="Square Grid (Shift+G)" />
        <V v="detail" icon={<IconDetail />} title="Detail (D)" />
        <V v="compare" icon={<IconCompare />} title="Compare Before/After (Alt+C)" />
      </div>
      <div className="bb-sep" />
      <div className="bb-group" style={{ opacity: hasTarget ? 1 : 0.35, pointerEvents: hasTarget ? undefined : 'none' }}>
        <Stars value={ref?.rating ?? 0} onSet={(v) => A.setRating(v)} size={15} />
        <div className="bb-sep" />
        <button className={`icon-btn flag-btn${ref?.flag === 1 ? ' on-pick' : ''}`} title="Flag as Picked (Z)" onClick={() => A.setFlag(ref?.flag === 1 ? 0 : 1)}>
          {ref?.flag === 1 ? <IconFlagFilled /> : <IconFlag />}
        </button>
        <button className={`icon-btn flag-btn${ref?.flag === -1 ? ' on-reject' : ''}`} title="Flag as Rejected (X)" onClick={() => A.setFlag(ref?.flag === -1 ? 0 : -1)}>
          <IconReject />
        </button>
        <div className="bb-sep" />
        <button className="icon-btn" title="Rotate Left (Ctrl+[)" onClick={() => A.rotate(-1)}>
          <IconRotateLeft />
        </button>
        <button className="icon-btn" title="Rotate Right (Ctrl+])" onClick={() => A.rotate(1)}>
          <IconRotateRight />
        </button>
      </div>
      <div className="bb-spacer" />
      {detail ? (
        <div className="bb-zoom">
          {view === 'detail' && (
            <button
              className={`zoom-btn${showOriginal ? ' on' : ''}`}
              title="Show Original (\)"
              onPointerDown={() => ui.set({ showOriginal: true })}
              onPointerUp={() => ui.set({ showOriginal: false })}
              onPointerLeave={() => showOriginal && ui.set({ showOriginal: false })}
            >
              Before
            </button>
          )}
          <div className="bb-sep" />
          {(['fit', 'fill', 1, 2] as const).map((z) => (
            <button key={String(z)} className={`zoom-btn${zoom === z ? ' on' : ''}`} onClick={() => ui.set({ zoom: z })}>
              {z === 'fit' ? 'Fit' : z === 'fill' ? 'Fill' : z === 1 ? '1:1' : '2:1'}
            </button>
          ))}
          <div className="bb-sep" />
          <button className={`icon-btn${filmstrip ? ' active' : ''}`} title="Filmstrip (Ctrl+F)" onClick={() => ui.set({ filmstrip: !filmstrip })}>
            <IconFilmstrip />
          </button>
        </div>
      ) : (
        <div className="bb-zoom">
          <span>Size</span>
          <input className="range" type="range" min={90} max={420} value={thumbSize} onChange={(e) => ui.set({ thumbSize: +e.target.value })} />
        </div>
      )}
    </div>
  )
}
