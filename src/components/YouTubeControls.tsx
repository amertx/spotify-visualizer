import { useState, useCallback, useEffect } from 'react';

interface Props {
  isPlaying: boolean;
  onTogglePlay: () => void;
}

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <polyline points="1,5 1,1 5,1" />
    <polyline points="9,1 13,1 13,5" />
    <polyline points="13,9 13,13 9,13" />
    <polyline points="5,13 1,13 1,9" />
  </svg>
);

const CollapseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <polyline points="5,1 5,5 1,5" />
    <polyline points="9,5 13,5 13,1" />
    <polyline points="9,9 9,13 13,13" />
    <polyline points="1,9 5,9 5,13" />
  </svg>
);

export function YouTubeControls({ isPlaying, onTogglePlay }: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = document.documentElement as any;
    if (!document.fullscreenElement) {
      (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el).catch(() => {});
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((document as any).exitFullscreen ?? (document as any).webkitExitFullscreen)
        ?.call(document).catch(() => {});
    }
  }, []);

  return (
    <div className="player-controls">
      <div className="controls-row">
        <button
          className="ctrl-btn ctrl-btn--play"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="ctrl-btn ctrl-btn--fullscreen"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>
    </div>
  );
}
