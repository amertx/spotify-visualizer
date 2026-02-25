// Stefan Gustavson's 3D simplex noise — embedded in GLSL
const NOISE_GLSL = /* glsl */ `
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289v4(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289v3(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
    i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4  j  = p - 49.0 * floor(p * ns.z * ns.z);
  vec4  x_ = floor(j * ns.z);
  vec4  y_ = floor(j - 7.0 * x_);
  vec4  x  = x_ * ns.x + ns.yyyy;
  vec4  y  = y_ * ns.x + ns.yyyy;
  vec4  h  = 1.0 - abs(x) - abs(y);
  vec4  b0 = vec4(x.xy, y.xy);
  vec4  b1 = vec4(x.zw, y.zw);
  vec4  s0 = floor(b0) * 2.0 + 1.0;
  vec4  s1 = floor(b1) * 2.0 + 1.0;
  vec4  sh = -step(h, vec4(0.0));
  vec4  a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4  a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3  p0 = vec3(a0.xy, h.x);
  vec3  p1 = vec3(a0.zw, h.y);
  vec3  p2 = vec3(a1.xy, h.z);
  vec3  p3 = vec3(a1.zw, h.w);
  vec4  norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

export const blobVertexShader = /* glsl */ `
${NOISE_GLSL}

uniform float uTime;
uniform float uBeat;
uniform float uEnergy;
uniform float uDanceability;
uniform float uAcousticness;
uniform float uRoughness;     // ZCR-derived: 0=smooth pads, 1=noisy/percussive

varying vec3  vNormal;
varying float vDisplacement;
varying float vColorNoise1;
varying float vColorNoise2;

void main() {
  vec3 n = normalize(position);

  float speed = 0.12 + uDanceability * 0.22;
  float t     = uTime * speed;

  float smoothness = 1.0 - uAcousticness * 0.45;
  float n1 = snoise(n * 1.8  + t);
  float n2 = snoise(n * 3.6 * smoothness + t * 1.45) * 0.42;

  // Third octave: high-frequency spikes driven by ZCR / roughness
  // At uRoughness=0 this contributes nothing; at 1 it adds jagged surface detail
  float n3 = snoise(n * 8.5 + t * 2.1) * 0.28 * uRoughness;

  float noise = (n1 + n2 + n3) / (1.42 + 0.28 * uRoughness);

  float amp  = (0.38 + uEnergy * 0.85) + uBeat * 2.6;
  float disp = noise * amp;

  float colorSpeed = 0.05 + uDanceability * 0.07;
  vColorNoise1 = snoise(n * 1.1 + uTime * colorSpeed) * 0.5 + 0.5;
  vColorNoise2 = snoise(n * 2.3 + uTime * colorSpeed * 1.4 + vec3(5.1, 2.7, 8.3)) * 0.5 + 0.5;

  vNormal       = normalMatrix * normal;
  vDisplacement = disp;

  vec3 displaced = position + n * disp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const blobFragmentShader = /* glsl */ `
uniform float uHue1;
uniform float uHue2;
uniform float uHue3;
uniform float uEnergy;
uniform float uBeat;

varying vec3  vNormal;
varying float vDisplacement;
varying float vColorNoise1;
varying float vColorNoise2;

// Full-saturation hue → RGB (HSL s=1, l=0.5 — maximally vivid)
vec3 hue2rgb(float h) {
  h = fract(h);
  float r = abs(h * 6.0 - 3.0) - 1.0;
  float g = 2.0 - abs(h * 6.0 - 2.0);
  float b = 2.0 - abs(h * 6.0 - 4.0);
  return clamp(vec3(r, g, b), 0.0, 1.0);
}

void main() {
  vec3 col1 = hue2rgb(uHue1);
  vec3 col2 = hue2rgb(uHue2);
  vec3 col3 = hue2rgb(uHue3);

  // Sharp zone boundaries — paper-cut layers feel
  // smoothstep over a narrow range creates clear, readable colour regions
  float zone = smoothstep(0.36, 0.64, vColorNoise1);
  vec3 surfaceColor = mix(col1, col2, zone);

  // Accent hue on displacement peaks, modulated by secondary noise
  float peak = smoothstep(0.0, 0.5, max(0.0, vDisplacement) * 1.6);
  surfaceColor = mix(surfaceColor, col3, peak * (0.45 + vColorNoise2 * 0.55));

  // ── Lighting ──────────────────────────────────────────────────────────────
  vec3 norm = normalize(vNormal);

  // Directional — gives 3-D form (valleys dark, lit faces bright)
  vec3 lightDir = normalize(vec3(2.0, 3.0, 4.0));
  float diff    = max(dot(norm, lightDir), 0.0);

  // Fresnel rim — edges glow like the Three.js fluid reference
  // dot(norm, viewDir) approximated in view space: norm.z ~ facing-camera
  float facing = max(0.0, dot(norm, vec3(0.0, 0.0, 1.0)));
  float rim    = pow(1.0 - facing, 2.8);

  // Base lit surface — intentionally HDR (>1.0) on bright faces; bloom picks it up
  vec3 lit = surfaceColor * (0.25 + diff * 1.1);

  // Luminous rim — over-bright so bloom creates an aura around the silhouette
  lit += surfaceColor * rim * 2.0;

  // Displacement peaks emit accent colour — creates the paper-layer "ridge" highlights
  float peakEmit = smoothstep(0.0, 0.9, max(0.0, vDisplacement));
  lit += col3 * peakEmit * 0.9;

  // Beat flash — saturated purple-white pulse
  lit += vec3(0.5, 0.35, 1.0) * uBeat * 0.55;

  // High opacity — solid, prominent surface
  float alpha = 0.88 + uEnergy * 0.08 + uBeat * 0.04;
  gl_FragColor = vec4(lit, alpha);
}
`;

export const blobWireFragmentShader = /* glsl */ `
uniform float uHue1;
uniform float uHue2;
uniform float uEnergy;
uniform float uBeat;

varying float vDisplacement;
varying float vColorNoise1;

vec3 hue2rgb(float h) {
  h = fract(h);
  float r = abs(h * 6.0 - 3.0) - 1.0;
  float g = 2.0 - abs(h * 6.0 - 2.0);
  float b = 2.0 - abs(h * 6.0 - 4.0);
  return clamp(vec3(r, g, b), 0.0, 1.0);
}

void main() {
  vec3 col1 = hue2rgb(uHue1);
  vec3 col2 = hue2rgb(uHue2);

  // Neon wire — intentionally overbrightened so bloom makes it glow
  vec3 color = mix(col1, col2, vColorNoise1) * 3.0;

  // Beat: flash hot white-violet
  color = mix(color, vec3(2.0, 1.8, 3.0), uBeat * 0.7);

  float alpha = 0.55 + uEnergy * 0.30 + uBeat * 0.15;
  gl_FragColor = vec4(color, alpha);
}
`;
