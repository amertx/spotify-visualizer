import { useRef, useEffect } from 'react';
import type { AudioAnalysis } from '../spotify/types';

interface BeatSyncCallbacks {
  onBeat: (index: number, confidence: number) => void;
  onBar: (index: number) => void;
  onSection: (index: number) => void;
}

// Finds all events in the half-open interval (prevSec, curSec]
function eventsInWindow<T extends { start: number }>(
  arr: T[],
  prevSec: number,
  curSec: number
): Array<{ item: T; index: number }> {
  const results: Array<{ item: T; index: number }> = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].start > prevSec && arr[i].start <= curSec) {
      results.push({ item: arr[i], index: i });
    }
  }
  return results;
}

export function useBeatSync(
  analysis: AudioAnalysis | null,
  position: number, // ms, updated by player polling
  isPlaying: boolean,
  { onBeat, onBar, onSection }: BeatSyncCallbacks
) {
  const prevPositionRef = useRef<number | null>(null);
  const lastBeatRef = useRef(-1);
  const lastBarRef = useRef(-1);
  const lastSectionRef = useRef(-1);

  // Reset when track changes
  useEffect(() => {
    prevPositionRef.current = null;
    lastBeatRef.current = -1;
    lastBarRef.current = -1;
    lastSectionRef.current = -1;
  }, [analysis]);

  useEffect(() => {
    if (!analysis || !isPlaying) return;

    const curSec = position / 1000;
    const prevSec = prevPositionRef.current ?? curSec - 0.2;
    prevPositionRef.current = curSec;

    // Handle seeks (position jumped backward)
    if (curSec < prevSec - 0.5) {
      prevPositionRef.current = curSec;
      return;
    }

    // Fire all beats in the window
    for (const { item, index } of eventsInWindow(analysis.beats, prevSec, curSec)) {
      if (index !== lastBeatRef.current) {
        lastBeatRef.current = index;
        onBeat(index, item.confidence);
      }
    }

    for (const { item: _item, index } of eventsInWindow(analysis.bars, prevSec, curSec)) {
      if (index !== lastBarRef.current) {
        lastBarRef.current = index;
        onBar(index);
      }
    }

    for (const { item: _item, index } of eventsInWindow(analysis.sections, prevSec, curSec)) {
      if (index !== lastSectionRef.current) {
        lastSectionRef.current = index;
        onSection(index);
      }
    }
  }, [analysis, position, isPlaying, onBeat, onBar, onSection]);
}
