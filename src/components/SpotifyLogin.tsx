import { initiateAuth } from '../spotify/auth';

interface Props {
  error?: string | null;
  onYouTube?: () => void;
}

export function SpotifyLogin({ error, onYouTube }: Props) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="logo-hex">⬡</div>
        <h1>Geometry</h1>
        <p className="tagline">
          Music visualized as living, breathing geometry — driven by tempo, beat, and mood.
        </p>
        {error && <p className="auth-error">Error: {error}</p>}
        <button className="login-btn" onClick={initiateAuth}>
          Connect Spotify
        </button>
        <p className="fine-print">Requires Spotify Premium for in-browser playback</p>
        {onYouTube && (
          <button className="yt-alt-btn" onClick={onYouTube}>
            Use YouTube instead
          </button>
        )}
      </div>
    </div>
  );
}
