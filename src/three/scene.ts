import * as THREE from 'three';
import { LiveAnalyzer }               from './liveAnalyzer';
import { MoodPaletteSystem }          from './moodPalette';
import { vasarelyVert, vasarelyFrag } from './shaders/vasarely';
import type { AudioSourceMode }       from './liveAnalyzer';
import type { AudioAnalysis, AudioFeatures } from '../spotify/types';

interface PlaybackRefs {
  positionRef:          React.MutableRefObject<number>;
  positionTimestampRef: React.MutableRefObject<number>;
  isPlayingRef:         React.MutableRefObject<boolean>;
}

// ── Palettes — 8 four-colour sets, all flat/saturated ─────────────────────────
type RGB = [number, number, number];
const PALETTES: [RGB, RGB, RGB, RGB][] = [
  [[0.04, 0.04, 0.20], [0.97, 0.84, 0.06], [0.91, 0.18, 0.08], [0.97, 0.94, 0.87]], // classic
  [[0.06, 0.06, 0.06], [0.94, 0.94, 0.94], [0.22, 0.22, 0.22], [0.78, 0.78, 0.78]], // B&W
  [[0.06, 0.12, 0.42], [0.40, 0.88, 0.20], [0.22, 0.40, 0.08], [0.76, 0.88, 0.96]], // cobalt/lime
  [[0.12, 0.04, 0.30], [0.84, 0.10, 0.55], [0.96, 0.55, 0.08], [0.95, 0.92, 0.84]], // purple/magenta
  [[0.06, 0.30, 0.32], [0.92, 0.38, 0.28], [0.86, 0.74, 0.52], [0.04, 0.07, 0.10]], // teal/coral
  [[0.74, 0.08, 0.08], [0.95, 0.50, 0.08], [0.98, 0.90, 0.10], [0.04, 0.04, 0.04]], // crimson/amber
  [[0.12, 0.08, 0.55], [0.10, 0.80, 0.90], [0.28, 0.95, 0.65], [0.04, 0.06, 0.20]], // indigo/cyan
  [[0.72, 0.58, 0.10], [0.70, 0.28, 0.10], [0.95, 0.90, 0.78], [0.14, 0.08, 0.04]], // ochre/sienna
];

const NUM_COMPS  = 10;
const BLEND_SECS = 2.0;
const AUTO_CYCLE = 30.0;  // seconds before auto-advancing without Spotify

// ── Per-song seed — everything that changes per song ──────────────────────────
interface SongSeed {
  comp:         number;            // 0–9
  palIdx:       number;            // 0–7
  // Continuous (lerped during crossfade)
  warpCenters:  [number, number][]; // 4 entries, in aspect-corrected UV space
  gridDensity:  number;            // 20–60
  gridRotation: number;            // radians
  // Discrete (snap immediately)
  cellShape:    number;            // 0=circle 1=square 2=diamond 3=rounded-rect
  colorBandDir: number;            // 0=concentric 1=horizontal 2=diagonal 3=spiral
  numWarps:     number;            // 1–4
  mirrorN:      number;            // 4 / 5 / 6
  headPosX:     number;            // head-1 x offset: negative=left-third, positive=right-third
}

export class VisualizerScene {
  private scene:    THREE.Scene;
  private camera:   THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private liveAnalyzer: LiveAnalyzer;

  // All uniforms typed explicitly so TypeScript catches mistakes
  private uni: {
    uTime:        THREE.IUniform<number>;
    uBass:        THREE.IUniform<number>;
    uMids:        THREE.IUniform<number>;
    uHighs:       THREE.IUniform<number>;
    uFlux:        THREE.IUniform<number>;
    uBeat:        THREE.IUniform<number>;
    uCentroid:    THREE.IUniform<number>;
    uComp:        THREE.IUniform<number>;
    uPrevComp:    THREE.IUniform<number>;
    uBlend:       THREE.IUniform<number>;
    uC0:          THREE.IUniform<THREE.Color>;
    uC1:          THREE.IUniform<THREE.Color>;
    uC2:          THREE.IUniform<THREE.Color>;
    uC3:          THREE.IUniform<THREE.Color>;
    uWarp0:       THREE.IUniform<THREE.Vector2>;
    uWarp1:       THREE.IUniform<THREE.Vector2>;
    uWarp2:       THREE.IUniform<THREE.Vector2>;
    uWarp3:       THREE.IUniform<THREE.Vector2>;
    uGridDensity: THREE.IUniform<number>;
    uGridRotation:THREE.IUniform<number>;
    uCellShape:   THREE.IUniform<number>;
    uColorBandDir:THREE.IUniform<number>;
    uNumWarps:    THREE.IUniform<number>;
    uMirrorN:     THREE.IUniform<number>;
    uResolution:     THREE.IUniform<THREE.Vector2>;
    uVocalStrength:  THREE.IUniform<number>;
    uVocalStrength2: THREE.IUniform<number>;
    uVocalMouth:     THREE.IUniform<number>;
    uHeadPos:        THREE.IUniform<number>;
  };

  private moodSystem:   MoodPaletteSystem;

  private animFrameId:  number | null = null;
  private lastFrameTime = 0;
  private startTime     = performance.now();
  private beatLevel     = 0;
  private vocalFade     = 0;   // 0–1, smoothed vocal presence (0.5 s in / 0.8 s out)
  private vocalFade2    = 0;   // 0–1, second silhouette (strong vocal energy)
  private vocalMouth    = 0;   // 0–1, fast mouth open/close (~17 Hz)

  // Crossfade state
  private blend    = 1.0;
  private palBlend = 1.0;

  // Smooth palette colours (lerped JS-side, uploaded as vec3 uniforms)
  private smoothPal = Array.from({ length: 4 }, () => new THREE.Color());

  // Per-song seeds (prev + current)
  private curSeed:  SongSeed;
  private prevSeed: SongSeed;

  private lastAutoAdvance = 0;

  // API-compat stubs
  private _features: AudioFeatures | null = null;
  private _analysis: AudioAnalysis | null = null;
  private _playbackRefs: PlaybackRefs | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const w = canvas.clientWidth  || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene  = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Bootstrap seeds (use a no-previous sentinel)
    const bootstrap = this.makeSeed(null, w / h);
    this.curSeed  = bootstrap;
    this.prevSeed = bootstrap;

    // Initialise smooth palette from seed 0
    this.applyPalInstant(bootstrap.palIdx);

    this.uni = {
      uTime:        { value: 0 },
      uBass:        { value: 0 },
      uMids:        { value: 0 },
      uHighs:       { value: 0 },
      uFlux:        { value: 0 },
      uBeat:        { value: 0 },
      uCentroid:    { value: 0 },
      uComp:        { value: bootstrap.comp },
      uPrevComp:    { value: bootstrap.comp },
      uBlend:       { value: 1 },
      uC0:          { value: this.smoothPal[0] },
      uC1:          { value: this.smoothPal[1] },
      uC2:          { value: this.smoothPal[2] },
      uC3:          { value: this.smoothPal[3] },
      uWarp0:       { value: new THREE.Vector2(...bootstrap.warpCenters[0]) },
      uWarp1:       { value: new THREE.Vector2(...bootstrap.warpCenters[1]) },
      uWarp2:       { value: new THREE.Vector2(...bootstrap.warpCenters[2]) },
      uWarp3:       { value: new THREE.Vector2(...bootstrap.warpCenters[3]) },
      uGridDensity: { value: bootstrap.gridDensity },
      uGridRotation:{ value: bootstrap.gridRotation },
      uCellShape:   { value: bootstrap.cellShape },
      uColorBandDir:{ value: bootstrap.colorBandDir },
      uNumWarps:    { value: bootstrap.numWarps },
      uMirrorN:     { value: bootstrap.mirrorN },
      uResolution:     { value: new THREE.Vector2(w, h) },
      uVocalStrength:  { value: 0 },
      uVocalStrength2: { value: 0 },
      uVocalMouth:     { value: 0 },
      uHeadPos:        { value: bootstrap.headPosX },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader:   vasarelyVert,
      fragmentShader: vasarelyFrag,
      uniforms: this.uni as unknown as { [k: string]: THREE.IUniform },
    });

    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    this.liveAnalyzer = new LiveAnalyzer();
    this.moodSystem   = new MoodPaletteSystem();
    this.lastFrameTime = performance.now();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  triggerChange() { this.advanceComposition(); }

  setFeatures(f: AudioFeatures) { this._features = f; }
  setAnalysis(a: AudioAnalysis | null) { this._analysis = a; }
  setPlaybackRefs(refs: PlaybackRefs) { this._playbackRefs = refs; }

  resumeAudio() { this.liveAnalyzer.resume(); }

  async startLiveCapture(): Promise<AudioSourceMode> {
    return this.liveAnalyzer.startLiveCapture();
  }

  async startMicCapture(): Promise<AudioSourceMode> {
    return this.liveAnalyzer.startMicCapture();
  }

  get audioMode(): AudioSourceMode { return this.liveAnalyzer.mode; }

  loadPreview(url: string | null) {
    if (!url) return;
    this.liveAnalyzer.loadPreview(url).catch(e => console.warn('[LiveAnalyzer]', e));
  }

  start() {
    this.startTime       = performance.now();
    this.lastFrameTime   = performance.now();
    this.lastAutoAdvance = 0;
    document.addEventListener('click',   this.unlockAudio, { capture: true });
    document.addEventListener('keydown', this.unlockAudio, { capture: true });
    this.animLoop();
  }

  stop() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
    this.uni.uResolution.value.set(width, height);
  }

  dispose() {
    document.removeEventListener('click',   this.unlockAudio, { capture: true });
    document.removeEventListener('keydown', this.unlockAudio, { capture: true });
    this.stop();
    this.liveAnalyzer.dispose();
    this.renderer.dispose();
  }

  // ── Seed generation ───────────────────────────────────────────────────────

  /** Build a new randomised seed that differs from `prev` in comp and palette. */
  private makeSeed(prev: SongSeed | null, aspect: number): SongSeed {
    const r    = () => Math.random();
    const diff = (cur: number, max: number) => {
      let n = Math.floor(r() * max);
      if (n === cur) n = (n + 1) % max;
      return n;
    };
    const pick = <T>(arr: T[]) => arr[Math.floor(r() * arr.length)];

    const comp   = prev ? diff(prev.comp,   NUM_COMPS)      : Math.floor(r() * NUM_COMPS);
    const palIdx = prev ? diff(prev.palIdx, PALETTES.length) : Math.floor(r() * PALETTES.length);

    // Warp centres: scatter within ±65% of each axis (aspect-corrected)
    const warpCenters = Array.from({ length: 4 }, (): [number, number] => [
      (r() * 2 - 1) * 0.65 * aspect,
      (r() * 2 - 1) * 0.65,
    ]);

    // Head position: randomly in left or right third of screen.
    // Negative = left side (head faces right), positive = right side (head faces left).
    const headSide = r() < 0.5 ? -1 : 1;
    const headPosX = headSide * (0.35 + r() * 0.12);

    return {
      comp,
      palIdx,
      warpCenters,
      gridDensity:  20 + r() * 40,                             // 20–60
      gridRotation: pick([0, Math.PI / 12, Math.PI / 6, Math.PI / 4]),
      cellShape:    Math.floor(r() * 4),                       // 0–3
      colorBandDir: Math.floor(r() * 4),                       // 0–3
      // multi-bulge (comp 7) prefers 2–4 warps; others 1–2
      numWarps:     comp === 7 ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2),
      mirrorN:      pick([4, 5, 6]),
      headPosX,
    };
  }

  private advanceComposition() {
    const aspect = this.uni.uResolution.value.x /
                   Math.max(1, this.uni.uResolution.value.y);

    this.prevSeed = this.curSeed;
    this.curSeed  = this.makeSeed(this.curSeed, aspect);

    this.blend    = 0;
    this.palBlend = 0;

    // Discrete params snap immediately
    this.uni.uCellShape.value    = this.curSeed.cellShape;
    this.uni.uColorBandDir.value = this.curSeed.colorBandDir;
    this.uni.uNumWarps.value     = this.curSeed.numWarps;
    this.uni.uMirrorN.value      = this.curSeed.mirrorN;
    this.uni.uComp.value         = this.curSeed.comp;
    this.uni.uPrevComp.value     = this.prevSeed.comp;
    this.uni.uHeadPos.value      = this.curSeed.headPosX;
  }

  // ── Palette helpers ───────────────────────────────────────────────────────

  private applyPalInstant(idx: number) {
    const p = PALETTES[idx];
    for (let i = 0; i < 4; i++) {
      if (!this.smoothPal[i]) this.smoothPal[i] = new THREE.Color();
      this.smoothPal[i].setRGB(p[i][0], p[i][1], p[i][2]);
    }
  }

  private stepPalette() {
    const t  = this.palBlend;
    const cp = PALETTES[this.curSeed.palIdx];
    const pp = PALETTES[this.prevSeed.palIdx];
    for (let i = 0; i < 4; i++) {
      this.smoothPal[i].setRGB(
        pp[i][0] + (cp[i][0] - pp[i][0]) * t,
        pp[i][1] + (cp[i][1] - pp[i][1]) * t,
        pp[i][2] + (cp[i][2] - pp[i][2]) * t,
      );
    }
  }

  // ── Animation loop ────────────────────────────────────────────────────────

  private unlockAudio = () => { this.liveAnalyzer.resume(); };

  private get elapsedSec() { return (performance.now() - this.startTime) / 1000; }

  private animLoop = () => {
    this.animFrameId = requestAnimationFrame(this.animLoop);

    const now = performance.now();
    const dt  = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;
    const t = this.elapsedSec;

    // ── Auto-advance ──────────────────────────────────────────────────────
    if (t - this.lastAutoAdvance > AUTO_CYCLE && this.blend >= 1) {
      this.lastAutoAdvance = t;
      this.advanceComposition();
    }

    // ── Advance blend ─────────────────────────────────────────────────────
    this.blend    = Math.min(1, this.blend    + dt / BLEND_SECS);
    this.palBlend = Math.min(1, this.palBlend + dt / BLEND_SECS);
    this.stepPalette();
    this.uni.uBlend.value = this.blend;

    // ── Lerp continuous seed params (warp centres, density, rotation) ─────
    const bl = this.blend;
    const cs = this.curSeed;
    const ps = this.prevSeed;

    this.uni.uGridDensity.value = ps.gridDensity + (cs.gridDensity - ps.gridDensity) * bl;

    // Shortest-arc lerp for rotation angle
    let dRot = cs.gridRotation - ps.gridRotation;
    if (dRot >  Math.PI) dRot -= 2 * Math.PI;
    if (dRot < -Math.PI) dRot += 2 * Math.PI;
    this.uni.uGridRotation.value = ps.gridRotation + dRot * bl;

    const warps = [this.uni.uWarp0, this.uni.uWarp1, this.uni.uWarp2, this.uni.uWarp3] as const;
    for (let i = 0; i < 4; i++) {
      warps[i].value.set(
        ps.warpCenters[i][0] + (cs.warpCenters[i][0] - ps.warpCenters[i][0]) * bl,
        ps.warpCenters[i][1] + (cs.warpCenters[i][1] - ps.warpCenters[i][1]) * bl,
      );
    }

    // ── Audio ─────────────────────────────────────────────────────────────
    const live = this.liveAnalyzer.tick(t);

    if (live.beat.fired) {
      this.beatLevel = Math.max(this.beatLevel, 0.5 + live.beat.confidence * 0.5);
    }
    this.beatLevel *= Math.pow(0.78, dt * 60);

    this.uni.uTime.value     = t;
    this.uni.uBass.value     = Math.min(1, live.subBass * 1.4 + live.bass * 0.6);
    this.uni.uMids.value     = Math.min(1, live.mids    * 1.2);
    this.uni.uHighs.value    = Math.min(1, live.highs   * 1.3);
    this.uni.uFlux.value     = Math.min(1, live.flux    * 1.5);
    this.uni.uBeat.value     = this.beatLevel;
    this.uni.uCentroid.value = live.centroid;

    // Vocal silhouette — asymmetric fade: 0.5 s in, 0.8 s out
    const αIn  = Math.min(1, dt / 0.5);
    const αOut = Math.min(1, dt / 0.8);

    const vTarget  = live.vocalDetected ? 1 : 0;
    const v2Target = live.vocalDetected && live.mids > 0.5 ? 1 : 0;
    this.vocalFade  += (vTarget  - this.vocalFade)  * (vTarget  > this.vocalFade  ? αIn : αOut);
    this.vocalFade2 += (v2Target - this.vocalFade2) * (v2Target > this.vocalFade2 ? αIn : αOut);
    this.uni.uVocalStrength.value  = this.vocalFade;
    this.uni.uVocalStrength2.value = this.vocalFade2;

    // Mouth open/close — fast ~17 Hz response using unsmoothed raw mids
    const mouthTarget  = live.vocalDetected ? Math.min(1, live.rawMids * 2.5) : 0;
    this.vocalMouth   += (mouthTarget - this.vocalMouth) * Math.min(1, dt / 0.06);
    this.uni.uVocalMouth.value = this.vocalMouth;

    // ── Mood-driven palette modulation ────────────────────────────────────
    // stepPalette() already wrote the song-palette lerp into smoothPal above.
    // moodSystem.update() computes the rolling 5 s mood target and lerps toward it.
    // moodSystem.modulate() blends mood INTO smoothPal via HSL interpolation —
    // hue 40 %, saturation 70 %, lightness 30 % — modulating not replacing.
    this.moodSystem.update(live, dt, t);
    this.moodSystem.modulate(this.smoothPal);

    this.renderer.render(this.scene, this.camera);
  };
}
