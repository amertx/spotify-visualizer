import { useEffect, useState, useCallback, useRef } from 'react';
import { exchangeCodeForToken }   from './spotify/auth';
import { playTrack, getTrack, playOnConnect } from './spotify/api';
import { useSpotifyAuth }         from './hooks/useSpotifyAuth';
import { useSpotifyPlayer }       from './hooks/useSpotifyPlayer';
import { useAudioAnalysis }       from './hooks/useAudioAnalysis';
import { useIsMobile }            from './hooks/useMobile';
import { SpotifyLogin }           from './components/SpotifyLogin';
import { PlayerControls }         from './components/PlayerControls';
import { TrackInfo }              from './components/TrackInfo';
import { SearchBar }              from './components/SearchBar';
import { MobileBanner }           from './components/MobileBanner';
import { VisualizerCanvas, type VisualizerCanvasHandle } from './components/VisualizerCanvas';
import type { AudioSourceMode }   from './three/liveAnalyzer';
import type { SpotifyTrack }      from './spotify/types';

export default function App() {
  const isMobile = useIsMobile();

  const { isAuthenticated, token, logout } = useSpotifyAuth();
  const {
    playerController, deviceId, currentTrack, isPlaying, position, duration, sdkError,
    positionRef, positionTimestampRef, isPlayingRef,
  } = useSpotifyPlayer(token);
  const { analysis, features, apiError } = useAudioAnalysis(currentTrack?.id ?? null);

  const [callbackPending, setCallbackPending] = useState(false);
  const [callbackError,   setCallbackError]   = useState<string | null>(null);
  const [playError,       setPlayError]        = useState<string | null>(null);
  const [previewUrl,      setPreviewUrl]       = useState<string | null>(null);
  const [audioMode,       setAudioMode]        = useState<AudioSourceMode>('idle');
  const [capturing,       setCapturing]        = useState(false);
  const [audioError,      setAudioError]       = useState<string | null>(null);
  // Track info for mobile (SDK state events may not fire for Connect playback)
  const [mobileTrack,     setMobileTrack]      = useState<SpotifyTrack | null>(null);
  // Banner visibility (so search bar can adjust position)
  const [bannerVisible,   setBannerVisible]    = useState(
    () => isMobile && !sessionStorage.getItem('mobile-banner-dismissed')
  );
  // Local dismiss flags for transient / expected errors
  const [showSdkError,  setShowSdkError]  = useState(false);
  const [showApiError,  setShowApiError]  = useState(false);

  const canvasRef = useRef<VisualizerCanvasHandle>(null);

  // ── OAuth redirect ────────────────────────────────────────────────────────
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

  // ── Enable desktop live audio capture (tab audio via getDisplayMedia) ─────
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
      if (!msg.toLowerCase().includes('permission denied') && !msg.toLowerCase().includes('cancelled') && !msg.toLowerCase().includes('abort')) {
        setAudioError(msg);
      }
    }
    setCapturing(false);
  }, []);

  // ── Mobile mic capture (fallback when no preview_url) ─────────────────────
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

  // ── Track selection ───────────────────────────────────────────────────────
  const handleTrackSelect = useCallback(
    async (track: SpotifyTrack) => {
      setPlayError(null);
      canvasRef.current?.resumeAudio();

      // Use preview_url from search result immediately
      setPreviewUrl(track.preview_url ?? null);

      if (isMobile) {
        // Mobile: store track for display + trigger composition change
        setMobileTrack(track);
        canvasRef.current?.triggerChange();

        // Trigger Spotify Connect → plays full song in Spotify app (if open)
        playOnConnect(track.uri).catch(err =>
          console.warn('[Mobile] Spotify Connect:', err)
        );
        return;
      }

      // Desktop: play via Web Playback SDK
      if (!deviceId) { setPlayError('Player not ready — wait a moment'); return; }
      try { await playTrack(deviceId, track.uri); }
      catch (err) { setPlayError(err instanceof Error ? err.message : 'Playback failed'); }
    },
    [deviceId, isMobile]
  );

  // ── Fallback: fetch preview URL when track changes via SDK (desktop) ──────
  useEffect(() => {
    if (!currentTrack?.id) { if (!isMobile) setPreviewUrl(null); return; }
    getTrack(currentTrack.id)
      .then(t => setPreviewUrl(t.preview_url))
      .catch(() => {});
    canvasRef.current?.triggerChange();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // ── Auto-clear play errors ────────────────────────────────────────────────
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

  // ── Auto-dismiss API restricted notice ───────────────────────────────────
  useEffect(() => {
    if (!apiError) { setShowApiError(false); return; }
    setShowApiError(true);
    const t = setTimeout(() => setShowApiError(false), 6000);
    return () => clearTimeout(t);
  }, [apiError]);

  // ── Loading / auth screens ────────────────────────────────────────────────
  if (callbackPending) return (
    <div className="loading-screen">
      <div className="spinner" /><p>Connecting to Spotify…</p>
    </div>
  );
  if (isAuthenticated === null) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!isAuthenticated)         return <SpotifyLogin error={callbackError} />;

  const isLive = audioMode === 'live';
  const isMic  = audioMode === 'mic';

  // Displayed track: on mobile, prefer the locally-tracked selected track
  const displayTrack = (isMobile ? mobileTrack : null) ?? currentTrack;

  // Show mic prompt on mobile when there's no preview and mic isn't active
  const showMicPrompt = isMobile && !previewUrl && !isMic && !capturing;

  // Search bar top offset: push down below mobile banner
  const searchTop = isMobile && bannerVisible ? '52px' : '28px';

  // ── Main app ──────────────────────────────────────────────────────────────
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

      {/* ── Mobile banner (one-time dismissible) ── */}
      {isMobile && (
        <MobileBanner onDismiss={() => setBannerVisible(false)} />
      )}

      {/* ── Desktop share modal — shown until live capture is active ── */}
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

      {/* ── Live / mic indicator ── */}
      {(isLive || isMic) && (
        <div className="audio-live-badge">
          <span className="live-dot" /> {isLive ? 'LIVE' : 'MIC'}
        </div>
      )}

      {/* ── Mobile mic fallback prompt ── */}
      {showMicPrompt && (
        <button className="mobile-mic-btn" onClick={handleMicCapture} disabled={capturing}>
          {capturing ? <><span className="btn-spinner" /> Waiting…</> : <>🎤 Use microphone</>}
        </button>
      )}
      {isMobile && audioError && (
        <div className="mobile-audio-error">⚠ {audioError}</div>
      )}

      {/* ── Search ── */}
      <div className="search-overlay" style={{ top: searchTop }}>
        <SearchBar onSelect={handleTrackSelect} disabled={isMobile ? false : !deviceId} />
      </div>

      {/* ── Track info + controls ── */}
      <div className="overlay">
        <TrackInfo track={displayTrack} />
        <PlayerControls
          player={playerController}
          isPlaying={isPlaying}
          position={position}
          duration={duration}
          onLogout={logout}
        />
      </div>

      {/* ── Attribution ── */}
      <div className="attribution">
        built by <a href="https://amerdin.com" target="_blank" rel="noopener noreferrer">amer</a>
      </div>

      {/* ── Toast stack ── */}
      <div className="toast-stack">
        {showSdkError && sdkError  && <div className="toast toast--error">⚠ {sdkError}</div>}
        {playError                 && <div className="toast toast--error">⚠ {playError}</div>}
        {showApiError && apiError  && <div className="toast toast--warn">⚠ {apiError}</div>}
        {!isMobile && !deviceId   && <div className="toast toast--info">Initializing player…</div>}
      </div>
    </div>
  );
}
