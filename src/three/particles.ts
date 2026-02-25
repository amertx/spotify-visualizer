import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uSize;
varying vec3  vColor;
attribute vec3 aColor;

void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position  = projectionMatrix * mv;
  // Perspective-correct size: appears ~0.08 world units at distance 7
  gl_PointSize = uSize * (70.0 / -mv.z);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  // Soft glowing disc — intentionally HDR for bloom pickup
  vec2  cxy   = 2.0 * gl_PointCoord - 1.0;
  float r     = dot(cxy, cxy);
  if (r > 1.0) discard;
  float alpha = pow(1.0 - r, 1.5) * 0.85;
  // Overbrightened so bloom creates an aura
  gl_FragColor = vec4(vColor * 2.2, alpha);
}
`;

export class ParticleSystem {
  readonly points: THREE.Points;

  private geo:       THREE.BufferGeometry;
  private mat:       THREE.ShaderMaterial;
  private positions: Float32Array;
  private colors:    Float32Array;
  private phases:    Float32Array;
  private radii:     Float32Array;   // target orbit radius per particle
  private maxCount:  number;

  constructor(maxCount = 700) {
    this.maxCount  = maxCount;
    this.positions = new Float32Array(maxCount * 3);
    this.colors    = new Float32Array(maxCount * 3);
    this.phases    = new Float32Array(maxCount);
    this.radii     = new Float32Array(maxCount);

    // Initialise in a shell around the blob (r = 3–5)
    for (let i = 0; i < maxCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 3.0 + Math.random() * 2.2;
      this.radii[i]     = r;
      this.phases[i]    = Math.random() * Math.PI * 2;
      this.positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      this.positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      this.positions[i * 3 + 2] = r * Math.cos(phi);
      // Default colour: violet
      this.colors[i * 3] = 0.6; this.colors[i * 3 + 1] = 0.3; this.colors[i * 3 + 2] = 1.0;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('aColor',   new THREE.BufferAttribute(this.colors, 3));

    this.mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms:       { uSize: { value: 1.0 } },
      transparent:    true,
      blending:       THREE.AdditiveBlending,
      depthWrite:     false,
    });

    this.points = new THREE.Points(this.geo, this.mat);
  }

  /**
   * Update particle positions and colors every frame.
   *
   * @param dt        Frame delta time (seconds)
   * @param flux      Spectral flux (0–1) — drives turbulence
   * @param hue1      Primary hue   — most particles
   * @param hue2      Secondary hue — minority particles
   * @param hue3      Accent hue    — peaks / burst particles
   * @param opacity   Overall opacity from profile (0–1)
   * @param burst     True on big transients — scatter particles outward
   */
  update(
    dt: number,
    flux: number,
    hue1: number, hue2: number, hue3: number,
    opacity: number,
    burst: boolean,
  ) {
    const orbitSpeed  = 0.25 + flux * 1.8;           // rad/s around Y
    const turbulence  = flux * 0.18;
    const cos = Math.cos(orbitSpeed * dt);
    const sin = Math.sin(orbitSpeed * dt);

    // Pre-compute three RGB colours from hues
    const c1 = hsl2rgb(hue1);
    const c2 = hsl2rgb(hue2);
    const c3 = hsl2rgb(hue3);

    for (let i = 0; i < this.maxCount; i++) {
      let x = this.positions[i * 3];
      let y = this.positions[i * 3 + 1];
      let z = this.positions[i * 3 + 2];

      // Orbit around Y axis
      const nx = cos * x + sin * z;
      const nz = -sin * x + cos * z;
      x = nx; z = nz;

      // Gentle bobbing on Y
      this.phases[i] += dt * 0.4;
      y += Math.sin(this.phases[i]) * 0.012;

      // Drift back toward target orbit radius
      const r = Math.sqrt(x * x + y * y + z * z) || 1;
      const dr = (this.radii[i] - r) * 0.025;
      x += (x / r) * dr;
      y += (y / r) * dr;
      z += (z / r) * dr;

      // Spectral flux turbulence
      if (turbulence > 0.01) {
        x += (Math.random() - 0.5) * turbulence;
        y += (Math.random() - 0.5) * turbulence;
        z += (Math.random() - 0.5) * turbulence;
      }

      // Big transient: push particles outward and reassign orbit radius
      if (burst) {
        const br = Math.sqrt(x * x + y * y + z * z) || 1;
        x += (x / br) * (1.5 + Math.random() * 2.0);
        y += (y / br) * (1.5 + Math.random() * 2.0);
        z += (z / br) * (1.5 + Math.random() * 2.0);
        this.radii[i] = 3.0 + Math.random() * 2.5;
      }

      this.positions[i * 3]     = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;

      // Colour: most → hue1, some → hue2, accents → hue3
      const slot = i % 10;
      const col  = slot < 5 ? c1 : slot < 8 ? c2 : c3;
      this.colors[i * 3]     = col[0];
      this.colors[i * 3 + 1] = col[1];
      this.colors[i * 3 + 2] = col[2];
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate   = true;
    this.mat.uniforms.uSize.value = 0.9 + flux * 0.6;

    this.points.visible = opacity > 0.02;
    this.mat.opacity    = Math.max(0, Math.min(1, opacity));
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ── HSL(h, 1, 0.5) → [r, g, b] (same formula as GLSL shader) ────────────────
function hsl2rgb(h: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const r = Math.max(0, Math.min(1, Math.abs(h * 6 - 3) - 1));
  const g = Math.max(0, Math.min(1, 2 - Math.abs(h * 6 - 2)));
  const b = Math.max(0, Math.min(1, 2 - Math.abs(h * 6 - 4)));
  return [r, g, b];
}
