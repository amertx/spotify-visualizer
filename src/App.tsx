import { useEffect, useState, useCallback, useRef } from 'react';
import { exchangeCodeForToken }   from './spotify/auth';
import { playTrack, getTrack, playOnConnect } from './spotify/api';
import { useSpotifyAuth }         from './hooks/useSpotifyAuth';
import { useSpotifyPlayer }       from './hooks/useSpotifyPlayer';
import { useAudioAnalysis }       from './hooks/useAudioAnalysis';
import { useIsMobile }            from './hooks/useMobile';
import { useYouTubePlayer }       from './hooks/useYouTubePlayer';
import { SpotifyLogin }           from './components/SpotifyLogin';
import { PlayerControls }         from './components/PlayerControls';
import { TrackInfo }              from './components/TrackInfo';
import { SearchBar }              from './components/SearchBar';
import { YouTubeURLBar }          from './components/YouTubeURLBar';
import { YouTubeControls }        from './components/YouTubeControls';
import { MobileBanner }           from './components/MobileBanner';
import { VisualizerCanvas, type VisualizerCanvasHandle } from './components/VisualizerCanvas';
import type { AudioSourceMode }   from './three/liveAnalyzer';
import type { SpotifyTrack }      from './spotify/types';

type AppMode = 'spotify' | 'youtube';

export default function App() {
  const isMobile = useIsMobile();

  // ── App mode (Spotify vs YouTube) ─────────────────────────────────────────
  const [appMode, setAppMode] = useState<AppMode>(() =>
    (sessionStorage.getItem('app-mode') as AppMode | null) ?? 'spotify'
  );

  function switchMode(mode: AppMode) {
    setAppMode(mode);
    sessionStorage.setItem('app-mode', mode);
  }

  // ── Spotify hooks (always mounted; no-ops when token is null) ─────────────
  const { isAuthenticated, token, logout } = useSpotifyAuth();
  const {
    playerController, deviceId, currentTrack, isPlaying, position, duration, sdkError,
    positionRef, positionTimestampRef, isPlayingRef,
  } = useSpotifyPlayer(token);
  const { analysis, features, apiError } = useAudioAnalysis(currentTrack?.id ?? null);

  // ── YouTube hook ──────────────────────────────────────────────────────────
  const {
    track: ytTrack, isPlaying: ytIsPlaying, error: ytError,
    loadVideo: ytLoadVideo, togglePlay: ytTogglePlay, setContainer: ytSetContainer,
  } = useYouTubePlayer();

  // ── Shared state ──────────────────────────────────────────────────────────
  const [callbackPending, setCallbackPending] = useState(false);
  const [callbackError,   setCallbackError]   = useState<string | null>(null);
  const [playError,       setPlayError]        = useState<string | null>(null);
  const [previewUrl,      setPreviewUrl]       = useState<string | null>(null);
  const [audioMode,       setAudioMode]        = useState<AudioSourceMode>('idle');
  const [capturing,       setCapturing]        = useState(false);
  const [audioError,      setAudioError]       = useState<string | null>(null);
  const [mobileTrack,     setMobileTrack]      = useState<SpotifyTrack | null>(null);
  const [bannerVisible,   setBannerVisible]    = useState(
    () => isMobile && !sessionStorage.getItem('mobile-banner-dismissed')
  );
  const [showSdkError,  setShowSdkError]  = useState(false);
  const [showApiError,  setShowApiError]  = useState(false);
  const [ytLoading,     setYtLoading]     = useState(false);

  const canvasRef = useRef<VisualizerCanvasHandle>(null);

  // ── OAuth redirect ─────────────────────────────────────────────────────────
  useEffect(() => {
    const url   = new URL(window.location.href);
    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error) { setCallbackError(error); window.history.replaceState({}, '', '/'); return; }
    if (code) {
      setCallbackPending(true);
      window.history.replaceState({}, '', '/');
      exchangeCodeForToken(code)
        .then(() => window.location.reload())
        .catch((err: Error) => { setCallbackError(err.message); setCallbackPending(false); });
    }
  }, []);

  // ── Desktop live audio capture ─────────────────────────────────────────────
  const handleEnableAudio = useCallback(async () => {
    if (!canvasRef.current) return;
    setCapturing(true);
    setAudioError(null);
    canvasRef.current.resumeAudio();
    try {
      const mode = await canvasRef.current.startLiveCapture();
      setAudioMode(mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('permission denied') &&
          !msg.toLowerCase().includes('cancelled') &&
          !msg.toLowerCase().includes('abort')) {
        setAudioError(msg);
      }
    }
    setCapturing(false);
  }, []);

  // ── Mobile mic capture ─────────────────────────────────────────────────────
  const handleMicCapture = useCallback(async () => {
    if (!canvasRef.current) return;
    setCapturing(true);
    setAudioError(null);
    canvasRef.current.resumeAudio();
    try {
      const mode = await canvasRef.current.startMicCapture();
      setAudioMode(mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('denied') && !msg.toLowerCase().includes('abort')) {
        setAudioError(msg);
      }
    }
    setCapturing(false);
  }, []);

  // ── Spotify track selection ────────────────────────────────────────────────
  const handleTrackSelect = useCallback(
    async (track: SpotifyTrack) => {
      setPlayError(null);
      canvasRef.current?.resumeAudio();
      setPreviewUrl(track.preview_url ?? null);

      if (isMobile) {
        setMobileTrack(track);
        canvasRef.current?.triggerChange();
        playOnConnect(track.uri).catch(err =>
          console.warn('[Mobile] Spotify Connect:', err)
        );
        return;
      }

      if (!deviceId) { setPlayError('Player not ready — wait a moment'); return; }
      try { await playTrack(deviceId, track.uri); }
      catch (err) { setPlayError(err instanceof Error ? err.message : 'Playback failed'); }
    },
    [deviceId, isMobile]
  );

  // ── YouTube video load ─────────────────────────────────────────────────────
  const handleYouTubeLoad = useCallback(async (url: string) => {
    setYtLoading(true);
    canvasRef.current?.resumeAudio();
    await ytLoadVideo(url, () => canvasRef.current?.triggerChange());
    setYtLoading(false);
  }, [ytLoadVideo]);

  // ── Fallback preview URL on SDK track change (desktop Spotify) ────────────
  useEffect(() => {
    if (!currentTrack?.id) { if (!isMobile) setPreviewUrl(null); return; }
    getTrack(currentTrack.id)
      .then(t => setPreviewUrl(t.preview_url))
      .catch(() => {});
    canvasRef.current?.triggerChange();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // ── Auto-clear play errors ─────────────────────────────────────────────────
  useEffect(() => {
    if (!playError) return;
    const t = setTimeout(() => setPlayError(null), 4000);
    return () => clearTimeout(t);
  }, [playError]);

  // ── Auto-dismiss SDK auth error ───────────────────────────────────────────
  useEffect(() => {
    if (!sdkError) { setShowSdkError(false); return; }
    setShowSdkError(true);
    const t = setTimeout(() => setShowSdkError(false), 5000);
    return () => clearTimeout(t);
  }, [sdkError]);

  // ── Auto-dismiss API restricted notice ────────────────────────────────────
  useEffect(() => {
    if (!apiError) { setShowApiError(false); return; }
    setShowApiError(true);
    const t = setTimeout(() => setShowApiError(false), 6000);
    return () => clearTimeout(t);
  }, [apiError]);

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (callbackPending) return (
    <div className="loading-screen">
      <div className="spinner" /><p>Connecting to Spotify…</p>
    </div>
  );

  const isLive = audioMode === 'live';
  const isMic  = audioMode === 'mic';

  const searchTop = isMobile && bannerVisible ? '52px' : '16px';

  // ── Mode toggle (shared between Spotify + YouTube UI) ─────────────────────
  const ModeToggle = ({ current, onSwitch }: { current: AppMode; onSwitch: (m: AppMode) => void }) => (
    <div className="mode-tabs">
      <button
        className={`mode-tab ${current === 'spotify' ? 'mode-tab--active' : ''}`}
        onClick={() => onSwitch('spotify')}
      >
        Spotify
      </button>
      <button
        className={`mode-tab ${current === 'youtube' ? 'mode-tab--active' : ''}`}
        onClick={() => onSwitch('youtube')}
      >
        YouTube
      </button>
    </div>
  );

  // ── YouTube mode ──────────────────────────────────────────────────────────
  if (appMode === 'youtube') {
    const showMicPromptYT = isMobile && !isMic && !capturing;

    return (
      <div className="app">
        <VisualizerCanvas
          ref={canvasRef}
          features={null}
          analysis={null}
          previewUrl={null}
          positionRef={positionRef}
          positionTimestampRef={positionTimestampRef}
          isPlayingRef={isPlayingRef}
        />

        {/* Desktop: share tab audio modal */}
        {!isMobile && !isLive && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-icon">◎</div>
              <h2 className="modal-title">Enable Audio Visualization</h2>
              <p className="modal-desc">
                Paste a YouTube link below, then share this tab's audio to sync the visualizer.
              </p>
              <ol className="modal-steps">
                <li>Paste a YouTube link in the bar above</li>
                <li>Click <strong>Share Tab Audio</strong> below</li>
                <li>In the browser dialog, select <strong>this tab</strong></li>
                <li>Ensure <strong>Share tab audio</strong> is checked</li>
                <li>Click <strong>Share</strong></li>
              </ol>
              {audioError && <p className="modal-error">⚠ {audioError}</p>}
              <button
                className={`modal-btn ${capturing ? 'modal-btn--loading' : ''}`}
                onClick={handleEnableAudio}
                disabled={capturing}
              >
                {capturing
                  ? <><span className="btn-spinner" /> Waiting for permission…</>
                  : <><span className="btn-icon">◎</span> Share Tab Audio</>
                }
              </button>
            </div>
          </div>
        )}

        {/* Live / mic badge */}
        {(isLive || isMic) && (
          <div className="audio-live-badge">
            <span className="live-dot" /> {isLive ? 'LIVE' : 'MIC'}
          </div>
        )}

        {/* Mobile mic prompt */}
        {showMicPromptYT && (
          <button className="mobile-mic-btn" onClick={handleMicCapture} disabled={capturing}>
            {capturing ? <><span className="btn-spinner" /> Waiting…</> : <>🎤 Use microphone</>}
          </button>
        )}
        {isMobile && audioError && (
          <div className="mobile-audio-error">⚠ {audioError}</div>
        )}

        {/* URL bar + mode toggle */}
        <div className="search-overlay" style={{ top: searchTop }}>
          <ModeToggle current="youtube" onSwitch={(m) => {
            switchMode(m);
            if (m === 'spotify' && !isAuthenticated) {
              // will fall through to SpotifyLogin after mode switch
            }
          }} />
          <YouTubeURLBar onLoad={handleYouTubeLoad} loading={ytLoading} error={ytError} />
        </div>

        {/* YouTube embed — small player in corner for tab audio capture */}
        <div
          ref={ytSetContainer as React.RefCallback<HTMLDivElement>}
          className="yt-embed"
        />

        {/* Track info + controls */}
        <div className="overlay">
          <TrackInfo
            name={ytTrack?.title}
            artist={ytTrack?.author}
            imageUrl={ytTrack?.thumbnail}
            emptyLabel="Paste a YouTube link to begin"
          />
          <YouTubeControls
            isPlaying={ytIsPlaying}
            onTogglePlay={ytTogglePlay}
          />
        </div>

        {/* Attribution */}
        <div className="attribution">
          built by <a href="https://amerdin.com" target="_blank" rel="noopener noreferrer">amer</a>
        </div>

        {/* Toasts */}
        <div className="toast-stack">
          {!isMobile && !isLive && ytTrack && (
            <div className="toast toast--info">Share tab audio to sync the visualizer</div>
          )}
        </div>
      </div>
    );
  }

  // ── Spotify mode auth checks ───────────────────────────────────────────────
  if (isAuthenticated === null) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!isAuthenticated) return (
    <SpotifyLogin
      error={callbackError}
      onYouTube={() => switchMode('youtube')}
    />
  );

  // ── Spotify mode ──────────────────────────────────────────────────────────
  const displayTrack = (isMobile ? mobileTrack : null) ?? currentTrack;
  const albumArt     = displayTrack?.album.images[0]?.url;
  const artists      = displayTrack?.artists.map(a => a.name).join(', ');

  const showMicPrompt = isMobile && !previewUrl && !isMic && !capturing;

  return (
    <div className="app">
      <VisualizerCanvas
        ref={canvasRef}
        features={features}
        analysis={analysis}
        previewUrl={(isLive || isMic) ? null : previewUrl}
        positionRef={positionRef}
        positionTimestampRef={positionTimestampRef}
        isPlayingRef={isPlayingRef}
      />

      {/* Mobile banner */}
      {isMobile && (
        <MobileBanner onDismiss={() => setBannerVisible(false)} />
      )}

      {/* Desktop share modal */}
      {!isMobile && !isLive && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-icon">◎</div>
            <h2 className="modal-title">Enable Audio Visualization</h2>
            <p className="modal-desc">
              To visualize music in real time, this app captures the audio output of this browser tab.
              No audio leaves your browser — it is analyzed locally.
            </p>
            <ol className="modal-steps">
              <li>Click <strong>Share Tab Audio</strong> below</li>
              <li>In the browser dialog, click the <strong>Tab</strong> section</li>
              <li>Select <strong>this tab</strong> from the list</li>
              <li>Ensure <strong>Share tab audio</strong> is checked</li>
              <li>Click <strong>Share</strong></li>
            </ol>
            {audioError && <p className="modal-error">⚠ {audioError}</p>}
            <button
              className={`modal-btn ${capturing ? 'modal-btn--loading' : ''}`}
              onClick={handleEnableAudio}
              disabled={capturing}
            >
              {capturing
                ? <><span className="btn-spinner" /> Waiting for permission…</>
                : <><span className="btn-icon">◎</span> Share Tab Audio</>
              }
            </button>
          </div>
        </div>
      )}

      {/* Live / mic badge */}
      {(isLive || isMic) && (
        <div className="audio-live-badge">
          <span className="live-dot" /> {isLive ? 'LIVE' : 'MIC'}
        </div>
      )}

      {/* Mobile mic fallback */}
      {showMicPrompt && (
        <button className="mobile-mic-btn" onClick={handleMicCapture} disabled={capturing}>
          {capturing ? <><span className="btn-spinner" /> Waiting…</> : <>🎤 Use microphone</>}
        </button>
      )}
      {isMobile && audioError && (
        <div className="mobile-audio-error">⚠ {audioError}</div>
      )}

      {/* Search + mode toggle */}
      <div className="search-overlay" style={{ top: searchTop }}>
        <ModeToggle current="spotify" onSwitch={switchMode} />
        <SearchBar onSelect={handleTrackSelect} disabled={isMobile ? false : !deviceId} />
      </div>

      {/* Track info + controls */}
      <div className="overlay">
        <TrackInfo
          name={displayTrack?.name}
          artist={artists}
          imageUrl={albumArt}
          emptyLabel="Play something on Spotify to begin"
        />
        <PlayerControls
          player={playerController}
          isPlaying={isPlaying}
          position={position}
          duration={duration}
          onLogout={logout}
        />
      </div>

      {/* Attribution */}
      <div className="attribution">
        built by <a href="https://amerdin.com" target="_blank" rel="noopener noreferrer">amer</a>
      </div>

      {/* Toast stack */}
      <div className="toast-stack">
        {showSdkError && sdkError  && <div className="toast toast--error">⚠ {sdkError}</div>}
        {playError                 && <div className="toast toast--error">⚠ {playError}</div>}
        {showApiError && apiError  && <div className="toast toast--warn">⚠ {apiError}</div>}
        {!isMobile && !deviceId   && <div className="toast toast--info">Initializing player…</div>}
      </div>
    </div>
  );
}
