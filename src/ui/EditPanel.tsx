import * as A from '../actions'
import { S } from '../engine/params'
import { PROFILES, profileById } from '../engine/profiles'
import { editor, patchParams, setParam } from '../store/editor'
import { ui } from '../store/ui'
import { ColorGrading, ColorMixer } from './ColorTools'
import { CalibrationControls, LensBlurControls, PointColorControls } from './ExtraTools'
import { CurveEditor } from './CurveEditor'
import { HistogramView } from './Histogram'
import { IconPicker, IconReset } from './Icons'
import { Dropdown } from './Menu'
import { isDefault, resetKeys, Section } from './Section'
import { PSlider } from './Slider'

export const LIGHT_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'curve']
export const COLOR_KEYS = ['wb', 'temp', 'tint', 'vibrance', 'saturation', 'mixHue', 'mixSat', 'mixLum', 'grayMix', 'grade', 'pointColors', 'calibration']
export const EFFECT_KEYS = ['texture', 'clarity', 'dehaze', 'vignette', 'grain']
export const DETAIL_KEYS = ['sharpen', 'noise']
export const OPTICS_KEYS = ['optics']

function Detail() {
  const sharp = editor.use((s) => s.params.sharpen.amount)
  const nr = editor.use((s) => s.params.noise.luminance)
  const cnr = editor.use((s) => s.params.noise.color)
  return (
    <>
      <PSlider def={S.sharpAmount} />
      <PSlider def={S.sharpRadius} disabled={!sharp} />
      <PSlider def={S.sharpDetail} disabled={!sharp} />
      <PSlider def={S.sharpMasking} disabled={!sharp} />
      <div className="sub-title" style={{ marginTop: 12 }}>Noise Reduction</div>
      <PSlider def={S.nrLum} label="Luminance" />
      <PSlider def={S.nrDetail} disabled={!nr} />
      <PSlider def={S.nrContrast} disabled={!nr} />
      <PSlider def={S.nrColor} label="Color" />
      <PSlider def={S.nrColorDetail} disabled={!cnr} />
      <PSlider def={S.nrSmooth} disabled={!cnr} />
    </>
  )
}

function Optics() {
  const ca = editor.use((s) => s.params.optics.removeCA)
  return (
    <>
      <label className="wb-row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={ca} onChange={(e) => setParam('optics.removeCA', e.target.checked, 'Remove Chromatic Aberration')} />
        <span>Remove Chromatic Aberration</span>
      </label>
      <div className="sub-title" style={{ marginTop: 10 }}>Lens Correction (Manual)</div>
      <PSlider def={S.lensDistortion} />
      <PSlider def={S.lensVignetting} />
      <div className="sub-title" style={{ marginTop: 10 }}>Defringe</div>
      <PSlider def={S.fringePurple} />
      <PSlider def={S.fringeGreen} />
    </>
  )
}

/** Toggle button that opens a sub panel inside a section (state persists). */
function SubToggle({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const open = ui.use((s) => s.sections[id] ?? false)
  return (
    <>
      <div className="sub-btns">
        <button className={`sub-btn${open ? ' on' : ''}`} onClick={() => ui.set((s) => ({ sections: { ...s.sections, [id]: !open } }))}>
          {label}
        </button>
      </div>
      {open && <div className="sub-panel">{children}</div>}
    </>
  )
}

function MixerToggle() {
  const bw = editor.use((s) => s.params.bw || !!profileById(s.params.profile).bw)
  return (
    <SubToggle id="mixer" label={bw ? 'B&W Mixer' : 'Color Mixer'}>
      <ColorMixer />
    </SubToggle>
  )
}

function Effects() {
  const vig = editor.use((s) => s.params.vignette.amount)
  const grain = editor.use((s) => s.params.grain.amount)
  return (
    <>
      <PSlider def={S.texture} />
      <PSlider def={S.clarity} />
      <PSlider def={S.dehaze} />
      <div className="sub-title" style={{ marginTop: 12 }}>Vignette</div>
      <PSlider def={S.vigAmount} label="Amount" />
      <PSlider def={S.vigMidpoint} disabled={!vig} />
      <PSlider def={S.vigRoundness} disabled={!vig} />
      <PSlider def={S.vigFeather} disabled={!vig} />
      <PSlider def={S.vigHighlights} disabled={vig >= 0} />
      <div className="sub-title" style={{ marginTop: 12 }}>Grain</div>
      <PSlider def={S.grainAmount} label="Amount" />
      <PSlider def={S.grainSize} disabled={!grain} />
      <PSlider def={S.grainRoughness} disabled={!grain} />
    </>
  )
}

function ProfileRow() {
  const profile = editor.use((s) => s.params.profile)
  const bw = editor.use((s) => s.params.bw)
  const prof = profileById(profile)
  return (
    <>
      <div className="edit-top">
        <div className="seg">
          <button onClick={() => A.autoSettings()} title="Auto Settings (Shift+A)">
            Auto
          </button>
          <button className={bw || prof.bw ? 'on' : ''} onClick={() => A.toggleBW()} title="Black & White (V)">
            {'B&W'}
          </button>
        </div>
      </div>
      <div className="profile-row">
        <span className="lbl">Profile</span>
        <select
          className="select"
          value={profile}
          onChange={(e) => {
            const p = profileById(e.target.value)
            patchParams({ profile: p.id, profileAmount: 100, ...(p.bw ? { bw: true } : {}) }, `Profile: ${p.name}`)
          }}
        >
          {(['Standard', 'B&W', 'Creative'] as const).map((g) => (
            <optgroup key={g} label={g}>
              {PROFILES.filter((p) => p.group === g).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {prof.fn && (
        <div style={{ padding: '0 14px' }}>
          <PSlider def={S.profileAmount} />
        </div>
      )}
    </>
  )
}

function WhiteBalance() {
  const wb = editor.use((s) => s.params.wb)
  const tool = ui.use((s) => s.tool)
  return (
    <div className="wb-row">
      <span className="lbl">White Balance</span>
      <select
        className="select"
        value={wb}
        onChange={(e) => {
          const v = e.target.value as 'asShot' | 'auto' | 'custom'
          if (v === 'auto') void A.autoWB()
          else if (v === 'asShot') patchParams({ wb: 'asShot', temp: 0, tint: 0 }, 'White Balance: As Shot')
          else setParam('wb', 'custom', 'White Balance')
        }}
      >
        <option value="asShot">As Shot</option>
        <option value="auto">Auto</option>
        <option value="custom">Custom</option>
      </select>
      <button className={`icon-btn${tool === 'wb' ? ' active' : ''}`} title="White Balance Picker (W): click a neutral area" onClick={() => ui.set({ tool: tool === 'wb' ? null : 'wb' })}>
        <IconPicker size={16} />
      </button>
    </div>
  )
}

export function EditPanel() {
  const photoId = editor.use((s) => s.photoId)
  const view = ui.use((s) => s.view)
  const histogram = ui.use((s) => s.histogram)
  const allDefault = editor.use((s) => isDefault(Object.keys(s.params), s.params))
  if (!(view === 'detail' || view === 'compare') || !photoId)
    return (
      <>
        <div className="panel-head">Edit</div>
        <div className="panel-empty">
          <b>Grid view</b>
          Edit controls are available in the detail and compare views. Double-click a photo to open it.
        </div>
      </>
    )
  return (
    <>
      <div className="panel-head">
        Edit
        <span className="spacer" />
        <button className="icon-btn" title="Reset Edits (Ctrl+R)" disabled={allDefault} onClick={() => A.resetEdits()}>
          <IconReset size={16} />
        </button>
        <Dropdown
          className="icon-btn"
          label="⋯"
          align="right"
          items={() => [
            { label: 'Show Histogram', checked: ui.get().histogram, onClick: () => ui.set({ histogram: !ui.get().histogram }) },
            { label: 'Show Clipping', kbd: 'J', checked: ui.get().clip, onClick: () => ui.set({ clip: !ui.get().clip }) },
            { sep: true },
            { label: 'Copy Edit Settings', kbd: 'Ctrl+C', onClick: () => A.copySettings() },
            { label: 'Choose Settings to Copy …', onClick: () => ui.set({ dialog: 'copySettings' }) },
            { label: 'Paste Edit Settings', kbd: 'Ctrl+V', disabled: !A.hasClipboard(), onClick: () => A.pasteSettings() },
            { sep: true },
            { label: 'Reset Edits', kbd: 'Ctrl+R', onClick: () => A.resetEdits() },
          ]}
        />
      </div>
      <div className="panel-scroll">
        {histogram && <HistogramView photoId={photoId} />}
        <ProfileRow />
        <div style={{ height: 8 }} />
        <Section id="light" title="Light" keys={LIGHT_KEYS}>
          <PSlider def={S.exposure} />
          <PSlider def={S.contrast} />
          <div style={{ height: 6 }} />
          <PSlider def={S.highlights} />
          <PSlider def={S.shadows} />
          <PSlider def={S.whites} />
          <PSlider def={S.blacks} />
          <SubToggle id="curve" label="Curve">
            <CurveEditor />
          </SubToggle>
        </Section>
        <Section id="color" title="Color" keys={COLOR_KEYS}>
          <WhiteBalance />
          <PSlider def={S.temp} />
          <PSlider def={S.tint} />
          <div style={{ height: 6 }} />
          <PSlider def={S.vibrance} />
          <PSlider def={S.saturation} />
          <MixerToggle />
          <SubToggle id="pointcolor" label="Point Color">
            <PointColorControls />
          </SubToggle>
          <SubToggle id="grading" label="Color Grading">
            <ColorGrading />
          </SubToggle>
          <SubToggle id="calibration" label="Calibration">
            <CalibrationControls />
          </SubToggle>
        </Section>
        <Section id="effects" title="Effects" keys={EFFECT_KEYS}>
          <Effects />
        </Section>
        <Section id="detail" title="Detail" keys={DETAIL_KEYS}>
          <Detail />
        </Section>
        <Section id="optics" title="Optics" keys={OPTICS_KEYS}>
          <Optics />
        </Section>
        <Section id="lensblur" title="Lens Blur" keys={['lensBlur']}>
          <LensBlurControls />
        </Section>
        <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'center' }}>
          <button className="btn quiet small" disabled={allDefault} onClick={() => resetKeys(Object.keys(editor.get().params).filter((k) => k !== 'crop' && k !== 'version'), 'Reset Edits')}>
            Reset All Sliders
          </button>
        </div>
      </div>
    </>
  )
}
