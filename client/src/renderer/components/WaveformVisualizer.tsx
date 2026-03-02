/**
 * WaveformVisualizer — Canvas-based microphone waveform animation.
 * Renders animated bars driven by audio volume prop.
 */
import React, { useRef, useEffect, useCallback } from 'react';

interface WaveformVisualizerProps {
  volume: number;       // 0..1 RMS volume from AudioStreamManager
  isSpeaking: boolean;  // VAD speaking state
}

const BAR_COUNT = 24;
const BAR_GAP = 2;
const CANVAS_HEIGHT = 48;
const MIN_BAR_H = 3;
const DECAY = 0.88;          // smoothing factor
const SPEAKING_BOOST = 1.4;  // amplify when VAD says speaking

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({ volume, isSpeaking }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));
  const rafRef = useRef<number>(0);
  const volumeRef = useRef(volume);
  const isSpeakingRef = useRef(isSpeaking);

  // Keep volume and isSpeaking in refs so animation loop never needs to re-create
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const barW = (w - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;

    ctx.clearRect(0, 0, w, h);

    const bars = barsRef.current;
    const speaking = isSpeakingRef.current;
    const v = volumeRef.current * (speaking ? SPEAKING_BOOST : 0.6);

    for (let i = 0; i < BAR_COUNT; i++) {
      // Target height based on volume + slight randomness for organic feel
      const target = Math.max(MIN_BAR_H, v * h * (0.6 + Math.random() * 0.8));
      // Smooth towards target
      bars[i] = bars[i] * DECAY + target * (1 - DECAY);

      const barH = Math.min(bars[i], h);
      const x = i * (barW + BAR_GAP);
      const y = (h - barH) / 2;

      // Gradient color based on speaking state
      const alpha = 0.4 + 0.6 * (barH / h);
      ctx.fillStyle = speaking
        ? `rgba(37, 99, 235, ${alpha})`   // Modern blue (var(--accent))
        : `rgba(156, 163, 175, ${alpha})`;  // Light gray when idle

      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    }

    rafRef.current = requestAnimationFrame(draw);
  }, []); // stable — reads isSpeaking/volume from refs

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={CANVAS_HEIGHT}
      className="waveform-canvas"
      style={{
        width: '100%',
        height: CANVAS_HEIGHT,
        borderRadius: 6,
      }}
    />
  );
};

export default WaveformVisualizer;
