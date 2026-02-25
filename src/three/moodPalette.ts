// ── Real-time mood-driven palette modulation ──────────────────────────────────
//
// Computes a rolling 5 s mood vector from the live audio frame and maps it to
// a target 4-colour palette via bilinear interpolation across four mood corners:
//
//   energy × spectral-brightness axes:
//     LD — low/dark   → indigo / burgundy / olive / dark-slate
//     LB — low/bright → lavender / sage / slate / pale-sky
//     HD — high/dark  → burnt-orange / crimson / mustard / deep-rust
//     HB — high/bright→ electric-coral / cerulean / chartreuse / magenta
//
// Onset density modulates saturation (low = near-monochromatic, high = vivid).
// Flux variability pushes the accent slot toward the complementary colour.
// BPM gives a small boost to the energy axis.
//
// The modulate() method blends mood colours INTO the existing palette via
// HSL-space interpolation:  hue shifts 40 %, saturation 70 %, lightness 30 %.
// This modulates rather than replaces the song-palette structure.
//
// Timing:  8 s slow drift toward mood target (never hard-cuts).
//          1.5 s fast transition on section change (energy shifts > 40 %).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { LiveAnalysisFrame } from './liveAnalyzer';

type RGB = [number, number, number];

// ── Four mood-corner palettes ─────────────────────────────────────────────────

const LD: RGB[] = [   // low energy, dark centroid — brooding
  [0.08, 0.05, 0.25],  // deep indigo
  [0.40, 0.06, 0.12],  // burgundy
  [0.16, 0.20, 0.04],  // olive
  [0.06, 0.08, 0.18],  // dark slate
];

const LB: RGB[] = [   // low energy, bright centroid — dreamy / airy
  [0.62, 0.58, 0.88],  // lavender
  [0.52, 0.74, 0.56],  // sage
  [0.54, 0.64, 0.78],  // slate blue
  [0.84, 0.88, 0.96],  // pale sky
];

const HD: RGB[] = [   // high energy, dark centroid — aggressive / warm
  [0.72, 0.28, 0.05],  // burnt orange
  [0.72, 0.06, 0.08],  // crimson
  [0.84, 0.72, 0.04],  // mustard
  [0.28, 0.04, 0.04],  // deep rust
];

const HB: RGB[] = [   // high energy, bright centroid — electric / vivid
  [0.98, 0.32, 0.28],  // electric coral
  [0.06, 0.62, 0.94],  // cerulean
  [0.68, 0.98, 0.04],  // chartreuse
  [0.92, 0.06, 0.88],  // magenta
];

// ── Utilities ─────────────────────────────────────────────────────────────────

function lerp3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Bilinear blend across energy (0=low, 1=high) × brightness (0=dark, 1=bright). */
function moodQuad(energy: number, bright: number): RGB[] {
  return Array.from({ length: 4 }, (_, i) =>
    lerp3(lerp3(LD[i], HD[i], energy), lerp3(LB[i], HB[i], energy), bright)
  );
}

/** Adjust saturation in RGB: factor 1 = original, 0 = greyscale, >1 = boosted. */
function satAdjust(c: RGB, factor: number): RGB {
  const L = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  return [
    Math.min(1, Math.max(0, L + (c[0] - L) * factor)),
    Math.min(1, Math.max(0, L + (c[1] - L) * factor)),
    Math.min(1, Math.max(0, L + (c[2] - L) * factor)),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l   = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if      (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function h2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 1) + 1) % 1;
  if (s < 0.0001) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [h2rgb(p, q, h + 1 / 3), h2rgb(p, q, h), h2rgb(p, q, h - 1 / 3)];
}

// ── Mood Palette System ───────────────────────────────────────────────────────

export class MoodPaletteSystem {
  // 5 s rolling stats
  private rollEnergy   = 0.30;
  private rollCentroid = 0.30;
  private rollOnset    = 0.05;
  private rollFlux     = 0.03;
  private rollFluxMAD  = 0;     // mean-absolute-deviation of flux (variability proxy)

  // Section-change detection via two-speed energy EMAs
  private energyFast = 0.30;    // ~0.3 s time constant
  private energySlow = 0.30;    // ~2.5 s time constant
  private fastUntil  = -Infinity; // wall-time when fast-blend mode expires

  // Mood colours: target (computed each frame) and current (slowly lerped)
  private target:  RGB[] = moodQuad(0.5, 0.5);
  private current: RGB[] = moodQuad(0.5, 0.5);

  /**
   * Update rolling stats, compute mood target, lerp current → target.
   * Returns true when a section change is detected.
   */
  update(frame: LiveAnalysisFrame, dt: number, wallTimeSec: number): boolean {
    const { subBass, bass, mids, highs, brilliance, centroid,
            flux, onsetDensity, bpm } = frame;

    // RMS energy proxy — weighted band sum normalised to ≈ 0–1
    const energy = Math.min(1,
      (subBass + bass + mids * 0.8 + highs * 0.4 + brilliance * 0.2) * 0.55);

    // ── 5-second rolling stats ────────────────────────────────────────────
    const α5 = Math.min(0.50, dt / 5.0);
    this.rollEnergy   += (energy       - this.rollEnergy)   * α5;
    this.rollCentroid += (centroid     - this.rollCentroid) * α5;
    this.rollOnset    += (onsetDensity - this.rollOnset)    * α5;
    this.rollFlux     += (flux         - this.rollFlux)     * α5;

    // Flux MAD (~3 s) — proxy for flux variance / musical chaos
    const α3 = Math.min(0.50, dt / 3.0);
    this.rollFluxMAD  += (Math.abs(flux - this.rollFlux) - this.rollFluxMAD) * α3;

    // ── Section-change detection ──────────────────────────────────────────
    this.energyFast += (energy - this.energyFast) * Math.min(1, dt / 0.3);
    this.energySlow += (energy - this.energySlow) * Math.min(1, dt / 2.5);
    const sectionDelta = Math.abs(this.energyFast - this.energySlow)
                       / Math.max(0.05, this.energySlow);
    const sectionChange = sectionDelta > 0.40;
    if (sectionChange) this.fastUntil = wallTimeSec + 1.5;

    // ── Mood target ───────────────────────────────────────────────────────
    // BPM gives a small energy boost so a fast-quiet track feels more energetic
    const bpmBoost = Math.min(0.25, Math.max(0, (bpm - 80) / 120));
    const e = Math.min(1, this.rollEnergy * 2.2 + bpmBoost);
    const b = Math.min(1, this.rollCentroid * 3.0);

    let colors = moodQuad(e, b);

    // Onset density → saturation: 0=near-mono (0.35), 1=vivid (2.4)
    const satFactor = 0.35 + Math.min(1, this.rollOnset * 8) * 2.05;
    colors = colors.map(c => satAdjust(c, satFactor)) as RGB[];

    // High flux variability → accent slot shifts toward complementary colour
    const fluxNorm = Math.min(1, this.rollFluxMAD / Math.max(0.01, this.rollFlux));
    if (fluxNorm > 0.35) {
      const src  = colors[0];
      const comp: RGB = [1 - src[0], 1 - src[1], 1 - src[2]];
      colors[3] = lerp3(colors[3], comp, ((fluxNorm - 0.35) / 0.65) * 0.80);
    }

    this.target = colors;

    // ── Lerp current → target (8 s normal, 1.5 s on section change) ──────
    const speed  = wallTimeSec < this.fastUntil ? 1 / 1.5 : 1 / 8.0;
    const αBlend = Math.min(1, dt * speed);
    for (let i = 0; i < 4; i++) {
      this.current[i] = lerp3(this.current[i], this.target[i], αBlend);
    }

    return sectionChange;
  }

  /**
   * Blend mood colours INTO pal[] via HSL-space interpolation (in-place).
   *
   * Hue shifts 40 % toward the mood hue (song character preserved).
   * Saturation shifts 70 % toward mood (energy feel driven by mood).
   * Lightness shifts 30 % toward mood (dark/light structure mostly preserved).
   *
   * This modulates rather than replaces — the existing palette is always visible.
   */
  modulate(pal: THREE.Color[]): void {
    for (let i = 0; i < 4; i++) {
      const [bH, bS, bL] = rgbToHsl(pal[i].r, pal[i].g, pal[i].b);
      const [mH, mS, mL] = rgbToHsl(this.current[i][0], this.current[i][1], this.current[i][2]);

      // Shortest hue arc
      let dH = mH - bH;
      if (dH >  0.5) dH -= 1;
      if (dH < -0.5) dH += 1;

      const h = bH + dH * 0.40;
      const s = Math.min(1, Math.max(0, bS + (mS - bS) * 0.70));
      const l = Math.min(1, Math.max(0, bL + (mL - bL) * 0.30));

      const [r, g, b] = hslToRgb(h, s, l);
      pal[i].setRGB(r, g, b);
    }
  }
}
