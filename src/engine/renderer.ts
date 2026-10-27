// WebGL2 renderer: uploads a photo once, analyses it, and renders any Params in real time.
import { analyzeFor, estimateCA, type Analysis } from './analyze'
import { wbGains } from './color'
import { buildToneLut, LUT_SIZE, TONE_RANGE } from './curve'
import { curveIsLinear, type GradeWheel, type Params } from './params'
import { buildProfileLut, LUT_N, profileById } from './profiles'
import { FS_BOX, FS_COPY, FS_DENOISE, FS_DEVELOP, FS_GAUSS, FS_GFCOEF, FS_LENSBLUR, FS_LUM, FS_OUTPUT, VS } from './shaders'
import { aiKeyOf, makeMaskSource, MASK_SIDE, pruneBrushCache, rasterize, type MaskSource } from './masks'
import { aiMask, onAiMaskReady, requestAiMask } from '../ai/aimasks'
import { applySpots, type Spot } from './retouch'
import * as T from './transform'

interface Tex {
  tex: WebGLTexture
  fbo: WebGLFramebuffer | null
  w: number
  h: number
}

interface Prog {
  p: WebGLProgram
  u: Map<string, WebGLUniformLocation | null>
}

export interface OutputView {
  width: number
  height: number
  /** Canvas pixel (y down) → frame O (normalized). */
  viewToO: T.Mat3
  cropMode?: boolean
  clip?: boolean
  /** Set to false to hide the mask overlay (e.g. while exporting). */
  overlay?: boolean
  bg?: [number, number, number]
}

export interface Histogram {
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  l: Uint32Array
  clipLow: boolean
  clipHigh: boolean
}

const LOW_SIDE = 640

export class Renderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  readonly gl: WebGL2RenderingContext
  /** Size of the uploaded working image and of the original. */
  w = 0
  h = 0
  fullW = 0
  fullH = 0
  private progs = new Map<string, Prog>()
  private vao: WebGLVertexArrayObject
  private src?: Tex
  private lumT?: Tex
  private boxA?: Tex
  private boxB?: Tex
  private gfS?: Tex
  private gfL?: Tex
  private gauss1?: Tex
  private detail?: Tex
  private den?: Tex
  private dev?: Tex
  private haze?: Tex
  private tone: Tex
  private lut3d: WebGLTexture
  private lutProfile = ''
  private analysis?: Analysis
  private params?: Params
  private detailRadius = -1
  private denoiseKey = ''
  private developDirty = true
  private histFbo?: Tex
  /** Lateral chromatic aberration (red, blue scale offsets), measured on upload. */
  caScale: [number, number] = [0, 0]
  /** Photo id, so AI masks can be cached per photo. */
  photoId: string | null = null
  /** Called when something finished in the background (AI mask) and a redraw is needed. */
  onAsync: (() => void) | null = null
  /** Mask layer shown as a red overlay (-1 = none). */
  overlay = -1
  private maskTex: WebGLTexture
  private maskW = 1
  private maskH = 1
  private maskLayers = 0
  private maskKeys: string[] = []
  private maskSrc?: MaskSource
  private offAi: () => void
  /** Working-size copy of the original (retouching starts from it). */
  private orig?: HTMLCanvasElement
  private retouch: { key: string; spots: Spot[]; canvas: HTMLCanvasElement | null } = { key: '[]', spots: [], canvas: null }
  private retouchJob: Promise<void> | null = null
  private dev2?: Tex
  private depth?: Tex
  private depthKey = ''
  private lensOn = false

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true, alpha: true }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('This browser does not support WebGL2.')
    this.gl = gl
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('The graphics driver does not support floating-point render targets.')
    gl.getExtension('OES_texture_float_linear')
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    for (const [name, fs] of Object.entries({ lum: FS_LUM, box: FS_BOX, gf: FS_GFCOEF, gauss: FS_GAUSS, den: FS_DENOISE, dev: FS_DEVELOP, out: FS_OUTPUT, copy: FS_COPY, lens: FS_LENSBLUR })) {
      this.progs.set(name, this.compile(fs))
    }
    this.tone = this.texture(LUT_SIZE, 4, gl.R16F, gl.RED, gl.FLOAT, false)
    this.lut3d = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_3D, this.lut3d)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    this.maskTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTex)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, 1, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    this.offAi = onAiMaskReady(() => {
      this.developDirty = true
      this.onAsync?.()
    })
  }

  get maxTexture(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number
  }

  private compile(fs: string): Prog {
    const gl = this.gl
    const mk = (type: number, srcText: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, srcText)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s))
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p))
    return { p, u: new Map() }
  }

  private texture(w: number, h: number, internal: number, format: number, type: number, fbo = true, filter: number = this.gl.LINEAR): Tex {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    let f: WebGLFramebuffer | null = null
    if (fbo) {
      f = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
    return { tex, fbo: f, w, h }
  }

  private free(t?: Tex) {
    if (!t) return
    this.gl.deleteTexture(t.tex)
    if (t.fbo) this.gl.deleteFramebuffer(t.fbo)
  }

  dispose() {
    for (const t of [this.src, this.lumT, this.boxA, this.boxB, this.gfS, this.gfL, this.gauss1, this.detail, this.den, this.dev, this.dev2, this.depth, this.haze, this.histFbo, this.tone]) this.free(t)
    this.gl.deleteTexture(this.lut3d)
    this.gl.deleteTexture(this.maskTex)
    this.offAi()
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private use(name: string): Prog {
    const pr = this.progs.get(name)!
    this.gl.useProgram(pr.p)
    return pr
  }

  private loc(pr: Prog, name: string) {
    if (!pr.u.has(name)) pr.u.set(name, this.gl.getUniformLocation(pr.p, name))
    return pr.u.get(name) ?? null
  }

  private bindTex(pr: Prog, name: string, unit: number, t: WebGLTexture, target: number = this.gl.TEXTURE_2D) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(target, t)
    gl.uniform1i(this.loc(pr, name), unit)
  }

  private draw(target: Tex | null, w?: number, h?: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
    gl.viewport(0, 0, target ? target.w : w!, target ? target.h : h!)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Uploads a photo, scaled so its long side is at most `maxSide`. */
  setImage(img: ImageBitmap | HTMLCanvasElement | HTMLImageElement, fullW: number, fullH: number, maxSide: number) {
    const side = Math.min(maxSide, this.maxTexture)
    const s = Math.min(1, side / Math.max(fullW, fullH))
    const w = Math.max(1, Math.round(fullW * s))
    const h = Math.max(1, Math.round(fullH * s))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const cctx = c.getContext('2d', { willReadFrequently: true })!
    cctx.imageSmoothingQuality = 'high'
    cctx.drawImage(img, 0, 0, w, h)
    this.orig = c
    this.retouch = { key: '[]', spots: [], canvas: null }
    this.w = w
    this.h = h
    this.fullW = fullW
    this.fullH = fullH
    this.caScale = estimateCA(c, w, h)
    this.uploadSource(c)
    const ms = MASK_SIDE / Math.max(w, h)
    this.maskW = Math.max(4, Math.round(w * ms))
    this.maskH = Math.max(4, Math.round(h * ms))
    this.maskKeys = []
    this.maskLayers = 0
  }

  /** Uploads pixels as the source and recomputes all analysis (also after retouching). */
  private uploadSource(source: HTMLCanvasElement) {
    const gl = this.gl
    const w = this.w
    const h = this.h
    for (const t of [this.src, this.gauss1, this.detail, this.den, this.dev, this.dev2]) this.free(t)
    this.dev2 = undefined
    this.depthKey = ''
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.src = { tex, fbo: null, w, h }
    this.gauss1 = this.texture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
    this.detail = this.texture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
    this.dev = this.texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    gl.bindTexture(gl.TEXTURE_2D, this.dev.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    this.den = undefined
    this.analysis = analyzeFor(source, w, h)
    this.uploadHaze()
    this.buildBase()
    this.detailRadius = -1
    this.denoiseKey = ''
    this.developDirty = true
    this.maskSrc = undefined
    this.maskKeys = []
  }

  /** Brings the source in line with the params' retouch spots (runs in the background). */
  private syncRetouch(p: Params) {
    const key = JSON.stringify(p.spots)
    if (key === this.retouch.key || this.retouchJob || !this.orig) return
    if (!p.spots.length) {
      this.retouch = { key, spots: [], canvas: null }
      this.uploadSource(this.orig)
      return
    }
    const spots = p.spots
    // Reuse the previous result if the new spots only add to the old ones.
    const prev = this.retouch
    const prefix = prev.canvas && prev.spots.length <= spots.length && JSON.stringify(spots.slice(0, prev.spots.length)) === prev.key
    const work = document.createElement('canvas')
    work.width = this.w
    work.height = this.h
    work.getContext('2d', { willReadFrequently: true })!.drawImage(prefix ? prev.canvas! : this.orig, 0, 0)
    const todo = prefix ? spots.slice(prev.spots.length) : spots
    this.retouchJob = applySpots(work, todo)
      .then(() => {
        this.retouch = { key, spots, canvas: work }
        this.uploadSource(work)
        this.developDirty = true
      })
      .catch((e) => console.warn('Retouch failed', e))
      .finally(() => {
        this.retouchJob = null
        this.onAsync?.()
      })
  }

  /** True while retouching is computed in the background. */
  get retouching() {
    return !!this.retouchJob
  }

  /** Waits until the source shows all retouch spots of the params (for export). */
  async waitForRetouch() {
    for (let i = 0; i < 50 && this.params; i++) {
      if (this.retouchJob) await this.retouchJob
      else if (JSON.stringify(this.params.spots) !== this.retouch.key) this.syncRetouch(this.params)
      else return
    }
  }

  /** The photo as currently retouched (working size), for tools that need pixels. */
  workingCanvas(): HTMLCanvasElement | undefined {
    return this.retouch.canvas ?? this.orig
  }

  get hasImage() {
    return !!this.src
  }

  get info(): Analysis | undefined {
    return this.analysis
  }

  private uploadHaze() {
    const gl = this.gl
    const a = this.analysis!
    this.free(this.haze)
    this.haze = this.texture(a.haze.w, a.haze.h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, a.haze.w, a.haze.h, 0, gl.RED, gl.UNSIGNED_BYTE, a.haze.data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  }

  /** Edge-aware base layers (fast guided filter coefficients) at two radii. */
  private buildBase() {
    const gl = this.gl
    const s = Math.min(1, LOW_SIDE / Math.max(this.w, this.h))
    const lw = Math.max(8, Math.round(this.w * s))
    const lh = Math.max(8, Math.round(this.h * s))
    for (const t of [this.lumT, this.boxA, this.boxB, this.gfS, this.gfL]) this.free(t)
    const mk = () => this.texture(lw, lh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)
    this.lumT = mk()
    this.boxA = mk()
    this.boxB = mk()
    this.gfS = mk()
    this.gfL = mk()
    const pr = this.use('lum')
    this.bindTex(pr, 'uSrc', 0, this.src!.tex)
    this.draw(this.lumT)
    const side = Math.max(lw, lh)
    this.guided(Math.max(2, Math.round(side * 0.012)), 0.0007, this.gfS)
    this.guided(Math.max(4, Math.round(side * 0.04)), 0.0016, this.gfL)
  }

  private box(input: Tex, out: Tex, r: number) {
    const gl = this.gl
    const pr = this.use('box')
    gl.uniform1i(this.loc(pr, 'uR'), r)
    this.bindTex(pr, 'uTex', 0, input.tex)
    gl.uniform2f(this.loc(pr, 'uDir'), 1 / input.w, 0)
    this.draw(this.boxA!)
    this.bindTex(pr, 'uTex', 0, this.boxA!.tex)
    gl.uniform2f(this.loc(pr, 'uDir'), 0, 1 / input.h)
    this.draw(out)
  }

  private guided(r: number, eps: number, out: Tex) {
    const gl = this.gl
    this.box(this.lumT!, this.boxB!, r)
    const pr = this.use('gf')
    gl.uniform1f(this.loc(pr, 'uEps'), eps)
    this.bindTex(pr, 'uMean', 0, this.boxB!.tex)
    this.draw(out)
    // Smooth the coefficients in place via boxB.
    this.box(out, this.boxB!, r)
    this.copy(this.boxB!, out)
  }

  private copy(from: Tex, to: Tex) {
    const gl = this.gl
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.fbo)
    gl.blitFramebuffer(0, 0, from.w, from.h, 0, 0, to.w, to.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  }

  /** Scale of the working image relative to the original (1 = full resolution). */
  get workScale() {
    return this.w / this.fullW
  }

  private buildDetail(radius: number) {
    const gl = this.gl
    const ref = Math.max(this.w, this.h) / 3072
    const s1 = Math.max(0.7, 1.0 * ref)
    const s2 = Math.max(1.6, 3.2 * ref)
    const s3 = Math.max(0.5, radius * this.workScale)
    const taps = Math.min(48, Math.ceil(3 * Math.max(s1, s2, s3)))
    const pr = this.use('gauss')
    gl.uniform3f(this.loc(pr, 'uSigma'), s1, s2, s3)
    gl.uniform1i(this.loc(pr, 'uTaps'), taps)
    gl.uniform1i(this.loc(pr, 'uFromSrc'), 1)
    this.bindTex(pr, 'uTex', 0, this.src!.tex)
    gl.uniform2f(this.loc(pr, 'uDir'), 1 / this.w, 0)
    this.draw(this.gauss1!)
    gl.uniform1i(this.loc(pr, 'uFromSrc'), 0)
    this.bindTex(pr, 'uTex', 0, this.gauss1!.tex)
    gl.uniform2f(this.loc(pr, 'uDir'), 0, 1 / this.h)
    this.draw(this.detail!)
    this.detailRadius = radius
  }

  private buildDenoise(p: Params) {
    const gl = this.gl
    const n = p.noise
    if (!this.den) this.den = this.texture(this.w, this.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    const pr = this.use('den')
    this.bindTex(pr, 'uSrc', 0, this.src!.tex)
    gl.uniform2f(this.loc(pr, 'uPx'), 1 / this.w, 1 / this.h)
    gl.uniform1f(this.loc(pr, 'uLum'), n.luminance / 100)
    gl.uniform1f(this.loc(pr, 'uLumDetail'), n.detail / 100)
    gl.uniform1f(this.loc(pr, 'uLumContrast'), n.contrast / 100)
    gl.uniform1f(this.loc(pr, 'uCol'), n.color / 100)
    gl.uniform1f(this.loc(pr, 'uColDetail'), n.colorDetail / 100)
    gl.uniform1f(this.loc(pr, 'uColSmooth'), n.smoothness / 100)
    gl.uniform1f(this.loc(pr, 'uScale'), Math.max(0.5, Math.max(this.w, this.h) / 3072))
    this.draw(this.den)
  }

  setParams(p: Params) {
    this.params = p
    this.developDirty = true
  }

  private gradeVec(g: GradeWheel): [number, number, number] {
    // Wheel hue follows the HSV color circle shown in the UI; convert to an OkLab direction.
    const a = gradeDirs[Math.round(((g.hue % 360) + 360) % 360)]
    const s = (g.sat / 100) * 0.11
    return [a[0] * s, a[1] * s, (g.lum / 100) * 0.16]
  }

  private develop() {
    const gl = this.gl
    const p = this.params!
    this.syncRetouch(p)
    const a = this.analysis!
    if (this.detailRadius !== p.sharpen.radius) this.buildDetail(p.sharpen.radius)
    const useDen = p.noise.luminance > 0 || p.noise.color > 0
    const denKey = JSON.stringify(p.noise)
    if (useDen && denKey !== this.denoiseKey) {
      this.buildDenoise(p)
      this.denoiseKey = denKey
    }
    // Tone LUT
    gl.bindTexture(gl.TEXTURE_2D, this.tone.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, LUT_SIZE, 4, 0, gl.RED, gl.FLOAT, buildToneLut(p))
    // Profile LUT
    const prof = profileById(p.profile)
    if (this.lutProfile !== prof.id) {
      const data = buildProfileLut(prof.id)
      gl.bindTexture(gl.TEXTURE_3D, this.lut3d)
      if (data) gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, LUT_N, LUT_N, LUT_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
      this.lutProfile = prof.id
    }
    this.updateMasks(p)
    const pr = this.use('dev')
    const u = (n: string) => this.loc(pr, n)
    this.bindTex(pr, 'uMasks', 8, this.maskTex, gl.TEXTURE_2D_ARRAY)
    this.setLocalUniforms(pr, p)
    this.bindTex(pr, 'uSrc', 0, this.src!.tex)
    this.bindTex(pr, 'uDen', 1, (this.den ?? this.src!).tex)
    this.bindTex(pr, 'uDetail', 2, this.detail!.tex)
    this.bindTex(pr, 'uGfS', 3, this.gfS!.tex)
    this.bindTex(pr, 'uGfL', 4, this.gfL!.tex)
    this.bindTex(pr, 'uHaze', 5, this.haze!.tex)
    this.bindTex(pr, 'uTone', 6, this.tone.tex)
    this.bindTex(pr, 'uLut', 7, this.lut3d, gl.TEXTURE_3D)
    gl.uniform1i(u('uUseDen'), useDen ? 1 : 0)
    gl.uniform1i(u('uUseLut'), prof.fn ? 1 : 0)
    gl.uniform1f(u('uLutAmt'), p.profileAmount / 100)
    gl.uniform1f(u('uToneRange'), TONE_RANGE)
    const wb = wbGains(p.temp, p.tint)
    gl.uniform3f(u('uWB'), wb[0], wb[1], wb[2])
    gl.uniform1f(u('uExp'), p.exposure)
    gl.uniform1f(u('uHigh'), p.highlights / 100)
    gl.uniform1f(u('uShad'), p.shadows / 100)
    gl.uniform1f(u('uClarity'), p.clarity / 100)
    gl.uniform1f(u('uTexture'), p.texture / 100)
    gl.uniform1f(u('uDehaze'), p.dehaze / 100)
    gl.uniform3f(u('uAtmos'), a.haze.atmos[0], a.haze.atmos[1], a.haze.atmos[2])
    gl.uniform1f(u('uSharp'), p.sharpen.amount / 100)
    gl.uniform1f(u('uSharpDetail'), p.sharpen.detail / 100)
    gl.uniform1f(u('uSharpMask'), p.sharpen.masking / 100)
    gl.uniform1f(u('uEdgeScale'), (3072 / Math.max(this.w, this.h)) * 13)
    gl.uniform1f(u('uVib'), p.vibrance / 100)
    gl.uniform1f(u('uSat'), p.saturation / 100)
    const mixOn = [...p.mixHue, ...p.mixSat, ...p.mixLum].some((v) => v !== 0)
    gl.uniform1i(u('uMixOn'), mixOn ? 1 : 0)
    gl.uniform1fv(u('uMixH'), p.mixHue.map((v) => v / 100))
    gl.uniform1fv(u('uMixS'), p.mixSat.map((v) => v / 100))
    gl.uniform1fv(u('uMixL'), p.mixLum.map((v) => v / 100))
    const bw = p.bw || !!prof.bw
    gl.uniform1i(u('uBW'), bw ? 1 : 0)
    gl.uniform1fv(u('uGray'), p.grayMix.map((v) => v / 100))
    const g = p.grade
    const gradeOn = [g.shadows, g.midtones, g.highlights, g.global].some((w) => w.sat !== 0 || w.lum !== 0)
    gl.uniform1i(u('uGradeOn'), gradeOn ? 1 : 0)
    gl.uniform3fv(u('uGS'), this.gradeVec(g.shadows))
    gl.uniform3fv(u('uGM'), this.gradeVec(g.midtones))
    gl.uniform3fv(u('uGH'), this.gradeVec(g.highlights))
    gl.uniform3fv(u('uGG'), this.gradeVec(g.global))
    gl.uniform1f(u('uBlend'), g.blending / 100)
    gl.uniform1f(u('uBal'), g.balance / 100)
    const cal = p.calibration
    gl.uniform3f(u('uCalH'), cal.redHue / 100, cal.greenHue / 100, cal.blueHue / 100)
    gl.uniform3f(u('uCalS'), cal.redSat / 100, cal.greenSat / 100, cal.blueSat / 100)
    gl.uniform1f(u('uShadowTint'), p.calibration.shadowTint / 100)
    const pcs = p.pointColors.slice(0, 8)
    gl.uniform1i(u('uPCCount'), pcs.length)
    if (pcs.length) {
      gl.uniform3fv(u('uPCLab'), pcs.flatMap((x) => x.lab))
      gl.uniform4fv(u('uPCAdj'), pcs.flatMap((x) => [x.hue / 100, x.sat / 100, x.lum / 100, 0.03 + (x.range / 100) * 0.16]))
      gl.uniform1fv(u('uPCVar'), pcs.map((x) => x.variance / 100))
    }
    gl.uniform1f(u('uFringeP'), (p.optics.defringePurple / 20) * 1.4)
    gl.uniform1f(u('uFringeG'), (p.optics.defringeGreen / 20) * 1.4)
    const c = p.curve
    gl.uniform1i(u('uCurveRGB'), curveIsLinear(c.red) && curveIsLinear(c.green) && curveIsLinear(c.blue) ? 0 : 1)
    this.draw(this.dev!)
    // Mipmaps give smooth, moiré-free previews when the photo is shown smaller than the working size.
    gl.bindTexture(gl.TEXTURE_2D, this.dev!.tex)
    gl.generateMipmap(gl.TEXTURE_2D)
    this.lensOn = p.lensBlur.active && p.lensBlur.amount > 0
    if (this.lensOn) this.lensBlur(p)
    this.developDirty = false
  }

  /** Depth estimate: the subject is near, the background recedes toward the top. */
  private updateDepth() {
    const gl = this.gl
    const sub = this.aiFor('subject')
    const key = `${this.maskW}x${this.maskH}:${sub ? 1 : 0}`
    if (key === this.depthKey && this.depth) return
    const w = this.maskW
    const h = this.maskH
    const data = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      const bg = 0.45 + 0.55 * Math.pow(1 - y / (h - 1), 0.8)
      for (let x = 0; x < w; x++) {
        const s = sub ? sub[y * w + x] : 0
        data[y * w + x] = Math.round((bg * (1 - s) + 0.2 * s) * 255)
      }
    }
    if (!this.depth) this.depth = this.texture(w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, false)
    gl.bindTexture(gl.TEXTURE_2D, this.depth.tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    this.depth.w = w
    this.depth.h = h
    this.depthKey = key
    this.depthData = data
  }

  private depthData?: Uint8Array

  /** Depth (0 near … 1 far) at a source point, for the focus picker. */
  depthAt(sx: number, sy: number): number {
    this.updateDepth()
    const d = this.depthData!
    const x = Math.round(Math.min(1, Math.max(0, sx)) * (this.maskW - 1))
    const y = Math.round(Math.min(1, Math.max(0, sy)) * (this.maskH - 1))
    return d[y * this.maskW + x] / 255
  }

  private lensBlur(p: Params) {
    const gl = this.gl
    this.updateDepth()
    if (!this.dev2) this.dev2 = this.texture(this.w, this.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    const lb = p.lensBlur
    const pr = this.use('lens')
    const u = (n: string) => this.loc(pr, n)
    this.bindTex(pr, 'uDev', 0, this.dev!.tex)
    this.bindTex(pr, 'uDepth', 1, this.depth!.tex)
    gl.uniform2f(u('uPx'), 1 / this.w, 1 / this.h)
    gl.uniform1f(u('uFocus'), lb.focusX < 0 ? 0.2 : this.depthAt(lb.focusX, lb.focusY))
    gl.uniform1f(u('uRange'), 0.04 + (lb.range / 100) * 0.7)
    gl.uniform1f(u('uMaxR'), (lb.amount / 100) * 0.028 * Math.max(this.w, this.h))
    gl.uniform1f(u('uBoost'), lb.boost / 100)
    gl.uniform1f(u('uCatEye'), lb.catEye / 100)
    gl.uniform1f(u('uAspect'), this.w / this.h)
    gl.uniform1i(u('uShape'), ['circle', 'bubble', 'blade', 'ring', 'cateye'].indexOf(lb.bokeh))
    this.draw(this.dev2)
  }

  /** The photo at mask resolution, read back from the GPU (lazily). */
  maskSource(): MaskSource {
    if (this.maskSrc) return this.maskSrc
    const gl = this.gl
    const t = this.texture(this.maskW, this.maskH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    const pr = this.use('copy')
    this.bindTex(pr, 'uSrc', 0, this.src!.tex)
    this.draw(t)
    const buf = new Uint8ClampedArray(this.maskW * this.maskH * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.readPixels(0, 0, this.maskW, this.maskH, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.free(t)
    this.maskSrc = makeMaskSource(buf, this.maskW, this.maskH)
    return this.maskSrc
  }

  /** Mask coverage at mask resolution (for tools, e.g. showing a selection). */
  maskSize(): [number, number] {
    return [this.maskW, this.maskH]
  }

  private aiFor(key: Parameters<typeof aiMask>[1]): Float32Array | undefined {
    if (!this.photoId) return undefined
    const got = aiMask(this.photoId, key, this.maskW, this.maskH)
    if (!got) void requestAiMask(this.photoId, key, this.maskSource())
    return got
  }

  /** Re-rasterizes changed masks and uploads them as texture layers. */
  private updateMasks(p: Params) {
    const gl = this.gl
    const masks = p.masks.slice(0, 16)
    if (!masks.length && !this.maskLayers) return
    const keys = masks.map((m) => {
      const ai = m.comps.map((c) => {
        const k = aiKeyOf(c)
        return k && this.photoId ? (aiMask(this.photoId, k, this.maskW, this.maskH) ? 1 : 0) : ''
      })
      return JSON.stringify([m.invert, m.comps, ai])
    })
    const layers = Math.max(1, masks.length)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (layers !== this.maskLayers) {
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, this.maskW, this.maskH, layers, 0, gl.RED, gl.UNSIGNED_BYTE, null)
      this.maskKeys = []
      this.maskLayers = layers
    }
    const src = masks.length ? this.maskSource() : null
    for (let i = 0; i < masks.length; i++) {
      if (this.maskKeys[i] === keys[i]) continue
      const cov = rasterize(masks[i], src!, (k) => this.aiFor(k))
      const bytes = new Uint8Array(cov.length)
      for (let j = 0; j < cov.length; j++) bytes[j] = Math.round(Math.min(1, Math.max(0, cov[j])) * 255)
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, this.maskW, this.maskH, 1, gl.RED, gl.UNSIGNED_BYTE, bytes)
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    this.maskKeys = keys
    pruneBrushCache(new Set(masks.flatMap((m) => m.comps.map((c) => c.id))))
  }

  private setLocalUniforms(pr: Prog, p: Params) {
    const gl = this.gl
    const masks = p.masks.slice(0, 16)
    const A = new Float32Array(64)
    const B = new Float32Array(64)
    const C = new Float32Array(64)
    const D = new Float32Array(64)
    const Col = new Float32Array(32)
    masks.forEach((m, i) => {
      const k = m.visible ? m.amount / 100 : 0
      const a = m.adj
      A.set([a.exposure * k, (a.contrast / 100) * k, (a.highlights / 100) * k, (a.shadows / 100) * k], i * 4)
      B.set([(a.whites / 100) * k, (a.blacks / 100) * k, (a.temp / 100) * k, (a.tint / 100) * k], i * 4)
      C.set([(a.texture / 100) * k, (a.clarity / 100) * k, (a.dehaze / 100) * k, (a.saturation / 100) * k], i * 4)
      D.set([(a.sharpness / 100) * k, (a.noise / 100) * k, (a.hue / 100) * k, 0], i * 4)
      const dir = gradeDirs[Math.round(((a.colorHue % 360) + 360) % 360)]
      const s = (a.colorSat / 100) * 0.12 * k
      Col.set([dir[0] * s, dir[1] * s], i * 2)
    })
    gl.uniform1i(this.loc(pr, 'uMaskCount'), masks.length)
    gl.uniform4fv(this.loc(pr, 'uLA'), A)
    gl.uniform4fv(this.loc(pr, 'uLB'), B)
    gl.uniform4fv(this.loc(pr, 'uLC'), C)
    gl.uniform4fv(this.loc(pr, 'uLD'), D)
    gl.uniform2fv(this.loc(pr, 'uLCol'), Col)
  }

  /** Waits until all AI masks used by the params are computed (for export). */
  async waitForAi() {
    if (!this.params || !this.photoId) return
    const keys = new Set(this.params.masks.flatMap((m) => m.comps.map(aiKeyOf).filter(Boolean)))
    if (this.params.lensBlur.active) keys.add('subject')
    const src = keys.size ? this.maskSource() : null
    for (const k of keys) await requestAiMask(this.photoId, k!, src!)
    this.developDirty = true
  }

  /** Oriented size of the original in pixels. */
  orientedSize(p: Params = this.params!): [number, number] {
    return T.orientedSize(this.fullW, this.fullH, p.crop.rot90)
  }

  /** Draws the result (to the canvas, or into `target`). */
  render(view: OutputView, target?: Tex) {
    if (!this.src || !this.params) return
    if (this.developDirty) this.develop()
    const gl = this.gl
    const p = this.params
    const [ow, oh] = this.orientedSize()
    const pr = this.use('out')
    const u = (n: string) => this.loc(pr, n)
    this.bindTex(pr, 'uDev', 0, (this.lensOn && this.dev2 ? this.dev2 : this.dev!).tex)
    this.bindTex(pr, 'uMasks', 1, this.maskTex, gl.TEXTURE_2D_ARRAY)
    gl.uniform1i(u('uOverlay'), this.overlay < this.maskLayers && view.overlay !== false ? this.overlay : -1)
    gl.uniform3f(u('uOverlayColor'), 1, 0.16, 0.2)
    gl.uniformMatrix3fv(u('uViewToO'), true, view.viewToO)
    gl.uniformMatrix3fv(u('uOtoG'), true, T.frameToOriented(p.crop, ow, oh))
    gl.uniformMatrix3fv(u('uGtoS'), true, T.orientToSource(p.crop))
    const geo = T.geometryUniforms({ ...p.geometry, distortion: p.geometry.distortion + p.optics.distortion }, ow / oh)
    const ca = p.optics.removeCA ? this.caScale : [0, 0]
    gl.uniform2f(u('uCA'), ca[0], ca[1])
    gl.uniform1f(u('uLensVig'), (p.optics.vignetting / 100) * 0.9)
    gl.uniform1f(u('uSrcAspect'), this.fullW / this.fullH)
    gl.uniform1i(u('uGeoOn'), geo.active ? 1 : 0)
    gl.uniformMatrix3fv(u('uGeoH'), true, geo.h)
    gl.uniform1f(u('uGeoK'), geo.k1)
    gl.uniform1f(u('uGeoAspect'), ow / oh)
    const cr = p.crop
    gl.uniform4f(u('uCrop'), cr.x, cr.y, cr.w, cr.h)
    gl.uniform1i(u('uCropMode'), view.cropMode ? 1 : 0)
    gl.uniform1i(u('uClip'), view.clip ? 1 : 0)
    gl.uniform2f(u('uCanvas'), view.width, view.height)
    const bg = view.bg ?? [0.106, 0.106, 0.106]
    gl.uniform3f(u('uBg'), bg[0], bg[1], bg[2])
    const v = p.vignette
    gl.uniform1f(u('uVigAmt'), v.amount / 100)
    gl.uniform1f(u('uVigMid'), v.midpoint / 100)
    gl.uniform1f(u('uVigRound'), v.roundness / 100)
    gl.uniform1f(u('uVigFeather'), v.feather / 100)
    gl.uniform1f(u('uVigHigh'), v.highlights / 100)
    gl.uniform1f(u('uCropAspect'), (cr.w * ow) / (cr.h * oh))
    const gr = p.grain
    gl.uniform1f(u('uGrainAmt'), gr.amount / 100)
    gl.uniform1f(u('uGrainRough'), gr.roughness / 100)
    const cell = 0.9 + (gr.size / 100) * 3.2
    const cells = 2400 / cell
    const long = Math.max(ow, oh)
    gl.uniform2f(u('uGrainCells'), (cells * ow) / long, (cells * oh) / long)
    if (target) this.draw(target)
    else this.draw(null, view.width, view.height)
  }

  /** Canvas → frame matrix that fits the crop into a w×h box, centered. */
  fitView(w: number, h: number, p: Params = this.params!, margin = 0): T.Mat3 {
    const [ow, oh] = this.orientedSize(p)
    const cw = p.crop.w * ow
    const ch = p.crop.h * oh
    const z = Math.min((w - margin * 2) / cw, (h - margin * 2) / ch)
    // canvas px → crop px → frame normalized
    const m = T.mul(T.translate(cw / 2, ch / 2), T.mul(T.scale(1 / z, 1 / z), T.translate(-w / 2, -h / 2)))
    return T.mul(T.mul(T.translate(p.crop.x, p.crop.y), T.scale(1 / ow, 1 / oh)), m)
  }

  /** Renders the crop at w×h and reads it back as RGBA (top row first). */
  readPixels(w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl
    const t = this.texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    this.render({ width: w, height: h, viewToO: this.fitView(w, h), overlay: false }, t)
    const buf = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.free(t)
    // GL rows are bottom-up; our output pass already maps y down, so row 0 is the bottom of the image.
    const out = new Uint8ClampedArray(w * h * 4)
    const row = w * 4
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row)
    return out
  }

  /** Histogram of the current result. */
  histogram(): Histogram | null {
    if (!this.src || !this.params) return null
    const [ow, oh] = this.orientedSize()
    const cw = this.params.crop.w * ow
    const ch = this.params.crop.h * oh
    const s = 220 / Math.max(cw, ch)
    const w = Math.max(1, Math.round(cw * s))
    const h = Math.max(1, Math.round(ch * s))
    const px = this.readPixels(w, h)
    const r = new Uint32Array(256)
    const g = new Uint32Array(256)
    const b = new Uint32Array(256)
    const l = new Uint32Array(256)
    let lo = 0
    let hi = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue
      r[px[i]]++
      g[px[i + 1]]++
      b[px[i + 2]]++
      l[Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++
      if (px[i] <= 1 && px[i + 1] <= 1 && px[i + 2] <= 1) lo++
      if (px[i] >= 254 || px[i + 1] >= 254 || px[i + 2] >= 254) hi++
    }
    const n = w * h
    return { r, g, b, l, clipLow: lo > n * 0.0005, clipHigh: hi > n * 0.0005 }
  }
}

/** OkLab (a, b) unit directions for HSV hues 0..360. */
const gradeDirs: [number, number][] = Array.from({ length: 361 }, (_, deg) => {
  const h = deg / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
  const lin = [r, g, b].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2])
  const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2])
  const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2])
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const len = Math.hypot(A, B) || 1
  return [A / len, B / len]
})
