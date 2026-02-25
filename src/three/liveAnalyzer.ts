export interface LiveAnalysisFrame {
  // ── Frequency bands (EMA-smoothed, 0–1) ───────────────────────────────────
  subBass:    number;   // 0–60 Hz
  bass:       number;   // 60–250 Hz
  mids:       number;   // 250–2 kHz  (EMA-smoothed)
  highs:      number;   // 2–6 kHz
  brilliance: number;   // 6 kHz+
  rawMids:    number;   // 250–2 kHz, un-smoothed — for fast mouth animation

  // ── Spectral shape features (0–1) ─────────────────────────────────────────
  centroid:   number;   // weighted mean frequency — 0=dark/heavy, 1=bright/airy
  flux:       number;   // frame-to-frame energy change — 0=sustained, 1=transient
  rolloff:    number;   // 85th-percentile frequency — low=heavy, high=bright
  zcr:        number;   // zero-crossing-rate proxy — 0=tonal, 1=noisy/percussive

  // ── Per-band onset detection ───────────────────────────────────────────────
  onsets: {
    subBass: boolean;   // kick drum
    bass:    boolean;   // low percussive hit
    mids:    boolean;   // snare / clap
    highs:   boolean;   // hi-hat / cymbal
  };

  // Fraction of recent frames with any onset (0–1), roughly "onset density"
  onsetDensity: number;

  // ── Vocal detection ──────────────────────────────────────────────────────────
  vocalDetected: boolean;   // mids (300 Hz–3 kHz) dominate over a 500 ms window

  // ── Beat and tempo ─────────────────────────────────────────────────────────
  beat: { fired: boolean; confidence: number };
  bpm:  number;
}

export type AudioSourceMode = 'idle' | 'preview' | 'live' | 'mic';

export class LiveAnalyzer {
  readonly ctx: AudioContext;

  private analyser:     AnalyserNode | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  private activeStream: MediaStream | null = null;
  private dataArray:    Uint8Array<ArrayBuffer> | null = null;
  private prevDataArray: Uint8Array | null = null;   // for spectral flux

  private _mode: AudioSourceMode = 'idle';
  get mode(): AudioSourceMode { return this._mode; }

  // ── EMA band smooths ──────────────────────────────────────────────────────
  private smSubBass    = 0;
  private smBass       = 0;
  private smMids       = 0;
  private smHighs      = 0;
  private smBrilliance = 0;

  // ── Spectral EMA smooths ──────────────────────────────────────────────────
  private smCentroid = 0.5;
  private smFlux     = 0;
  private smRolloff  = 0.3;
  private smZCR      = 0;

  // ── Per-band onset rolling averages (500 ms window ≈ α=0.967 @ 60 fps) ───
  private onsetRolling = { subBass: 0, bass: 0, mids: 0, highs: 0 };
  private lastOnset    = { subBass: -1, bass: -1, mids: -1, highs: -1 };

  // Onset density: fraction of recent frames with any onset
  private onsetDensitySmooth = 0;

  // ── Vocal detection rolling averages (500 ms window, same α as onset) ────────
  private vocalMidsRolling     = 0;
  private vocalBassHighRolling = 0;

  // ── Beat detection (raw bass) ─────────────────────────────────────────────
  private rollingBass    = 20;
  private lastBeatTime   = -1;
  private beatIntervals: number[] = [];
  private _bpm           = 120;

  constructor() {
    this.ctx = new AudioContext();
  }

  resume() {
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  /**
   * Capture the audio playing in this browser tab using getDisplayMedia.
   * Stream → AnalyserNode only; NOT connected to destination (no echo).
   */
  async startLiveCapture(): Promise<AudioSourceMode> {
    this.disposeSource();
    await this.ctx.resume();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const constraints: any = {
      audio: {
        suppressLocalAudioPlayback: false,
        noiseSuppression:  false,
        echoCancellation:  false,
        autoGainControl:   false,
        sampleRate:        44100,
      },
      video: { displaySurface: 'browser' },
      preferCurrentTab:   true,
      selfBrowserSurface: 'include',
    };

    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    stream.getVideoTracks().forEach(t => t.stop());

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error(
        'No audio was captured. In the share dialog, select the browser tab and make sure "Share tab audio" is checked.'
      );
    }

    this.connectStream(stream);
    this._mode = 'live';
    return 'live';
  }

  /**
   * Fallback: capture microphone audio for analysis on mobile.
   * Stream → AnalyserNode only; NOT connected to destination (no feedback).
   */
  async startMicCapture(): Promise<AudioSourceMode> {
    this.disposeSource();
    await this.ctx.resume();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl:  false,
      },
    });

    this.connectStream(stream);
    this._mode = 'mic';
    return 'mic';
  }

  /**
   * Fallback: decode a 30s preview MP3 and play it audibly.
   * source → analyser → destination (user hears the preview).
   */
  async loadPreview(previewUrl: string): Promise<void> {
    if (this._mode === 'live') return;
    this.disposeSource();

    const analyser = this.ctx.createAnalyser();
    analyser.fftSize               = 2048;
    analyser.smoothingTimeConstant = 0;
    this.analyser  = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

    const proxyUrl = previewUrl.startsWith('https://p.scdn.co')
      ? previewUrl.replace('https://p.scdn.co', '/preview')
      : previewUrl;

    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error(`Preview fetch failed: ${res.status}`);
    const decoded = await this.ctx.decodeAudioData(await res.arrayBuffer());

    const source = this.ctx.createBufferSource();
    source.buffer = decoded;
    source.loop   = true;
    source.connect(analyser);
    analyser.connect(this.ctx.destination);
    source.start(0);
    this.bufferSource = source;
    this._mode = 'preview';
  }

  private connectStream(stream: MediaStream) {
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize               = 2048;
    analyser.smoothingTimeConstant = 0;
    this.analyser  = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    this.streamSource = source;
    this.activeStream = stream;

    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      this.disposeSource();
      this._mode = 'idle';
    });
  }

  // ── Per-frame analysis ────────────────────────────────────────────────────

  tick(wallTimeSec: number): LiveAnalysisFrame {
    const zero: LiveAnalysisFrame = {
      subBass: 0, bass: 0, mids: 0, highs: 0, brilliance: 0, rawMids: 0,
      centroid: this.smCentroid, flux: 0, rolloff: 0.3, zcr: 0,
      onsets: { subBass: false, bass: false, mids: false, highs: false },
      onsetDensity: 0,
      beat: { fired: false, confidence: 0 }, bpm: this._bpm,
      vocalDetected: false,
    };
    if (!this.analyser || !this.dataArray || this.ctx.state !== 'running') return zero;

    this.analyser.getByteFrequencyData(this.dataArray);

    const binCount = this.dataArray.length;          // 1024 for fftSize=2048
    const nyquist  = this.ctx.sampleRate / 2;        // 22050 Hz
    const hzPerBin = nyquist / binCount;             // ~21.5 Hz/bin

    // ── Accumulate raw band sums ──────────────────────────────────────────
    let subBassSum = 0, subBassCount = 0;
    let bassSum    = 0, bassCount    = 0;
    let midsSum    = 0, midsCount    = 0;
    let highsSum   = 0, highsCount   = 0;
    let brillSum   = 0, brillCount   = 0;

    // For spectral features
    let weightedBinSum = 0;   // for centroid
    let totalMag       = 0;
    let fluxSum        = 0;   // half-wave rectified flux

    for (let i = 0; i < binCount; i++) {
      const v  = this.dataArray[i];
      const hz = i * hzPerBin;

      // Band sums
      if      (hz <    60) { subBassSum += v; subBassCount++; }
      else if (hz <   250) { bassSum    += v; bassCount++;    }
      else if (hz <  2000) { midsSum    += v; midsCount++;    }
      else if (hz <  6000) { highsSum   += v; highsCount++;   }
      else                 { brillSum   += v; brillCount++;   }

      // Spectral moments
      weightedBinSum += i * v;
      totalMag       += v;

      // Flux: positive-only difference from last frame
      const prev = this.prevDataArray ? this.prevDataArray[i] : 0;
      fluxSum += Math.max(0, v - prev);
    }

    // ── Band normalisation ────────────────────────────────────────────────
    const amp = this._mode === 'live' ? 2.0 : 4.0;

    const rawSubBass    = subBassCount ? Math.min(1, (subBassSum / subBassCount / 255) * amp) : 0;
    const rawBass       = bassCount    ? Math.min(1, (bassSum    / bassCount    / 255) * amp) : 0;
    const rawMids       = midsCount    ? Math.min(1, (midsSum    / midsCount    / 255) * amp) : 0;
    const rawHighs      = highsCount   ? Math.min(1, (highsSum   / highsCount   / 255) * amp) : 0;
    const rawBrilliance = brillCount   ? Math.min(1, (brillSum   / brillCount   / 255) * amp) : 0;

    // ── Band EMA (0.85 retain) ────────────────────────────────────────────
    const S = 0.85;
    this.smSubBass    = this.smSubBass    * S + rawSubBass    * (1 - S);
    this.smBass       = this.smBass       * S + rawBass       * (1 - S);
    this.smMids       = this.smMids       * S + rawMids       * (1 - S);
    this.smHighs      = this.smHighs      * S + rawHighs      * (1 - S);
    this.smBrilliance = this.smBrilliance * S + rawBrilliance * (1 - S);

    // ── Spectral centroid (brightness = weighted mean frequency, 0–1) ─────
    const rawCentroid = totalMag > 0 ? (weightedBinSum / totalMag) / binCount : 0;
    this.smCentroid = this.smCentroid * 0.88 + rawCentroid * 0.12;

    // ── Spectral flux (frame-to-frame change, half-wave rectified) ────────
    const rawFlux = fluxSum / (binCount * 255);
    this.smFlux = this.smFlux * 0.70 + rawFlux * 0.30;  // less smoothing = more responsive

    // ── Spectral rolloff (frequency below which 85% of energy sits) ──────
    const targetEnergy = totalMag * 0.85;
    let accumulated = 0, rolloffBin = 0;
    for (let i = 0; i < binCount; i++) {
      accumulated += this.dataArray[i];
      if (accumulated >= targetEnergy) { rolloffBin = i; break; }
    }
    const rawRolloff = binCount > 0 ? rolloffBin / binCount : 0;
    this.smRolloff = this.smRolloff * 0.90 + rawRolloff * 0.10;

    // ── ZCR approximation (high-freq energy ratio → noisiness) ───────────
    // High brilliance relative to total signal = noisy/percussive
    const avgBrill = brillCount ? brillSum / brillCount : 0;
    const avgTotal = totalMag / binCount;
    const rawZCR = avgTotal > 0 ? Math.min(1, (avgBrill / avgTotal) * 3.0) : 0;
    this.smZCR = this.smZCR * 0.88 + rawZCR * 0.12;

    // ── Per-band onset detection (energy > 1.5× rolling 500ms average) ───
    const αo         = 0.967;  // ~500 ms window at 60 fps
    const ONSET_MULT = 1.5;
    const ONSET_MIN  = 6;      // absolute threshold (out of 255)
    const ONSET_GAP  = 0.12;   // min gap between same-band onsets (seconds)

    const rawBands = {
      subBass: subBassCount ? subBassSum / subBassCount : 0,
      bass:    bassCount    ? bassSum    / bassCount    : 0,
      mids:    midsCount    ? midsSum    / midsCount    : 0,
      highs:   highsCount   ? highsSum   / highsCount   : 0,
    };

    const onsets = { subBass: false, bass: false, mids: false, highs: false };

    for (const band of ['subBass', 'bass', 'mids', 'highs'] as const) {
      const raw = rawBands[band];
      this.onsetRolling[band] = this.onsetRolling[band] * αo + raw * (1 - αo);
      const threshold = Math.max(ONSET_MIN, this.onsetRolling[band] * ONSET_MULT);
      if (raw > threshold && wallTimeSec - this.lastOnset[band] > ONSET_GAP) {
        onsets[band] = true;
        this.lastOnset[band] = wallTimeSec;
      }
    }

    // Onset density: EWMA of "any onset this frame"
    const anyOnset = onsets.subBass || onsets.bass || onsets.mids || onsets.highs;
    this.onsetDensitySmooth = this.onsetDensitySmooth * 0.992 + (anyOnset ? 1 : 0) * 0.008;

    // ── Vocal detection: mids (300 Hz–3 kHz) dominate over bass + highs ──────
    const rawVocalMids = midsCount  ? midsSum  / midsCount  : 0;
    const rawVocalBH   = ((bassCount  ? bassSum  / bassCount  : 0) +
                          (highsCount ? highsSum / highsCount : 0)) * 0.5;
    this.vocalMidsRolling     = this.vocalMidsRolling     * αo + rawVocalMids * (1 - αo);
    this.vocalBassHighRolling = this.vocalBassHighRolling * αo + rawVocalBH   * (1 - αo);
    const vocalDetected = this.vocalMidsRolling > this.vocalBassHighRolling * 1.5
                       && this.vocalMidsRolling > 4;

    // ── Beat detection on raw bass (pre-EMA for snappiness) ──────────────
    const bassAvg = rawBands.bass;
    this.rollingBass = this.rollingBass * 0.94 + bassAvg * 0.06;
    const beatThreshold = Math.max(6, this.rollingBass * 1.4);
    const gapOk         = this.lastBeatTime < 0 || (wallTimeSec - this.lastBeatTime) > 0.18;
    const beatFired     = bassAvg > beatThreshold && gapOk;

    let confidence = 0;
    if (beatFired) {
      confidence = Math.min(1, (bassAvg - beatThreshold) / Math.max(1, beatThreshold));
      if (this.lastBeatTime >= 0) {
        const gap = wallTimeSec - this.lastBeatTime;
        if (gap < 2.0) {
          this.beatIntervals.push(gap);
          if (this.beatIntervals.length > 8) this.beatIntervals.shift();
          if (this.beatIntervals.length >= 2) {
            const avg = this.beatIntervals.reduce((a, b) => a + b, 0) / this.beatIntervals.length;
            this._bpm = Math.round(60 / avg);
          }
        }
      }
      this.lastBeatTime = wallTimeSec;
    }

    // ── Store frame for next flux calculation ─────────────────────────────
    if (!this.prevDataArray) this.prevDataArray = new Uint8Array(binCount);
    this.prevDataArray.set(this.dataArray);

    return {
      subBass:    this.smSubBass,
      bass:       this.smBass,
      mids:       this.smMids,
      highs:      this.smHighs,
      brilliance: this.smBrilliance,
      centroid:   this.smCentroid,
      flux:       this.smFlux,
      rolloff:    this.smRolloff,
      zcr:        this.smZCR,
      onsets,
      onsetDensity: this.onsetDensitySmooth,
      beat: { fired: beatFired, confidence },
      bpm: this._bpm,
      vocalDetected,
      rawMids: rawMids,
    };
  }

  private disposeSource() {
    this.activeStream?.getTracks().forEach(t => t.stop());
    this.activeStream = null;
    this.streamSource?.disconnect();
    this.streamSource = null;
    if (this.bufferSource) {
      try { this.bufferSource.stop(); } catch {}
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }
    if (this.analyser) { this.analyser.disconnect(); this.analyser = null; }
    this.dataArray     = null;
    this.prevDataArray = null;
    this.smSubBass    = 0; this.smBass = 0; this.smMids = 0;
    this.smHighs      = 0; this.smBrilliance = 0;
    this.smCentroid   = 0.5; this.smFlux = 0; this.smRolloff = 0.3; this.smZCR = 0;
    this.onsetRolling = { subBass: 0, bass: 0, mids: 0, highs: 0 };
    this.lastOnset    = { subBass: -1, bass: -1, mids: -1, highs: -1 };
    this.onsetDensitySmooth  = 0;
    this.vocalMidsRolling    = 0;
    this.vocalBassHighRolling = 0;
    this.rollingBass   = 20;
    this.lastBeatTime  = -1;
    this.beatIntervals = [];
    this._mode = 'idle';
  }

  dispose() {
    this.disposeSource();
    this.ctx.close().catch(() => {});
  }
}
