import { useState, useRef, useCallback, useEffect } from 'react';

export interface YouTubeTrack {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
}

// ── Minimal YT IFrame API types ────────────────────────────────────────────
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(videoId: string): void;
  destroy(): void;
}

interface YTPlayerOptions {
  width?: number;
  height?: number;
  videoId?: string;
  playerVars?: Record<string, unknown>;
  events?: {
    onReady?: (e: { target: YTPlayer }) => void;
    onStateChange?: (e: { target: YTPlayer; data: number }) => void;
  };
}

declare global {
  interface Window {
    YT: {
      Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
      PlayerState: { PLAYING: number };
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseVideoId(input: string): string | null {
  const s = input.trim();
  // Plain 11-char video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    if (u.hostname.includes('youtu.be'))
      return u.pathname.slice(1).split('?')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      return (
        u.searchParams.get('v') ??
        (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null) ??
        (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null)
      );
    }
  } catch { /* not a URL */ }
  return null;
}

async function fetchMeta(videoId: string): Promise<{ title: string; author: string }> {
  // noembed.com is a CORS-enabled oEmbed proxy for YouTube
  const res = await fetch(
    `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  );
  if (!res.ok) throw new Error('Could not fetch video info');
  const data = await res.json();
  if (data.error) throw new Error('Video not found or unavailable');
  return { title: data.title ?? 'Unknown title', author: data.author_name ?? '' };
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useYouTubePlayer() {
  const [track,     setTrack]     = useState<YouTubeTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [apiReady,  setApiReady]  = useState(false);
  const [container, setContainerEl] = useState<HTMLElement | null>(null);

  const playerRef      = useRef<YTPlayer | null>(null);
  const pendingVideoId = useRef<string | null>(null);

  // Load YT IFrame API script once
  useEffect(() => {
    if (window.YT?.Player) { setApiReady(true); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); setApiReady(true); };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  }, []);

  // Create/recreate player when both API ready AND container div is mounted
  useEffect(() => {
    if (!apiReady || !container) return;
    playerRef.current?.destroy();
    playerRef.current = new window.YT.Player(container, {
      width: 160,
      height: 90,
      videoId: pendingVideoId.current ?? undefined,
      playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, fs: 0 },
      events: {
        onStateChange: (e) => setIsPlaying(e.data === window.YT.PlayerState.PLAYING),
      },
    });
    return () => { playerRef.current?.destroy(); playerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiReady, container]);

  // Callback ref — the embed div passes itself here when it mounts/unmounts
  const setContainer = useCallback((el: HTMLElement | null) => {
    setContainerEl(el);
  }, []);

  const loadVideo = useCallback(async (
    urlOrId: string,
    onTrackChange?: () => void,
  ): Promise<YouTubeTrack | null> => {
    setError(null);
    const videoId = parseVideoId(urlOrId);
    if (!videoId) { setError('Paste a valid YouTube URL or video ID'); return null; }

    // Show thumbnail immediately from CDN — no fetch needed
    const partial: YouTubeTrack = {
      videoId,
      title: 'Loading…',
      author: '',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
    setTrack(partial);

    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId);
    } else {
      pendingVideoId.current = videoId;
    }

    // Trigger composition change immediately so visuals react to the new song
    onTrackChange?.();

    try {
      const meta = await fetchMeta(videoId);
      const full = { ...partial, ...meta };
      setTrack(full);
      return full;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
      return partial;
    }
  }, []);

  const play   = useCallback(() => playerRef.current?.playVideo(),  []);
  const pause  = useCallback(() => playerRef.current?.pauseVideo(), []);
  const togglePlay = useCallback(() => {
    if (isPlaying) playerRef.current?.pauseVideo();
    else           playerRef.current?.playVideo();
  }, [isPlaying]);

  return { track, isPlaying, error, loadVideo, play, pause, togglePlay, setContainer };
}
