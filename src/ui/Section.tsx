import type { ReactNode } from 'react'
import { defaultParams, getAt, setAt, type Params } from '../engine/params'
import { change, editor } from '../store/editor'
import { ui } from '../store/ui'
import { IconChevron } from './Icons'
import { openContextMenu } from './Menu'

/** Resets the given Params paths to their defaults (one history step). */
export function resetKeys(keys: string[], label: string) {
  const d = defaultParams()
  let p: Params = editor.get().params
  for (const k of keys) p = setAt(p, k, structuredClone(getAt(d, k)))
  change(p, label)
}

export function isDefault(keys: string[], p: Params) {
  const d = defaultParams()
  return keys.every((k) => JSON.stringify(getAt(p, k)) === JSON.stringify(getAt(d, k)))
}

export function Section({ id, title, keys, children, extra }: { id: string; title: string; keys: string[]; children: ReactNode; extra?: ReactNode }) {
  const open = ui.use((s) => s.sections[id] ?? false)
  const changed = editor.use((s) => !isDefault(keys, s.params))
  const toggle = () => ui.set((s) => ({ sections: { ...s.sections, [id]: !open } }))
  return (
    <div className={`section${open ? '' : ' closed'}`}>
      <button
        className="section-head"
        onClick={toggle}
        onDoubleClick={(e) => {
          e.preventDefault()
        }}
        onContextMenu={(e) =>
          openContextMenu(e, [
            { label: `Reset ${title}`, disabled: !changed, onClick: () => resetKeys(keys, `Reset ${title}`) },
            { sep: true },
            { label: 'Expand All Sections', onClick: () => ui.set((s) => ({ sections: Object.fromEntries(Object.keys(s.sections).map((k) => [k, true])) })) },
            { label: 'Collapse All Sections', onClick: () => ui.set((s) => ({ sections: Object.fromEntries(Object.keys(s.sections).map((k) => [k, false])) })) },
          ])
        }
        title="Click: expand/collapse · Right-click: reset"
      >
        <span>{title}</span>
        {changed && <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--c-accent-2)' }} title="Changed" />}
        {extra}
        <span className="chev">
          <IconChevron />
        </span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}
