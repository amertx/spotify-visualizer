import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { VisualizerScene } from '../three/scene';
import type { AudioSourceMode } from '../three/liveAnalyzer';
import type { AudioFeatures, AudioAnalysis } from '../spotify/types';

interface Props {
  features:             AudioFeatures | null;
  analysis:             AudioAnalysis | null;
  previewUrl:           string | null;
  positionRef:          React.MutableRefObject<number>;
  positionTimestampRef: React.MutableRefObject<number>;
  isPlayingRef:         React.MutableRefObject<boolean>;
}

export interface VisualizerCanvasHandle {
  resumeAudio(): void;
  startLiveCapture(): Promise<AudioSourceMode>;
  startMicCapture(): Promise<AudioSourceMode>;
  getAudioMode(): AudioSourceMode;
  triggerChange(): void;
}

export const VisualizerCanvas = forwardRef<VisualizerCanvasHandle, Props>(
  function VisualizerCanvas(
    { features, analysis, previewUrl, positionRef, positionTimestampRef, isPlayingRef },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef  = useRef<VisualizerScene | null>(null);

    useImperativeHandle(ref, () => ({
      resumeAudio()       { sceneRef.current?.resumeAudio(); },
      startLiveCapture()  { return sceneRef.current?.startLiveCapture()  ?? Promise.resolve('idle' as AudioSourceMode); },
      startMicCapture()   { return sceneRef.current?.startMicCapture()   ?? Promise.resolve('idle' as AudioSourceMode); },
      getAudioMode()      { return sceneRef.current?.audioMode ?? 'idle'; },
      triggerChange()     { sceneRef.current?.triggerChange(); },
    }));

    useEffect(() => {
      if (!canvasRef.current) return;
      const scene = new VisualizerScene(canvasRef.current);
      scene.setPlaybackRefs({ positionRef, positionTimestampRef, isPlayingRef });
      sceneRef.current = scene;
      scene.start();

      const onResize = () => scene.resize(window.innerWidth, window.innerHeight);
      window.addEventListener('resize', onResize);

      return () => {
        window.removeEventListener('resize', onResize);
        scene.dispose();
        sceneRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => { sceneRef.current?.setAnalysis(analysis); },    [analysis]);
    useEffect(() => { if (features) sceneRef.current?.setFeatures(features); }, [features]);
    useEffect(() => { sceneRef.current?.loadPreview(previewUrl); },  [previewUrl]);

    return (
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'block' }}
      />
    );
  }
);
