// GLSL ES 3.00 sources for the renderer passes.

export const VS = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const COMMON = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float LOGMIN = -12.0;
const float LOGRANGE = 13.0;
float toV(float y) { return (log2(max(y, 1.0 / 4096.0)) - LOGMIN) / LOGRANGE; }
float fromV(float v) { return exp2(v * LOGRANGE + LOGMIN); }
vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float s2l1(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float l2s1(float c) { c = max(c, 0.0); return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
float srcV(vec3 s) { return toV(dot(s2l(s), LUMA)); }
vec3 lin2lab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = sign(l) * pow(abs(l), 1.0 / 3.0);
  m = sign(m) * pow(abs(m), 1.0 / 3.0);
  s = sign(s) * pow(abs(s), 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 lab2lin(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
             -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
             -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
`

const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 o;
${COMMON}
`

/** Log luminance and its square, written at low resolution (guided filter input). */
export const FS_LUM = HEAD + /* glsl */ `
uniform sampler2D uSrc;
void main() {
  float v = srcV(texture(uSrc, vUv).rgb);
  o = vec4(v, v * v, 0.0, 1.0);
}`

export const FS_BOX = HEAD + /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uDir;
uniform int uR;
void main() {
  vec4 s = vec4(0.0);
  for (int i = -40; i <= 40; i++) {
    if (i < -uR || i > uR) continue;
    s += texture(uTex, vUv + uDir * float(i));
  }
  o = s / float(2 * uR + 1);
}`

export const FS_GFCOEF = HEAD + /* glsl */ `
uniform sampler2D uMean;
uniform float uEps;
void main() {
  vec2 m = texture(uMean, vUv).rg;
  float v = max(m.y - m.x * m.x, 0.0);
  float a = v / (v + uEps);
  o = vec4(a, m.x - a * m.x, 0.0, 1.0);
}`

/** Separable Gaussian with three widths at once: R fine, G mid, B sharpening radius; A = unblurred. */
export const FS_GAUSS = HEAD + /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uDir;
uniform vec3 uSigma;
uniform int uFromSrc;
uniform int uTaps;
void main() {
  vec3 acc = vec3(0.0);
  vec3 ws = vec3(0.0);
  for (int i = -48; i <= 48; i++) {
    if (i < -uTaps || i > uTaps) continue;
    float x = float(i);
    vec3 w = exp(-0.5 * x * x / (uSigma * uSigma));
    vec2 uv = vUv + uDir * x;
    vec3 v = uFromSrc == 1 ? vec3(srcV(texture(uTex, uv).rgb)) : texture(uTex, uv).rgb;
    acc += w * v;
    ws += w;
  }
  float c = uFromSrc == 1 ? srcV(texture(uTex, vUv).rgb) : texture(uTex, vUv).a;
  o = vec4(acc / ws, c);
}`

/** Edge-preserving luminance smoothing plus wide chroma smoothing (noise reduction). */
export const FS_DENOISE = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uPx;
uniform float uLum, uLumDetail, uLumContrast, uCol, uColDetail, uColSmooth, uScale;
void main() {
  vec4 src = texture(uSrc, vUv);
  vec3 lab0 = lin2lab(s2l(src.rgb));
  vec3 lab = lab0;
  if (uLum > 0.0) {
    float step = mix(0.7, 1.6, uLum) * uScale;
    float sr = mix(0.018, 0.075, uLum) * mix(1.5, 0.45, uLumDetail);
    float acc = 0.0, wsum = 0.0;
    for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
      vec2 off = vec2(float(i), float(j));
      float L = lin2lab(s2l(texture(uSrc, vUv + off * uPx * step).rgb)).x;
      float d = L - lab0.x;
      float w = exp(-dot(off, off) / 8.0 - d * d / (2.0 * sr * sr));
      acc += w * L;
      wsum += w;
    }
    float Ls = acc / wsum;
    // Contrast slider brings back some local contrast.
    lab.x = mix(Ls, lab0.x, uLumContrast * 0.5);
  }
  if (uCol > 0.0) {
    float step = mix(1.0, 4.5, uCol) * mix(1.4, 0.6, uColDetail) * uScale;
    vec2 acc = vec2(0.0);
    float wsum = 0.0;
    for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
      vec2 off = vec2(float(i), float(j));
      vec3 c = lin2lab(s2l(texture(uSrc, vUv + off * uPx * step).rgb));
      float d = c.x - lab0.x;
      float w = exp(-dot(off, off) / mix(6.0, 18.0, uColSmooth) - d * d / 0.02);
      acc += w * c.yz;
      wsum += w;
    }
    lab.yz = mix(lab0.yz, acc / wsum, min(1.0, uCol * 1.6));
  }
  o = vec4(l2s(lab2lin(lab)), src.a);
}`

/** Main develop pass: all global adjustments, in source space. */
export const FS_DEVELOP = HEAD + /* glsl */ `
precision highp sampler3D;
precision highp sampler2DArray;
uniform sampler2D uSrc, uDen, uDetail, uGfS, uGfL, uHaze, uTone;
uniform sampler3D uLut;
uniform sampler2DArray uMasks;
uniform int uMaskCount;
uniform vec4 uLA[16]; // exposure (EV), contrast, highlights, shadows
uniform vec4 uLB[16]; // whites, blacks, temp, tint
uniform vec4 uLC[16]; // texture, clarity, dehaze, saturation
uniform vec4 uLD[16]; // sharpness, noise, hue, unused
uniform vec2 uLCol[16]; // colorize (OkLab a, b)
uniform int uUseDen, uUseLut, uCurveRGB, uMixOn, uBW, uGradeOn;
uniform float uLutAmt;
uniform vec3 uWB;
uniform float uExp, uHigh, uShad, uClarity, uTexture, uDehaze;
uniform vec3 uAtmos;
uniform float uSharp, uSharpDetail, uSharpMask, uEdgeScale;
uniform float uVib, uSat;
uniform float uMixH[8];
uniform float uMixS[8];
uniform float uMixL[8];
uniform float uGray[8];
uniform vec3 uGS, uGM, uGH, uGG;
uniform float uBlend, uBal;
uniform float uToneRange;
uniform float uFringeP, uFringeG;
uniform vec3 uCalH;
uniform vec3 uCalS;
uniform float uShadowTint;
uniform int uPCCount;
uniform vec3 uPCLab[8];
uniform vec4 uPCAdj[8]; // hue, sat, lum (-1..1), radius
uniform float uPCVar[8];

const float HC[8] = float[8](25.0, 55.0, 100.0, 140.0, 195.0, 255.0, 295.0, 335.0);
const float LUTN = 1024.0;

float lutRow(float row, float x) {
  return texture(uTone, vec2((clamp(x, 0.0, 1.0) * (LUTN - 1.0) + 0.5) / LUTN, (row + 0.5) / 4.0)).r;
}
float lutMaster(float x) {
  float t = x / uToneRange;
  if (t > 1.0) return lutRow(0.0, 1.0) + (x - uToneRange);
  return lutRow(0.0, t);
}

void hueWeights(float h, out float w[8]) {
  for (int i = 0; i < 8; i++) w[i] = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = HC[i];
    float b = HC[(i + 1) % 8];
    if (b < a) b += 360.0;
    float x = h < a ? h + 360.0 : h;
    if (x >= a && x < b) {
      float t = (x - a) / (b - a);
      t = t * t * (3.0 - 2.0 * t);
      w[i] = 1.0 - t;
      w[(i + 1) % 8] = t;
      return;
    }
  }
}

bool inGamut(vec3 c) { return all(greaterThanEqual(c, vec3(-0.001))) && all(lessThanEqual(c, vec3(1.001))); }

// Contrast/whites/blacks for local corrections (same shapes as the global tone LUT).
float localTone(float x, float c, float w, float b) {
  x += b * 0.1 * pow(1.0 - clamp(x, 0.0, 1.0), 4.0);
  x += w * (w > 0.0 ? 0.18 : 0.15) * pow(clamp(x, 0.0, 1.0), w > 0.0 ? 2.6 : 3.2);
  float s = c >= 0.0 ? 1.0 + c * 0.6 : 1.0 + c * 0.4;
  float p = 0.46;
  x = clamp(x, 0.0, 1.0);
  if (s != 1.0) x = x < p ? p * pow(x / p, s) : 1.0 - (1.0 - p) * pow((1.0 - x) / (1.0 - p), s);
  return x;
}

void main() {
  vec2 uv = vUv;
  vec4 srcA = texture(uSrc, uv);
  vec3 s = uUseDen == 1 ? texture(uDen, uv).rgb : srcA.rgb;
  vec3 lin = s2l(s);
  float vs = srcV(srcA.rgb);
  vec4 dt = texture(uDetail, uv);
  // Derivatives must be taken in uniform control flow.
  float edge = length(vec2(dFdx(dt.g), dFdy(dt.g))) * uEdgeScale;

  // Sum of local corrections weighted by each mask's coverage.
  vec4 LA = vec4(0.0), LB = vec4(0.0), LC = vec4(0.0), LD = vec4(0.0);
  vec2 LCol = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uMaskCount) break;
    float m = texture(uMasks, vec3(uv, float(i))).r;
    if (m < 0.002) continue;
    LA += m * uLA[i];
    LB += m * uLB[i];
    LC += m * uLC[i];
    LD += m * uLD[i];
    LCol += m * uLCol[i];
  }

  float dehaze = uDehaze + LC.z;
  if (dehaze != 0.0) {
    float D = texture(uHaze, uv).r;
    if (dehaze > 0.0) {
      float t = max(1.0 - 0.95 * min(dehaze, 1.0) * D, 0.15);
      lin = max((lin - uAtmos) / t + uAtmos, 0.0);
    } else {
      lin = mix(lin, uAtmos, min(-dehaze, 1.0) * 0.6 * (0.45 + 0.55 * D));
    }
  }

  // Local white balance as relative channel gains (luminance kept).
  vec3 lwb = vec3(exp2(LB.z * 0.32), exp2(-LB.w * 0.28), exp2(-LB.z * 0.32));
  lwb /= dot(lwb, LUMA);
  lin *= uWB * lwb * exp2(uExp + LA.x);
  float Y = max(dot(lin, LUMA), 1e-7);
  float v = toV(Y);
  float shift = v - vs;

  // Local tone: shadows/highlights move the edge-aware base, detail rides on top.
  vec2 gl = texture(uGfL, uv).rg;
  vec2 gs = texture(uGfS, uv).rg;
  float bL = gl.x * vs + gl.y + shift;
  float xb = l2s1(fromV(bL));
  float shad = uShad + LA.w;
  float high = uHigh + LA.z;
  float gain = 0.0;
  if (shad != 0.0) gain += shad * (shad > 0.0 ? 1.7 : 1.45) * pow(1.0 - smoothstep(0.0, 0.55, xb), 1.3);
  if (high != 0.0) {
    // Above display white the weight keeps growing, so overexposed areas can be recovered.
    float wh = smoothstep(0.4, 1.0, xb) + max(0.0, xb - 1.0) * 1.5;
    gain += high * (high < 0.0 ? 0.65 : 0.35) * (high < 0.0 ? wh : min(wh, 1.0));
  }
  float vo = v + gain / LOGRANGE;

  float clarity = uClarity + LC.y;
  if (clarity != 0.0) {
    float d = vs - (gs.x * vs + gs.y);
    float xm = l2s1(fromV(vo));
    float mid = 1.0 - pow(abs(2.0 * clamp(xm, 0.0, 1.0) - 1.0), 2.0);
    vo += clarity * (clarity > 0.0 ? 1.75 * mix(0.35, 1.0, mid) : 0.9) * d;
  }

  float texAmt = uTexture + LC.x;
  if (texAmt != 0.0) {
    float band = texAmt > 0.0 ? (dt.a - dt.g) - 0.65 * (dt.a - dt.r) : (dt.a - dt.g);
    vo += texAmt * (texAmt > 0.0 ? 1.5 : 0.9) * band;
  }
  float sharp = uSharp + LD.x;
  if (sharp > 0.0) {
    float d = dt.a - dt.b;
    float lim = mix(0.006, 0.06, uSharpDetail);
    d = d * lim / (abs(d) + lim);
    float m = uSharpMask > 0.0 ? smoothstep(uSharpMask * 0.012, uSharpMask * 0.012 + 0.006, edge) : 1.0;
    vo += sharp * 1.8 * d * m;
  } else if (sharp < 0.0) {
    vo -= (dt.a - dt.g) * min(1.0, -sharp);
  }
  // Local noise reduction: pull fine luminance detail toward its smooth version.
  if (LD.y > 0.0) vo -= (dt.a - dt.r) * min(1.0, LD.y) * 0.9;

  float Yo = fromV(vo);
  lin *= Yo / Y;

  // Global tone curve (whites, blacks, contrast, curves) on display values.
  vec3 d = l2s(lin);
  float yd = l2s1(Yo);
  float yd2 = lutMaster(yd);
  if (LA.y != 0.0 || LB.x != 0.0 || LB.y != 0.0) yd2 = localTone(yd2, LA.y, LB.x, LB.y);
  vec3 dr = l2s(lin * (s2l1(max(yd2, 0.0)) / max(Yo, 1e-7)));
  vec3 dc = vec3(lutMaster(d.r), lutMaster(d.g), lutMaster(d.b));
  d = mix(dr, dc, 0.35);
  if (uCurveRGB == 1) d = vec3(lutRow(1.0, d.r), lutRow(2.0, d.g), lutRow(3.0, d.b));
  d = clamp(d, 0.0, 1.0);
  if (uShadowTint != 0.0) {
    // Calibration shadow tint: green ↔ magenta in the shadows.
    float sw = 1.0 - smoothstep(0.0, 0.5, dot(d, LUMA));
    d.g = clamp(d.g - uShadowTint * 0.08 * sw, 0.0, 1.0);
  }

  // Color in OkLab / OkLCh.
  vec3 lab = lin2lab(s2l(d));
  float L = lab.x;
  float C = length(lab.yz);
  float h = degrees(atan(lab.z, lab.y));
  if (h < 0.0) h += 360.0;
  float cw = smoothstep(0.0, 0.035, C);
  float w[8];
  hueWeights(h, w);

  if (uMixOn == 1) {
    float dh = 0.0, ds = 0.0, dl = 0.0;
    for (int i = 0; i < 8; i++) { dh += w[i] * uMixH[i]; ds += w[i] * uMixS[i]; dl += w[i] * uMixL[i]; }
    h += dh * 30.0 * cw;
    C *= max(0.0, 1.0 + (ds > 0.0 ? ds * 0.9 / (1.0 + ds * C * 2.5) : ds));
    L += dl * 0.2 * cw * min(1.0, C / 0.1) * (dl > 0.0 ? (1.0 - L) * 1.6 : L * 1.2);
  }
  // Point color: adjust colors close to a sampled color.
  for (int i = 0; i < 8; i++) {
    if (i >= uPCCount) break;
    vec3 t = uPCLab[i];
    vec2 abNow = C * vec2(cos(radians(h)), sin(radians(h)));
    float dist = sqrt((L - t.x) * (L - t.x) * 0.3 + dot(abNow - t.yz, abNow - t.yz));
    float rad = uPCAdj[i].w;
    float wgt = 1.0 - smoothstep(rad * (0.35 + 0.3 * uPCVar[i]), rad, dist);
    if (wgt <= 0.0) continue;
    h += uPCAdj[i].x * 45.0 * wgt;
    C *= max(0.0, 1.0 + uPCAdj[i].y * wgt);
    L += uPCAdj[i].z * 0.22 * wgt * (uPCAdj[i].z > 0.0 ? 1.0 - L : L);
  }
  if (uCalH != vec3(0.0) || uCalS != vec3(0.0)) {
    // Calibration: broad red/green/blue primaries (OkLCh hue 29°, 142°, 264°).
    vec3 dd = abs(mod(vec3(h) - vec3(29.0, 142.0, 264.0) + 180.0, 360.0) - 180.0);
    vec3 cwt = max(vec3(0.0), 1.0 - dd / 120.0);
    cwt = cwt * cwt * (3.0 - 2.0 * cwt);
    h += dot(cwt, uCalH) * 25.0 * cw;
    C *= max(0.0, 1.0 + dot(cwt, uCalS) * 0.6);
  }
  h += LD.z * 40.0 * cw;
  if (uVib != 0.0) {
    // Muted colors gain most; skin tones (OkLCh hue ~30-75 deg) are protected.
    float skin = exp(-pow((h - 48.0) / 30.0, 2.0)) * smoothstep(0.02, 0.06, C);
    float lowSat = 1.0 - smoothstep(0.03, 0.2, C);
    float k = uVib > 0.0 ? uVib * 0.95 * lowSat * (1.0 - 0.78 * skin) : uVib * 0.55 * (1.0 - 0.3 * smoothstep(0.0, 0.2, C));
    C *= max(0.0, 1.0 + k);
  }
  float sat = uSat + LC.w;
  if (sat != 0.0) C *= max(0.0, 1.0 + (sat > 0.0 ? sat * 0.85 / (1.0 + sat * C * 3.0) : max(sat, -1.0)));
  if (uBW == 1) {
    float g = L;
    for (int i = 0; i < 8; i++) g += w[i] * uGray[i] * 0.28 * cw * min(1.0, C / 0.1);
    L = clamp(g, 0.0, 1.0);
    C = 0.0;
  }
  if (uFringeP > 0.0 || uFringeG > 0.0) {
    // Defringe: remove purple/green color at strong edges.
    float e = clamp(edge * 12.0, 0.0, 1.0);
    float hp = exp(-pow((h - 315.0) / 28.0, 2.0)) + exp(-pow((h + 45.0) / 28.0, 2.0));
    float hg = exp(-pow((h - 145.0) / 25.0, 2.0));
    C *= 1.0 - e * min(1.0, uFringeP * hp + uFringeG * hg);
  }
  vec2 ab = C * vec2(cos(radians(h)), sin(radians(h)));
  if (uGradeOn == 1) {
    float pivot = 0.5 - uBal * 0.3;
    float wd = mix(0.12, 0.55, uBlend);
    float wS = 1.0 - smoothstep(pivot - wd, pivot + wd * 0.3, L);
    float wH = smoothstep(pivot - wd * 0.3, pivot + wd, L);
    float wM = max(0.0, 1.0 - abs(L - pivot) / (wd * 1.4));
    wM = wM * wM * (3.0 - 2.0 * wM);
    ab += uGS.xy * wS + uGM.xy * wM + uGH.xy * wH + uGG.xy;
    L += uGS.z * wS + uGM.z * wM + uGH.z * wH + uGG.z;
  }
  ab += LCol;

  vec3 rgb = lab2lin(vec3(L, ab));
  if (!inGamut(rgb) && L > 0.0 && L < 1.0) {
    float lo = 0.0, hi = 1.0;
    for (int k = 0; k < 7; k++) {
      float m = (lo + hi) * 0.5;
      if (inGamut(lab2lin(vec3(L, ab * m)))) lo = m; else hi = m;
    }
    rgb = lab2lin(vec3(L, ab * lo));
  }
  vec3 outc = clamp(l2s(rgb), 0.0, 1.0);
  if (uUseLut == 1) {
    vec3 lc = texture(uLut, outc * (32.0 / 33.0) + 0.5 / 33.0).rgb;
    outc = clamp(mix(outc, lc, uLutAmt), 0.0, 1.0);
  }
  o = vec4(outc, srcA.a);
}`

/** Output pass: crop, straighten, orientation, geometry, vignette, grain, clipping. */
export const FS_OUTPUT = HEAD + /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D uDev;
uniform mat3 uViewToO, uOtoG, uGtoS, uGeoH;
uniform int uGeoOn, uCropMode, uClip;
uniform float uGeoK, uGeoAspect;
uniform vec4 uCrop;
uniform vec2 uCanvas;
uniform vec3 uBg;
uniform float uVigAmt, uVigMid, uVigRound, uVigFeather, uVigHigh, uCropAspect;
uniform float uGrainAmt, uGrainSize, uGrainRough;
uniform vec2 uGrainCells;
uniform vec2 uCA;
uniform float uLensVig;
uniform float uSrcAspect;
uniform highp sampler2DArray uMasks;
uniform int uOverlay;
uniform vec3 uOverlayColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uCanvas;
  vec3 oh = uViewToO * vec3(px, 1.0);
  vec2 O = oh.xy / oh.z;
  vec2 q = (O - uCrop.xy) / uCrop.zw;
  bool inCrop = all(greaterThanEqual(q, vec2(0.0))) && all(lessThanEqual(q, vec2(1.0)));
  if (uCropMode == 0 && !inCrop) { o = vec4(uBg, 1.0); return; }
  vec2 G = (uOtoG * vec3(O, 1.0)).xy;
  if (uGeoOn == 1) {
    vec2 gc = (G - 0.5) * vec2(uGeoAspect, 1.0);
    vec3 hh = uGeoH * vec3(gc, 1.0);
    gc = hh.xy / hh.z;
    gc *= 1.0 + uGeoK * dot(gc, gc) / (0.25 * (uGeoAspect * uGeoAspect + 1.0));
    G = gc / vec2(uGeoAspect, 1.0) + 0.5;
  }
  vec2 S = (uGtoS * vec3(G, 1.0)).xy;
  bool inImg = all(greaterThanEqual(S, vec2(0.0))) && all(lessThanEqual(S, vec2(1.0)));
  if (!inImg) {
    vec3 bg = uCropMode == 1 ? uBg : vec3(1.0);
    o = vec4(uCropMode == 1 && !inCrop ? bg * 0.7 : bg, uCropMode == 1 ? 1.0 : 0.0);
    return;
  }
  vec4 c = texture(uDev, S);
  vec3 col = c.rgb;
  if (uCA.x != 0.0 || uCA.y != 0.0) {
    // Lateral chromatic aberration: scale red and blue about the optical center.
    col.r = texture(uDev, (S - 0.5) * (1.0 + uCA.x) + 0.5).r;
    col.b = texture(uDev, (S - 0.5) * (1.0 + uCA.y) + 0.5).b;
  }
  if (uLensVig != 0.0) {
    vec2 d = (S - 0.5) * vec2(uSrcAspect, 1.0);
    float r2 = dot(d, d) / (0.25 * (uSrcAspect * uSrcAspect + 1.0));
    col = l2s(s2l(col) * (1.0 + uLensVig * r2 * (0.6 + 0.4 * r2)));
  }

  if (uVigAmt != 0.0) {
    vec2 u = (q - 0.5) * 2.0;
    float dist;
    if (uVigRound >= 0.0) {
      float ar = uCropAspect;
      vec2 uc = ar >= 1.0 ? vec2(u.x * ar, u.y) : vec2(u.x, u.y / ar);
      dist = mix(length(u), length(uc), uVigRound);
    } else {
      float p = mix(2.0, 8.0, -uVigRound);
      dist = pow(pow(abs(u.x), p) + pow(abs(u.y), p), 1.0 / p);
    }
    float start = mix(0.05, 1.2, uVigMid) - uVigFeather * 0.45;
    float t = smoothstep(start, start + 0.04 + uVigFeather * 1.05, dist);
    if (uVigAmt < 0.0) {
      vec3 l = s2l(col);
      float lum = dot(l, LUMA);
      float protect = uVigHigh * smoothstep(0.35, 0.95, l2s1(lum));
      l *= 1.0 + uVigAmt * 0.97 * t * (1.0 - protect * 0.9);
      col = l2s(l);
    } else {
      col = mix(col, vec3(1.0), uVigAmt * 0.92 * t);
    }
  }
  if (uGrainAmt > 0.0) {
    vec2 gp = O * uGrainCells;
    float n1 = vnoise(gp);
    float n2 = vnoise(gp * 2.17 + 31.7);
    float n3 = hash(floor(gp * 1.3) + 7.0);
    float g = mix(n1, n2, 0.35 + uGrainRough * 0.3);
    g = mix(g, n3, uGrainRough * 0.25) - 0.5;
    float lum = dot(col, LUMA);
    float wgt = 0.25 + 3.0 * lum * (1.0 - lum);
    col += g * uGrainAmt * 0.4 * wgt;
  }
  if (uClip == 1) {
    if (max(col.r, max(col.g, col.b)) >= 0.996) col = vec3(1.0, 0.15, 0.15);
    else if (max(col.r, max(col.g, col.b)) <= 0.004) col = vec3(0.15, 0.35, 1.0);
  }
  if (uOverlay >= 0) col = mix(col, uOverlayColor, 0.55 * texture(uMasks, vec3(S, float(uOverlay))).r);
  if (uCropMode == 1 && !inCrop) col = mix(col, uBg, 0.62);
  o = vec4(clamp(col, 0.0, 1.0), uCropMode == 1 ? 1.0 : c.a);
}`

/** Plain copy (used to read the photo back at mask resolution). */
export const FS_COPY = HEAD + /* glsl */ `
uniform sampler2D uSrc;
void main() {
  o = texture(uSrc, vUv);
}`

/** Lens blur: depth-dependent bokeh (gather with scatter weights). */
export const FS_LENSBLUR = HEAD + /* glsl */ `
uniform sampler2D uDev, uDepth;
uniform vec2 uPx;
uniform float uFocus, uRange, uMaxR, uBoost, uCatEye;
uniform int uShape;
uniform float uAspect;

float coc(float depth) {
  float d = abs(depth - uFocus);
  return smoothstep(uRange * 0.5, uRange * 0.5 + 0.22, d);
}

// Bokeh aperture weight for an offset inside the unit disc.
float aperture(vec2 o, vec2 uv) {
  float r = length(o);
  if (r > 1.0) return 0.0;
  if (uShape == 1) return 0.55 + 0.9 * smoothstep(0.55, 1.0, r);          // bubble: bright rim
  if (uShape == 3) return smoothstep(0.62, 0.8, r) * 1.6;                  // ring
  if (uShape == 2) {                                                        // 5 blades
    float a = atan(o.y, o.x);
    float k = 3.14159265 / 5.0;
    float edge = cos(k) / cos(mod(a + k, 2.0 * k) - k);
    return r <= edge ? 1.0 : 0.0;
  }
  if (uShape == 4) {                                                        // cat eye: clipped toward the image edge
    vec2 dir = (uv - 0.5) * vec2(uAspect, 1.0);
    vec2 shifted = o + normalize(dir + 1e-5) * length(dir) * uCatEye * 1.4;
    return length(shifted) <= 1.0 ? 1.0 : 0.0;
  }
  return 1.0;
}

void main() {
  vec4 c0 = texture(uDev, vUv);
  float myCoc = coc(texture(uDepth, vUv).r);
  float R = uMaxR * myCoc;
  if (R < 0.6) { o = c0; return; }
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  const int N = 72;
  float lod = max(0.0, log2(R / 7.0));
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float ang = float(i) * 2.39996323;
    vec2 unit = sqrt(t) * vec2(cos(ang), sin(ang));
    vec2 uv = vUv + unit * R * uPx;
    float sc = coc(texture(uDepth, uv).r) * uMaxR;
    // A sample contributes if its own blur disc reaches this pixel (no sharp halos).
    float reach = smoothstep(length(unit) * R - 1.5, length(unit) * R + 1.5, sc + R * 0.25);
    float w = aperture(unit, vUv) * reach;
    vec3 s = textureLod(uDev, uv, lod).rgb;
    float lum = dot(s, LUMA);
    w *= 1.0 + uBoost * 12.0 * pow(lum, 6.0);
    acc += s * w;
    wsum += w;
  }
  vec3 col = wsum > 0.0 ? acc / wsum : c0.rgb;
  o = vec4(mix(c0.rgb, col, smoothstep(0.6, 2.0, R)), c0.a);
}`
