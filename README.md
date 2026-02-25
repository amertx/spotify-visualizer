# Spotify Visualizer

A real-time WebGL music visualizer that connects to Spotify and generates reactive, procedurally animated visuals driven entirely by live audio analysis — no pre-baked animations, no beat maps. Every frame is computed from the raw frequency spectrum of whatever is playing.

Built with Vite + React + TypeScript + Three.js + Web Audio API.

---

## Features

- **Vasarely-style WebGL shader** — 10 procedural compositions (concentric rings, hex grids, radial spirals, Moiré fields, etc.) with 8 hand-tuned color palettes. Smooth 2-second crossfades between compositions on every track change
- **Real-time FFT audio analysis** — sub-bass, bass, mids, highs, and brilliance bands extracted every frame via `AnalyserNode`. Spectral centroid, flux, rolloff, and ZCR computed alongside per-band onset detection and BPM tracking
- **Mood-driven color modulation** — rolling 5-second mood vector (energy × spectral brightness) mapped across four mood corners (brooding / dreamy / aggressive / electric). Onset density drives saturation; flux variance pushes an accent slot toward its complementary color. Blends into the song palette via HSL interpolation — never hard-cuts
- **Vocal silhouette overlay** — procedural GLSL SDF head profiles appear when mid-frequency energy dominates bass+highs. The Vasarely grid renders *through* the silhouette (stained-glass, not a flat overlay). Mouth opens and closes at ~17Hz driven by raw unsmoothed mids. A second mirrored profile fades in on strong vocal energy, with the overlap zone shifted to a third palette color. Each song gets a randomized left/right screen position
- **Audio profile classifier** — rolling classifier scores five archetypes (heavy / ambient / rhythmic / acoustic / chaotic) from spectral features and blends visual parameters accordingly
- **Spotify Web Playback SDK** — plays tracks directly in the browser via Spotify Premium; search any track, artist, or album
- **Desktop tab audio capture** — `getDisplayMedia` captures the browser tab's audio output for full-resolution analysis of whatever is playing
- **Mobile support** — preview URL decoded locally for analysis + Spotify Connect API triggers the full track in the native Spotify app simultaneously. Mic capture fallback when no preview is available. Touch-friendly controls, fullscreen API

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 6, TypeScript 5 |
| UI | React 18 |
| 3D / Shader | Three.js, custom GLSL |
| Audio | Web Audio API (`AudioContext`, `AnalyserNode`, `getDisplayMedia`, `getUserMedia`) |
| Auth | Spotify PKCE OAuth2 |
| Playback | Spotify Web Playback SDK, Spotify Connect API |
| Deployment | Static host with server-side proxy support |

---

## Prerequisites

- **Node.js 20+**
- **Spotify Premium** account (required by the Web Playback SDK)
- A **Spotify Developer app** (free to create)

---

## Local Setup

### 1. Clone and install

```bash
git clone https://github.com/amertx/spotify-visualizer.git
cd spotify-visualizer
npm install
```

### 2. Create a Spotify Developer app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Click **Create app**
3. Set **Redirect URI** to `http://127.0.0.1:5174/callback`
4. Copy your **Client ID**

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
VITE_SPOTIFY_CLIENT_ID=your_client_id_here
VITE_REDIRECT_URI=http://127.0.0.1:5174/callback
```

### 4. Run

```bash
npm run dev
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174).

### 5. Using the app

1. Click **Connect Spotify** and authorize
2. Search for a track using the search bar at the top
3. Click **Share Tab Audio** in the modal and share this browser tab's audio
4. The visualizer will sync to the music in real time
5. Compositions and palettes auto-advance every 30 seconds or on each track change

---

## Deployment

The app builds to a static bundle (`npm run build` → `dist/`). It can be hosted on any static platform that supports server-side proxy rewrites.

**Required environment variables** (set in your host's dashboard):

| Key | Value |
|-----|-------|
| `VITE_SPOTIFY_CLIENT_ID` | your Spotify Client ID |
| `VITE_REDIRECT_URI` | `https://your-domain.com/callback` |

**Spotify dashboard** — add your production URL as a Redirect URI under **Edit settings → Redirect URIs**. It must match `VITE_REDIRECT_URI` exactly.

**CORS proxy** — Spotify's audio CDN (`p.scdn.co`) blocks direct browser fetches. The included `netlify.toml` configures a server-side rewrite rule that proxies `/preview/*` → `https://p.scdn.co/*`, solving this without any serverless functions. Equivalent rules can be set up on other platforms.

---

## Project Structure

```
src/
├── App.tsx                      # Root component, auth flow, audio orchestration
├── components/
│   ├── VisualizerCanvas.tsx     # Three.js canvas wrapper, imperative handle
│   ├── SearchBar.tsx            # Spotify track search
│   ├── PlayerControls.tsx       # Playback controls, progress bar, fullscreen
│   ├── TrackInfo.tsx            # Current track display
│   ├── MobileBanner.tsx         # One-time mobile info banner
│   └── SpotifyLogin.tsx         # OAuth entry screen
├── hooks/
│   ├── useSpotifyAuth.ts        # Token management, refresh
│   ├── useSpotifyPlayer.ts      # Web Playback SDK, device registration
│   ├── useAudioAnalysis.ts      # Spotify audio features API
│   ├── useSearch.ts             # Debounced track search
│   └── useMobile.ts             # Touch device detection
├── spotify/
│   ├── auth.ts                  # PKCE OAuth2 flow
│   ├── api.ts                   # Spotify REST API calls
│   └── types.ts                 # Spotify type definitions
└── three/
    ├── scene.ts                 # VisualizerScene — animation loop, uniforms
    ├── liveAnalyzer.ts          # FFT analysis engine, all audio modes
    ├── moodPalette.ts           # Rolling mood vector → HSL palette modulation
    ├── audioProfile.ts          # Five-archetype audio classifier
    ├── particles.ts             # Particle system
    ├── beatRings.ts             # Beat-synchronized ring geometry
    ├── morphingPolyhedra.ts     # Geometry animations
    └── shaders/
        ├── vasarely.ts          # Main procedural shader (GLSL)
        ├── blob.ts
        ├── filmGrain.ts
        └── chromaticAberration.ts
```

---

## How It Works

### Audio pipeline

```
Spotify SDK / Preview MP3 / Tab Capture / Microphone
                    ↓
          AudioContext + AnalyserNode
                    ↓
         getByteFrequencyData() @ 60fps
                    ↓
     LiveAnalyzer.tick() → LiveAnalysisFrame
     ├── Band energies (sub-bass → brilliance)
     ├── Spectral centroid, flux, rolloff, ZCR
     ├── Per-band onset detection
     ├── Vocal detection (mids dominance)
     ├── Beat firing + BPM tracking
     └── Raw unsmoothed mids (mouth animation)
                    ↓
         VisualizerScene.animLoop()
         ├── Upload uniforms to GPU
         ├── MoodPaletteSystem.update() + modulate()
         └── renderer.render() → Vasarely shader
```

### Mood system

The `MoodPaletteSystem` maintains a rolling 5-second window across five signals and maps them to a 2D mood plane (energy × spectral brightness). Four corner palettes anchor the plane — brooding (low/dark), dreamy (low/bright), aggressive (high/dark), electric (high/bright). The system interpolates continuously and blends only 40% of hue, 70% of saturation, and 30% of lightness into the song's base palette, so the original palette character always shows through.

Section changes are detected via two-speed energy EMAs (0.3s vs 2.5s): when their ratio exceeds 40%, the blend speed jumps from 8 seconds to 1.5 seconds for a fast but smooth transition.

### Vocal silhouette

`sdHead()` in the fragment shader is a smooth-union of ellipse SDFs — cranium, nose, lips, chin, and neck — composited with `smin()`. The gradient of the SDF field is used to warp the underlying grid geometry outward from the face boundary, creating the distortion visible at the silhouette edge. Color zones are blended at 65–85% opacity so the Vasarely grid always shows through.

---

## Development Chronology

The project was built iteratively, each layer adding expressiveness to the previous:

**1. Foundation** — Vite + React + TypeScript scaffold, Three.js full-screen quad, Spotify PKCE OAuth, Web Playback SDK integration, track search.

**2. Audio engine** — `LiveAnalyzer` class: `AudioContext` + 2048-point FFT, five frequency bands with EMA smoothing, spectral centroid and flux, per-band onset detection with 500ms rolling averages, bass-driven beat detection and BPM tracking.

**3. Vasarely shader** — 10 GLSL compositions with smooth crossfades, 8 static palettes, audio-reactive uniforms (bass → geometry scale, flux → warp intensity, beat → pulse), per-song seeded parameters (grid density, rotation, warp centers, cell shape).

**4. Desktop tab audio capture** — `getDisplayMedia` pipeline replaces the preview audio path for full-quality analysis of whatever is playing in the browser tab.

**5. Vocal silhouette** — Procedural SDF head profiles rendered in GLSL. Two facing profiles appear when vocal presence is detected, with a stained-glass effect (grid renders through), an animated mouth driven by unsmoothed mids at ~17Hz, asymmetric 0.5s/0.8s fade, per-song randomized screen position, and overlap zone palette shift.

**6. Mood-driven palette** — `MoodPaletteSystem` built on rolling spectral statistics. Bilinear interpolation across four mood corners, saturation modulated by onset density, complementary accent driven by flux variance, section-change detection via two-speed EMAs with fast-blend mode.

**7. Audio profile classifier** — `AudioProfileClassifier` continuously scores five archetypes from spectral features and blends visual parameters (bloom strength, displacement scale, particle velocity, camera shake) across the weighted mix.

**8. Mobile + deployment** — Preview URL audio path for mobile (fetch → `decodeAudioData` → `AnalyserNode`), Spotify Connect API for simultaneous native app playback, `getUserMedia` mic fallback, touch targets, fullscreen API. Static deployment config with server-side proxy for Spotify CDN CORS.

---

## License

MIT
