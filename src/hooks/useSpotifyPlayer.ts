import { useState, useEffect, useRef, useCallback } from 'react';
import { transferPlayback } from '../spotify/api';
import type { SpotifyTrack, PlayerController } from '../spotify/types';

// Spotify Web Playback SDK global types
declare global {
  interface Window {
    Spotify: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume: number;
      }) => SpotifySDKPlayer;
    };
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

interface SpotifySDKPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: 'ready', cb: (data: { device_id: string }) => void): void;
  addListener(event: 'not_ready', cb: (data: { device_id: string }) => void): void;
  addListener(event: 'player_state_changed', cb: (state: SDKPlayerState | null) => void): void;
  addListener(event: 'initialization_error', cb: (data: { message: string }) => void): void;
  addListener(event: 'authentication_error', cb: (data: { message: string }) => void): void;
  addListener(event: 'account_error', cb: (data: { message: string }) => void): void;
  removeListener(event: string): void;
  getCurrentState(): Promise<SDKPlayerState | null>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
}

interface SDKPlayerState {
  position: number;
  duration: number;
  paused: boolean;
  track_window: {
    current_track: {
      id: string;
      uri: string;
      name: string;
      artists: Array<{ name: string }>;
      album: {
        name: string;
        images: Array<{ url: string }>;
      };
    };
  };
}

export function useSpotifyPlayer(token: string | null) {
  const [playerController, setPlayerController] = useState<PlayerController | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const sdkPlayerRef = useRef<SpotifySDKPlayer | null>(null);
  const positionRef = useRef(0);
  const positionTimestampRef = useRef(performance.now());
  const isPlayingRef = useRef(false);

  const updateFromState = useCallback((state: SDKPlayerState | null) => {
    if (!state) return;
    setIsPlaying(!state.paused);
    isPlayingRef.current = !state.paused;
    setPosition(state.position);
    positionRef.current = state.position;
    positionTimestampRef.current = performance.now();
    setDuration(state.duration);

    const t = state.track_window.current_track;
    setCurrentTrack({
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: t.artists,
      album: {
        name: t.album.name,
        images: t.album.images.map((img) => ({ url: img.url, width: 0, height: 0 })),
      },
      duration_ms: state.duration,
      preview_url: null, // fetched separately via getTrack()
    });
  }, []);

  useEffect(() => {
    if (!token) return;

    const init = () => {
      const player = new window.Spotify.Player({
        name: 'Geometry Visualizer',
        getOAuthToken: (cb) => cb(token),
        volume: 0.8,
      });

      player.addListener('ready', ({ device_id }) => {
        setDeviceId(device_id);
        transferPlayback(device_id).catch(console.warn);
      });

      player.addListener('player_state_changed', updateFromState);

      player.addListener('initialization_error', ({ message }) => setSdkError(message));
      player.addListener('authentication_error', ({ message }) => setSdkError(message));
      player.addListener('account_error', ({ message }) =>
        setSdkError(`${message} — Spotify Premium required`)
      );

      player.connect();
      sdkPlayerRef.current = player;

      // Expose controller interface
      setPlayerController({
        pause: () => player.pause(),
        resume: () => player.resume(),
        previousTrack: () => player.previousTrack(),
        nextTrack: () => player.nextTrack(),
        seek: (ms) => player.seek(ms),
        setVolume: (v) => player.setVolume(v),
      });
    };

    if (window.Spotify) {
      init();
    } else {
      window.onSpotifyWebPlaybackSDKReady = init;
    }

    return () => {
      sdkPlayerRef.current?.disconnect();
      sdkPlayerRef.current = null;
    };
  }, [token, updateFromState]);

  // Sync position anchor every 500ms — RAF loop extrapolates in between
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(async () => {
      const state = await sdkPlayerRef.current?.getCurrentState();
      if (state && !state.paused) {
        positionRef.current = state.position;
        positionTimestampRef.current = performance.now();
        setPosition(state.position);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  return {
    playerController,
    deviceId,
    currentTrack,
    isPlaying,
    position,
    duration,
    sdkError,
    // Refs for frame-accurate position extrapolation in the RAF loop
    positionRef,
    positionTimestampRef,
    isPlayingRef,
  };
}
