import type { LiveAnalysisFrame } from './liveAnalyzer';

// ── Profile types ─────────────────────────────────────────────────────────────

export type ProfileType = 'heavy' | 'ambient' | 'rhythmic' | 'acoustic' | 'chaotic';

export interface ProfileWeights {
  heavy:    number;   // kick-drum heavy, dark reds/oranges
  ambient:  number;   // pads/drones, cool blues/purples
  rhythmic: number;   // electronic/dance, neon cyan/magenta
  acoustic: number;   // guitar/piano/voice, warm ambers/greens
  chaotic:  number;   // noise/experimental, rapid cycling
}

/** All visual parameters derived from the blended profile. */
export interface VisualParams {
  // Color palette hues (0–1)
  hue1: number;
  hue2: number;
  hue3: number;

  // Geometry
  roughness:         number;  // 0=smooth (pads), 1=jagged (noise/drums)
  displacementScale: number;  // multiplier on blob vertex amplitude

  // Post-processing
  bloomStrength:  number;
  chromaAmount:   number;
  grainAmount:    number;

  // Particles
  particleVelocity: number;
  particleOpacity:  number;

  // Camera
  cameraShake:    number;

  // Dominant profile name (highest weight)
  dominant: ProfileType;
}

// ── Per-profile target visual values ─────────────────────────────────────────

interface ProfileDef {
  hue1: number; hue2: number; hue3: number;
  roughness: number; displacementScale: number;
  bloomStrength: number; chromaAmount: number; grainAmount: number;
  particleVelocity: number; particleOpacity: number;
  cameraShake: number;
}

const PROFILE_DEFS: Record<ProfileType, ProfileDef> = {
  // Heavy / percussive — deep kick energy, dark reds and orange fire
  heavy: {
    hue1: 0.02, hue2: 0.07, hue3: 0.97,
    roughness: 0.85, displacementScale: 1.35,
    bloomStrength: 2.2, chromaAmount: 0.007, grainAmount: 0.13,
    particleVelocity: 0.80, particleOpacity: 0.85,
    cameraShake: 0.012,
  },
  // Ambient / atmospheric — pads and drones, cool violet-blue
  ambient: {
    hue1: 0.62, hue2: 0.72, hue3: 0.55,
    roughness: 0.08, displacementScale: 0.65,
    bloomStrength: 1.8, chromaAmount: 0.003, grainAmount: 0.04,
    particleVelocity: 0.15, particleOpacity: 0.40,
    cameraShake: 0.0,
  },
  // Rhythmic / electronic — dance/EDM, neon cyan and magenta
  rhythmic: {
    hue1: 0.47, hue2: 0.88, hue3: 0.50,
    roughness: 0.40, displacementScale: 1.05,
    bloomStrength: 2.5, chromaAmount: 0.008, grainAmount: 0.06,
    particleVelocity: 0.65, particleOpacity: 0.75,
    cameraShake: 0.005,
  },
  // Acoustic / warm — guitar/piano/vocals, amber and green
  acoustic: {
    hue1: 0.10, hue2: 0.28, hue3: 0.14,
    roughness: 0.18, displacementScale: 0.80,
    bloomStrength: 1.4, chromaAmount: 0.004, grainAmount: 0.10,
    particleVelocity: 0.25, particleOpacity: 0.55,
    cameraShake: 0.0,
  },
  // Chaotic / dense — noise/experimental, full-spectrum cycling
  chaotic: {
    hue1: 0.95, hue2: 0.50, hue3: 0.25,
    roughness: 1.00, displacementScale: 1.55,
    bloomStrength: 3.0, chromaAmount: 0.014, grainAmount: 0.16,
    particleVelocity: 1.20, particleOpacity: 0.90,
    cameraShake: 0.020,
  },
};

const PROFILE_KEYS = Object.keys(PROFILE_DEFS) as ProfileType[];

// ── Rolling statistics window ─────────────────────────────────────────────────

interface RollingStats {
  centroid:     number;   // spectral brightness
  flux:         number;   // transient activity
  onsetDensity: number;   // how often onsets occur
  bassRatio:    number;   // bass energy / treble energy
  zcr:          number;   // noisiness
}

// ── Classifier ────────────────────────────────────────────────────────────────

export class AudioProfileClassifier {
  // Rolling stats (slow EWMA — approx 5-second window)
  private rolling: RollingStats = {
    centroid: 0.35, flux: 0.05, onsetDensity: 0.05, bassRatio: 0.8, zcr: 0.15,
  };

  // Current blended weights
  private weights: ProfileWeights = {
    heavy: 0, ambient: 1, rhythmic: 0, acoustic: 0, chaotic: 0,
  };

  // Blended visual params (interpolated toward target each frame)
  private params: VisualParams = this.paramsFromWeights(this.weights);

  // Scene-transition tracking (10-15 second window)
  private txCentroid     = 0.35;
  private txOnsetDensity = 0.05;

  /** Update with the latest audio frame. Returns blended visual params. */
  update(frame: LiveAnalysisFrame, dt: number): VisualParams {
    const hasAudio = frame.bass > 0 || frame.subBass > 0;
    if (!hasAudio) return this.params;

    // ── Update rolling stats (5-second window: α ≈ dt / 5) ──────────────
    const αFast = Math.min(0.15, dt / 1.5);  // ~1.5 s smoothing for responsive feel
    const αSlow = Math.min(0.04, dt / 5.0);  // ~5 s smoothing for classification

    const bassRatio = (frame.subBass + frame.bass) / Math.max(0.001, frame.mids + frame.highs);

    this.rolling.centroid     += (frame.centroid     - this.rolling.centroid)     * αSlow;
    this.rolling.flux         += (frame.flux         - this.rolling.flux)         * αFast;
    this.rolling.onsetDensity += (frame.onsetDensity - this.rolling.onsetDensity) * αSlow;
    this.rolling.bassRatio    += (bassRatio           - this.rolling.bassRatio)   * αSlow;
    this.rolling.zcr          += (frame.zcr           - this.rolling.zcr)         * αSlow;

    // ── Compute raw profile scores ────────────────────────────────────────
    const { centroid, flux, onsetDensity, bassRatio: br, zcr } = this.rolling;

    const sat = (x: number) => Math.max(0, Math.min(1, x));

    const rawScores: Record<ProfileType, number> = {
      // Heavy: high bass ratio + high onset density + high flux
      heavy:    sat(br * onsetDensity * flux * 6),
      // Ambient: low onset density + low flux
      ambient:  sat((1 - onsetDensity) * (1 - flux) * 0.95),
      // Rhythmic: high onset + high centroid + NOT bass-heavy
      rhythmic: sat(centroid * onsetDensity * Math.max(0, 1 - br * 0.5) * 4),
      // Acoustic: mid centroid, low ZCR, low onset, harmonics
      acoustic: sat((1 - zcr) * (0.6 - Math.abs(centroid - 0.28)) * 4 * (1 - onsetDensity * 0.6)),
      // Chaotic: high ZCR + high flux
      chaotic:  sat(zcr * flux * 6),
    };

    // Normalize so weights sum to 1
    const total = PROFILE_KEYS.reduce((s, k) => s + rawScores[k], 0) || 1;
    const targetWeights = {} as ProfileWeights;
    for (const k of PROFILE_KEYS) targetWeights[k] = rawScores[k] / total;

    // Smooth transition toward target (2–3 second blend)
    const αBlend = Math.min(0.02, dt / 2.5);
    for (const k of PROFILE_KEYS) {
      this.weights[k] += (targetWeights[k] - this.weights[k]) * αBlend;
    }

    // ── Compute blended visual params ─────────────────────────────────────
    const target = this.paramsFromWeights(this.weights);

    // Smooth visual params (fast: 0.3 s, so they don't lag behind the music)
    const αVis = Math.min(0.25, dt / 0.3);
    const p    = this.params;
    for (const key of Object.keys(target) as (keyof VisualParams)[]) {
      if (key === 'dominant') continue;
      (p as unknown as Record<string, number>)[key] +=
        ((target[key] as number) - (p[key] as number)) * αVis;
    }
    p.dominant = target.dominant;

    return { ...this.params };
  }

  /** Returns the current (already-smoothed) params without recalculating. */
  getParams(): VisualParams { return { ...this.params }; }

  /**
   * Returns true when the long-term spectral profile has shifted enough to
   * warrant a scene transition. Caller should rate-limit this.
   */
  checkTransition(frame: LiveAnalysisFrame, dt: number): boolean {
    const αTx = Math.min(0.01, dt / 12.0);  // ~12-second window

    const prevC  = this.txCentroid;
    const prevOD = this.txOnsetDensity;

    this.txCentroid     += (frame.centroid     - this.txCentroid)     * αTx;
    this.txOnsetDensity += (frame.onsetDensity - this.txOnsetDensity) * αTx;

    const centroidShift = Math.abs(frame.centroid - prevC) / Math.max(0.05, prevC);
    const onsetShift    = Math.abs(frame.onsetDensity - prevOD) / Math.max(0.005, prevOD);

    return centroidShift > 0.30 || onsetShift > 1.2;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private paramsFromWeights(w: ProfileWeights): VisualParams {
    const blend = (key: keyof ProfileDef): number =>
      PROFILE_KEYS.reduce((s, p) => s + PROFILE_DEFS[p][key] * w[p], 0);

    // Dominant profile = highest weight
    const dominant = PROFILE_KEYS.reduce((a, b) => w[a] > w[b] ? a : b);

    return {
      hue1:              blend('hue1'),
      hue2:              blend('hue2'),
      hue3:              blend('hue3'),
      roughness:         blend('roughness'),
      displacementScale: blend('displacementScale'),
      bloomStrength:     blend('bloomStrength'),
      chromaAmount:      blend('chromaAmount'),
      grainAmount:       blend('grainAmount'),
      particleVelocity:  blend('particleVelocity'),
      particleOpacity:   blend('particleOpacity'),
      cameraShake:       blend('cameraShake'),
      dominant,
    };
  }
}
