import { useState, useEffect } from 'react';
import { getAudioAnalysis, getAudioFeatures } from '../spotify/api';
import type { AudioAnalysis, AudioFeatures } from '../spotify/types';

export function useAudioAnalysis(trackId: string | null) {
  const [analysis, setAnalysis]   = useState<AudioAnalysis | null>(null);
  const [features, setFeatures]   = useState<AudioFeatures | null>(null);
  const [apiError, setApiError]   = useState<string | null>(null);

  useEffect(() => {
    if (!trackId) { setAnalysis(null); setFeatures(null); setApiError(null); return; }

    setAnalysis(null);
    setFeatures(null);
    setApiError(null);

    // Fetch independently — a 403 on one shouldn't block the other
    getAudioAnalysis(trackId)
      .then(setAnalysis)
      .catch((err: Error) => {
        console.warn('[AudioAnalysis]', err.message);
        if (err.message.includes('403')) {
          setApiError('Spotify Audio Analysis API is restricted for this app. Falling back to Web Audio beat detection.');
        }
      });

    getAudioFeatures(trackId)
      .then(setFeatures)
      .catch((err: Error) => console.warn('[AudioFeatures]', err.message));
  }, [trackId]);

  return { analysis, features, apiError };
}
