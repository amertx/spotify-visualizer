// ── Vasarely op-art — 10 compositions, fully animated ────────────────────────
//
// Every composition uses 5 shared animated helpers to guarantee ≥ 3 independent
// moving parameters at all times — even when the audio input is silent:
//
//   audioAct()        — 0=silent→ambient, 1=full audio
//   preWarp(uv)       — (1) asymmetric bass-breathing + flux shear on the UV
//   cellAnim(cv,id)   — (2) per-cell rotation driven by mids (per-cell phase)
//   animR(base,id)    — (3) size-pulse from highs + beat grid-line oscillation
//   animBF(static)    — (4) color-band drift (flux speed) + centroid rotation
//                           has a non-zero floor so bands always scroll

export const vasarelyVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const vasarelyFrag = /* glsl */ `
precision highp float;
const float PI = 3.14159265359;

// ── Audio ─────────────────────────────────────────────────────────────────────
uniform float uTime;
uniform float uBass, uMids, uHighs, uFlux, uBeat, uCentroid;

// ── Composition crossfade ─────────────────────────────────────────────────────
uniform float uComp, uPrevComp, uBlend;

// ── Palette ───────────────────────────────────────────────────────────────────
uniform vec3 uC0, uC1, uC2, uC3;

// ── Per-song seed ─────────────────────────────────────────────────────────────
uniform vec2  uWarp0, uWarp1, uWarp2, uWarp3;
uniform float uGridDensity;     // 20 – 60
uniform float uGridRotation;    // 0 / 15° / 30° / 45° in radians
uniform float uCellShape;       // 0=circle 1=square 2=diamond 3=rounded-rect
uniform float uColorBandDir;    // 0=concentric 1=horizontal 2=diagonal 3=spiral
uniform float uNumWarps;        // 1 – 4
uniform float uMirrorN;         // 4 / 5 / 6

uniform vec2  uResolution;
uniform float uVocalStrength;    // 0–1, 0.5 s fade-in / 0.8 s fade-out
uniform float uVocalStrength2;   // 0–1, second silhouette (strong vocal energy)
uniform float uVocalMouth;       // 0–1, mouth open amount — fast ~17 Hz
uniform float uHeadPos;          // x of head 1 (<0 = left-third, >0 = right-third)
varying vec2 vUv;

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

vec3 pal(float idx) {
  float b = mod(floor(idx + 0.001), 4.0);
  if      (b < 1.0) return uC0;
  else if (b < 2.0) return uC1;
  else if (b < 3.0) return uC2;
  else              return uC3;
}

vec2 rotUV(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

vec2 sphWarpAt(vec2 uv, vec2 cen, float str) {
  vec2  d  = uv - cen;
  float r  = length(d);
  if (r < 0.0001) return uv;
  float rN = clamp(r / 1.42, 0.0, 0.9999);
  float rW = asin(rN) / 1.5708 * 1.42;
  return cen + d * mix(1.0, rW / r, str);
}

// Flat-filled cell shape — zero smoothstep, hard edges.
// cell in [-1,1]; r = fill fraction of that range.
float cellFill(vec2 cell, float r) {
  float s = uCellShape;
  if (s < 0.5) {
    return step(dot(cell, cell), r * r);
  } else if (s < 1.5) {
    return step(max(abs(cell.x), abs(cell.y)), r);
  } else if (s < 2.5) {
    return step(abs(cell.x) + abs(cell.y), r * 1.41421);
  } else {
    float cr = r * 0.30;
    vec2  q  = abs(cell) - vec2(r - cr);
    return step(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0), cr);
  }
}

// Colour-band distance along the chosen direction.
float bandDist(vec2 id, float N) {
  float n = max(N, 0.001);
  if      (uColorBandDir < 0.5) return length(id) / (n * 0.75);
  else if (uColorBandDir < 1.5) return (id.y / n) * 0.5 + 0.5;
  else if (uColorBandDir < 2.5) return (id.x + id.y) / (n * 1.5) * 0.5 + 0.5;
  else {
    float a = atan(id.y + 0.001, id.x + 0.001) / (2.0 * PI);
    return length(id) / (n * 0.75) + a * 0.5;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATION HELPERS  — every composition must call all four
// ═══════════════════════════════════════════════════════════════════════════════

// 0→1 where 0=silent (pure ambient) and 1=full audio.
float audioAct() {
  return clamp((uBass + uMids * 0.5 + uHighs * 0.3) * 4.0, 0.0, 1.0);
}

// (1) Asymmetric bass-breathing on X/Y axes + flux asymmetric shear.
//     Ambient floor: ±2.5 % on X, ±2.0 % on Y, 0.8 % shear — always moving.
vec2 preWarp(vec2 uv) {
  float act = audioAct();
  float bx  = (0.025 + uBass * 0.07 * act) * sin(uTime * 0.71);
  float by  = (0.020 + uBass * 0.05 * act) * cos(uTime * 0.53);
  uv.x *= 1.0 + bx;
  uv.y *= 1.0 + by;
  float sh   = 0.008 + uFlux * 0.09 * act;
  float ux   = uv.x;          // decouple axes so shear is purely orthogonal
  uv.x      += uv.y * sh * sin(uTime * 1.31);
  uv.y      += ux   * sh * cos(uTime * 0.97);
  return uv;
}

// (2) Per-cell local rotation.  Ambient floor: ±0.05 rad;  mids add up to ±0.45.
//     Each cell gets a unique phase from its integer index.
vec2 cellAnim(vec2 cv, vec2 id) {
  float act   = audioAct();
  float m     = 0.05 + uMids * 0.40 * act;
  float angle = sin(uTime * 2.1 + id.x * 1.71 + id.y * 2.31) * m;
  float c = cos(angle), s = sin(angle);
  return vec2(cv.x * c - cv.y * s, cv.x * s + cv.y * c);
}

// (3) Animated fill radius: highs drive per-cell size pulsing (unique phase per
//     cell) + beat causes fast grid-line thickness oscillation.
//     Ambient floor: ±0.04 radius; highs add up to ±0.14.
float animR(float base, vec2 id) {
  float act      = audioAct();
  float h        = 0.04 + uHighs * 0.14 * act;
  float pulse    = sin(uTime * 3.7 + id.x * 1.30 + id.y * 0.93) * h;
  float beatLine = uBeat * 0.07 * sin(uTime * 20.0);  // grid-line oscillation on beat
  return clamp(base + pulse + beatLine, 0.02, 0.98);
}

// (4) Animated colour-band factor.
//     Ambient floor: always drifts at 0.12/s + slow centroid oscillation.
//     Flux accelerates drift; centroid adds rotation when audio is present.
float animBF(float staticPart) {
  float act   = audioAct();
  float drift = 0.12 + uFlux * 0.55 * act;               // floor of 0.12/s
  float cent  = uCentroid * 3.0 * act                     // audio centroid
              + 0.3 * sin(uTime * 0.08);                  // slow ambient color shift
  return staticPart + uTime * drift + cent + uBeat * 1.8;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOCAL SILHOUETTE — side-profile SDF heads with animated mouth
//
// Head 1 at uHeadPos (left or right third, random per song), facing inward.
// Head 2 at -uHeadPos, facing opposite — like the reference double-face image.
// uVocalMouth (0–1) drives mouth Y-scale for speech/singing animation (~17 Hz).
// The Vasarely grid renders THROUGH the silhouettes — same grid, shifted palette
// (stained-glass zone, not a flat overlay).  Overlap zone gets a third colour.
// ═══════════════════════════════════════════════════════════════════════════════

// Smooth minimum — polynomial blend (k = blend radius).
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Approximate SDF for axis-aligned ellipse at c with semi-axes ab.
// Sign is exact; distance is proportional near the surface.
float sdEll(vec2 p, vec2 c, vec2 ab) {
  vec2 q = (p - c) / ab;
  return (length(q) - 1.0) * min(ab.x, ab.y);
}

// Mouth ellipse — Y-scale animated by uVocalMouth (0=closed, 1=wide open).
// p must already be in faced local space (p.x *= facing applied by caller).
float sdMouth(vec2 p, float mouthOpen) {
  float ry = 0.018 + mouthOpen * 0.058;   // closed → thin slit, open → tall ellipse
  return sdEll(p, vec2(0.182, -0.155), vec2(0.056, ry));
}

// Full head profile — facing RIGHT (nose toward +x).
// Pass facing=-1.0 to mirror for a left-facing head.
// Shapes: cranium, nose, lips area, chin, neck — smooth-unioned for organic feel.
float sdHead(vec2 p, float facing) {
  p.x *= facing;
  float skull = sdEll(p, vec2( 0.00,  0.07), vec2(0.250, 0.290));
  float nose  = sdEll(p, vec2( 0.23,  0.01), vec2(0.080, 0.063));
  float lips  = sdEll(p, vec2( 0.182, -0.10), vec2(0.058, 0.042));
  float chin  = sdEll(p, vec2( 0.10,  -0.22), vec2(0.125, 0.090));
  float neck  = sdEll(p, vec2(-0.05,  -0.43), vec2(0.082, 0.135));
  float d = smin(skull, nose,  0.07);
        d = smin(d,     lips,  0.055);
        d = smin(d,     chin,  0.07);
        d = smin(d,     neck,  0.07);
  return d;
}

// SDF gradient via central differences — drives the UV warp direction.
vec2 sdHeadGrad(vec2 p, float facing) {
  const float e = 0.006;
  return normalize(vec2(
    sdHead(p + vec2(e,   0.0), facing) - sdHead(p - vec2(e,   0.0), facing),
    sdHead(p + vec2(0.0, e  ), facing) - sdHead(p - vec2(0.0, e  ), facing)
  ));
}

// Warp UV toward silhouette boundaries — Vasarely grid flows around the heads.
// facing1 = sign(-uHeadPos): head-1 on left → faces right (+1).
vec2 vocalWarp(vec2 uv, float d1, float d2, float facing1) {
  float w1 = uVocalStrength  * exp(-d1 * d1 * 16.0) * 0.10;
  float w2 = uVocalStrength2 * exp(-d2 * d2 * 16.0) * 0.10;
  if (uVocalStrength  > 0.001) uv -= sdHeadGrad(uv - vec2( uHeadPos, 0.0),  facing1) * w1;
  if (uVocalStrength2 > 0.001) uv -= sdHeadGrad(uv - vec2(-uHeadPos, 0.0), -facing1) * w2;
  return uv;
}

// Stained-glass palette fill — same Vasarely grid inside, different colour zone:
//   Head 1 only  → uC1 @ 75 %   Head 2 only  → uC2 @ 75 %
//   Overlap zone → uC0 @ 85 %   Mouth region → uC3 @ 65 % (animates open/close)
vec3 vocalColorFill(vec3 base, float d1, float d2, float dMouth1, float dMouth2) {
  if (uVocalStrength < 0.001 && uVocalStrength2 < 0.001) return base;
  float m1      = smoothstep(0.025, -0.025, d1) * uVocalStrength;
  float m2      = smoothstep(0.025, -0.025, d2) * uVocalStrength2;
  float overlap = m1 * m2;
  float only1   = m1 * (1.0 - m2);
  float only2   = m2 * (1.0 - m1);
  // Mouth masks — only show where the head silhouette is already visible
  float mouth1  = smoothstep(0.012, -0.012, dMouth1) * m1;
  float mouth2  = smoothstep(0.012, -0.012, dMouth2) * m2;
  vec3 col = base;
  col = mix(col, uC1, only1   * 0.75);
  col = mix(col, uC2, only2   * 0.75);
  col = mix(col, uC0, overlap * 0.85);
  col = mix(col, uC3, mouth1  * 0.65);
  col = mix(col, uC3, mouth2  * 0.65);
  return col;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── 0: Sphere Bulge ───────────────────────────────────────────────────────────
vec3 compSphereBulge(vec2 uv) {
  uv = preWarp(uv);
  vec2  w  = sphWarpAt(uv, uWarp0, 0.28 + uBass * 0.52);
  float N  = uGridDensity;
  vec2  g  = rotUV(w, uGridRotation) * N;
  vec2  id = floor(g);
  vec2  cv = cellAnim(fract(g) * 2.0 - 1.0, id);

  float d   = bandDist(id, N);
  float r   = animR(mix(0.82, 0.12, clamp(d, 0.0, 1.0)), id);
  float hit = cellFill(cv, r);
  float bf  = animBF(d * 4.0);
  return mix(pal(bf + 2.0), pal(bf), hit);
}

// ── 1: Isometric Cubes ────────────────────────────────────────────────────────
vec3 compIsoCubes(vec2 uv) {
  uv = preWarp(uv);
  vec2  w   = sphWarpAt(uv, uWarp0, 0.18 + uBass * 0.42);
  // Slow grid spin (mids-driven speed) gives internal movement
  float act = audioAct();
  w = rotUV(w, uTime * (0.018 + uMids * 0.10 * act) + uGridRotation);
  float N   = uGridDensity * 0.25;
  float s3h = 0.8660254;

  float p0 = w.x * N;
  float p1 = (-0.5 * w.x + s3h * w.y) * N;
  float p2 = (-0.5 * w.x - s3h * w.y) * N;

  float fSum = fract(p0) + fract(p1) + fract(p2);
  float face = fSum < 1.0 ? 0.0 : (fSum < 2.0 ? 1.0 : 2.0);

  float dist = length(vec2(floor(p0), floor(p1))) / max(N * 1.5, 0.001);
  float bf   = animBF(dist * 3.0);
  return pal(face + floor(uBeat * 1.2) + bf);
}

// ── 2: Tunnel Perspective ─────────────────────────────────────────────────────
vec3 compTunnel(vec2 uv) {
  uv = preWarp(uv);
  vec2  off   = uv - uWarp0;
  float rr    = max(length(off), 0.0015);
  float angle = atan(off.y, off.x) + uGridRotation;
  float depth = -log(rr) * 0.9 + uTime * (0.12 + uBass * 0.55);

  float nSlice = uGridDensity * 0.5;
  float slice  = angle / (2.0 * PI) * nSlice;
  vec2  id     = floor(vec2(slice, depth));
  vec2  cv     = cellAnim(fract(vec2(slice, depth)) * 2.0 - 1.0, id);
  float hit    = cellFill(cv, animR(0.68, id));
  float bf     = animBF(id.y + mod(id.x, 2.0));
  return mix(pal(bf + 2.0), pal(bf), hit);
}

// ── 3: Hex Warp ───────────────────────────────────────────────────────────────
vec3 compHexWarp(vec2 uv) {
  uv = preWarp(uv);
  vec2  w = sphWarpAt(uv, uWarp0, 0.25 + uBass * 0.50);
  float N = uGridDensity * 0.5;
  vec2  p = rotUV(w, uGridRotation) * N;

  vec2 rv = vec2(1.0, 1.7320508);
  vec2 h  = rv * 0.5;
  vec2 a  = mod(p,     rv) - h;
  vec2 b  = mod(p + h, rv) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = p - gv;

  // Apply cell animation to the hex-local vector (visible for non-circle shapes)
  vec2 cvHex = cellAnim(gv * 2.0, id);
  float hit  = step(length(cvHex) * 0.5, animR(0.44, id));

  float dist = bandDist(id, N);
  float bf   = animBF(dist * 4.0);
  return mix(pal(floor(bf) + 2.0), pal(floor(bf)), hit);
}

// ── 4: Cube Fold / Diamond Sphere ─────────────────────────────────────────────
vec3 compCubeFold(vec2 uv) {
  uv = preWarp(uv);
  vec2  w   = sphWarpAt(uv, uWarp0, 0.38 + uBass * 0.50);
  vec2  rot = rotUV(w, PI * 0.25 + uGridRotation);
  float N   = uGridDensity;
  vec2  g   = rot * N;
  vec2  id  = floor(g);
  vec2  cv  = cellAnim(fract(g) * 2.0 - 1.0, id);

  float checker = mod(id.x + id.y, 2.0);
  float hit     = cellFill(cv, animR(0.78, id));
  float dist    = bandDist(id, N);
  float bf      = animBF(dist * 4.0);
  return mix(pal(bf + 1.0 - checker), pal(bf + checker), hit);
}

// ── 5: Concentric Diamonds ────────────────────────────────────────────────────
vec3 compConcentricDiamonds(vec2 uv) {
  uv = preWarp(uv);
  vec2  d  = uv - uWarp0;
  // Rotate the L1-metric axes slowly — makes the diamond orientation drift
  float act      = audioAct();
  float rotSpeed = 0.018 + uMids * 0.15 * act;
  vec2  dr       = rotUV(d, uTime * rotSpeed);
  float ld       = abs(dr.x) + abs(dr.y);
  // Beat ripple on the distance field
  ld += sin(ld * 13.0 - uTime * 2.8) * uBeat * 0.07;
  // Highs: additional fine ripple for surface texture
  ld += sin(ld * 28.0 - uTime * 5.0) * uHighs * 0.025 * act;

  float N    = uGridDensity * 0.4;
  float bf   = animBF(ld * N);
  float frac = fract(bf);
  float hit  = step(frac, animR(0.52, vec2(ld * N, 0.0)));
  return mix(pal(floor(bf) + 2.0), pal(floor(bf)), hit);
}

// ── 6: Wave Distortion ────────────────────────────────────────────────────────
vec3 compWaveDistortion(vec2 uv) {
  uv = preWarp(uv);
  float act   = audioAct();
  float freq  = 3.0 + uMids * 5.0;
  float amp   = 0.025 + uBass * 0.11 * act + 0.015 * act;  // ambient wave
  float speed = 0.8 + uBass * 1.8 * act + 0.5;             // ambient speed

  vec2 d = uv - uWarp0;
  d.x += sin(d.y * freq * PI + uTime * speed)        * amp;
  d.y += sin(d.x * freq * PI + uTime * speed * 0.73) * amp;

  float len = length(d);
  if (len > 0.001) d += (d / len) * uBeat * 0.10 * sin(len * 9.0 - uTime * 4.0);

  float N   = uGridDensity;
  vec2  g   = rotUV(d, uGridRotation) * N;
  vec2  id  = floor(g);
  vec2  cv  = cellAnim(fract(g) * 2.0 - 1.0, id);
  float hit = cellFill(cv, animR(0.78, id));
  float bf  = animBF(bandDist(id, N) * 4.0);
  return mix(pal(floor(bf) + 2.0), pal(floor(bf)), hit);
}

// ── 7: Multi-Bulge ────────────────────────────────────────────────────────────
vec3 compMultiBulge(vec2 uv) {
  uv = preWarp(uv);
  float str = (0.18 + uBass * 0.38) / max(uNumWarps, 1.0);
  vec2  w   = uv;
  w = sphWarpAt(w, uWarp0, str);
  if (uNumWarps > 1.5) w = sphWarpAt(w, uWarp1, str);
  if (uNumWarps > 2.5) w = sphWarpAt(w, uWarp2, str);
  if (uNumWarps > 3.5) w = sphWarpAt(w, uWarp3, str);

  float N  = uGridDensity;
  vec2  g  = rotUV(w, uGridRotation) * N;
  vec2  id = floor(g);
  vec2  cv = cellAnim(fract(g) * 2.0 - 1.0, id);
  float hit = cellFill(cv, animR(0.78, id));
  float bf  = animBF(bandDist(id, N) * 4.0);
  return mix(pal(bf + 2.0), pal(bf), hit);
}

// ── 8: Corner Vanishing Point ─────────────────────────────────────────────────
vec3 compCornerVanish(vec2 uv) {
  uv = preWarp(uv);
  vec2  off   = uv - uWarp0;
  float rr    = max(length(off), 0.0015);
  float angle = atan(off.y, off.x) + uGridRotation;
  float depth = -log(rr) * 0.9 + uTime * (0.12 + uBass * 0.55);

  float nSlice = max(uGridDensity * 0.45, 4.0);
  float slice  = angle / (2.0 * PI) * nSlice;
  vec2  id     = floor(vec2(slice, depth));
  vec2  cv     = cellAnim(fract(vec2(slice, depth)) * 2.0 - 1.0, id);
  float hit    = cellFill(cv, animR(0.68, id));
  float bf     = animBF(bandDist(id, uGridDensity) * 4.0);
  return mix(pal(floor(bf) + 2.0), pal(floor(bf)), hit);
}

// ── 9: Star Fold ──────────────────────────────────────────────────────────────
vec3 compStarFold(vec2 uv) {
  uv = preWarp(uv);
  vec2  p = uv - uWarp0;

  float angle  = atan(p.y, p.x);
  float r      = length(p);
  float sector = PI / uMirrorN;
  angle = mod(angle + PI * 2.0, 2.0 * PI);
  angle = mod(angle, 2.0 * sector);
  if (angle > sector) angle = 2.0 * sector - angle;

  // Slowly rotate the fold phase for continuous internal motion
  float act      = audioAct();
  float foldDrift = uTime * (0.02 + uMids * 0.08 * act);
  vec2  folded   = rotUV(vec2(cos(angle), sin(angle)) * r, foldDrift);
  folded = sphWarpAt(folded, vec2(0.0), 0.20 + uBass * 0.42);

  float N  = uGridDensity * 0.6;
  vec2  g  = rotUV(folded, uGridRotation) * N;
  vec2  id = floor(g);
  vec2  cv = cellAnim(fract(g) * 2.0 - 1.0, id);
  float hit = cellFill(cv, animR(0.78, id));
  float bf  = animBF(bandDist(id, N) * 4.0);
  return mix(pal(bf + 2.0), pal(bf), hit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPATCH + MAIN
// ═══════════════════════════════════════════════════════════════════════════════

vec3 render(float id, vec2 uv) {
  if      (id < 0.5) return compSphereBulge(uv);
  else if (id < 1.5) return compIsoCubes(uv);
  else if (id < 2.5) return compTunnel(uv);
  else if (id < 3.5) return compHexWarp(uv);
  else if (id < 4.5) return compCubeFold(uv);
  else if (id < 5.5) return compConcentricDiamonds(uv);
  else if (id < 6.5) return compWaveDistortion(uv);
  else if (id < 7.5) return compMultiBulge(uv);
  else if (id < 8.5) return compCornerVanish(uv);
  else               return compStarFold(uv);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x   *= uResolution.x / uResolution.y;

  // ── Dynamic head positions — randomised left or right third per song ─────
  // uHeadPos < 0 → head 1 on left, faces right (+1); > 0 → on right, faces left (-1).
  float facing1 = uHeadPos < 0.0 ? 1.0 : -1.0;

  // ── Silhouette + mouth SDFs at original UV (colour blending after render) ─
  float vocalActive = max(uVocalStrength, uVocalStrength2);
  float d1 = 1.0, d2 = 1.0, dMouth1 = 1.0, dMouth2 = 1.0;
  if (vocalActive > 0.001) {
    vec2 lp1 = uv - vec2( uHeadPos, 0.0);
    vec2 lp2 = uv - vec2(-uHeadPos, 0.0);
    d1 = sdHead(lp1,  facing1);
    d2 = sdHead(lp2, -facing1);
    // Faced local coords for mouth (nose direction already baked into facing)
    vec2 fp1 = vec2(lp1.x *  facing1, lp1.y);
    vec2 fp2 = vec2(lp2.x * -facing1, lp2.y);
    dMouth1 = sdMouth(fp1, uVocalMouth);
    dMouth2 = sdMouth(fp2, uVocalMouth);
  }

  // ── Vocal SDF warp — grid flows through and around the silhouettes ────────
  vec2 wUv = vocalWarp(uv, d1, d2, facing1);

  vec3 colA = render(uPrevComp, wUv);
  vec3 colB = render(uComp,     wUv);
  vec3 col  = mix(colA, colB, uBlend);

  // ── Stained-glass fill + animated mouth zone ──────────────────────────────
  col = vocalColorFill(col, d1, d2, dMouth1, dMouth2);

  gl_FragColor = vec4(col, 1.0);
}
`;
