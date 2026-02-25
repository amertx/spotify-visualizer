import { getValidToken } from './auth';
import type { AudioAnalysis, AudioFeatures, SpotifyTrack } from './types';

async function apiFetch<T>(endpoint: string): Promise<T> {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 429) {
    const retry = response.headers.get('Retry-After');
    throw new Error(`Rate limited. Retry after ${retry ?? '?'}s`);
  }

  if (!response.ok) throw new Error(`Spotify API ${response.status}: ${endpoint}`);

  return response.json();
}

export async function getTrack(trackId: string): Promise<SpotifyTrack> {
  return apiFetch(`/tracks/${trackId}`);
}

export async function getAudioAnalysis(trackId: string): Promise<AudioAnalysis> {
  return apiFetch(`/audio-analysis/${trackId}`);
}

export async function getAudioFeatures(trackId: string): Promise<AudioFeatures> {
  return apiFetch(`/audio-features/${trackId}`);
}

export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
  const data = await apiFetch<{ tracks: { items: SpotifyTrack[] } }>(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=7`
  );
  return data.tracks.items;
}

export async function playTrack(deviceId: string, trackUri: string): Promise<void> {
  const token = await getValidToken();
  if (!token) return;

  const res = await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [trackUri] }),
    }
  );

  // 403 = not premium, 404 = no active device yet (SDK still initializing)
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Play failed: ${res.status}`);
  }
}

/**
 * Trigger playback on the user's currently active Spotify Connect device
 * (native Spotify app, speaker, etc.) — no SDK device required.
 * 404 = no active device open; silently ignored.
 */
export async function playOnConnect(trackUri: string): Promise<void> {
  const token = await getValidToken();
  if (!token) return;

  const res = await fetch('https://api.spotify.com/v1/me/player/play', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [trackUri] }),
  });

  // 204 = success, 404 = no active Spotify device, 403 = not premium → ignore
  if (!res.ok && res.status !== 204 && res.status !== 404 && res.status !== 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Spotify Connect play failed: ${res.status}`);
  }
}

export async function transferPlayback(deviceId: string): Promise<void> {
  const token = await getValidToken();
  if (!token) return;

  await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
}
