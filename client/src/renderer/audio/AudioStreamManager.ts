/**
 * AudioStreamManager
 * 
 * Manages microphone capture → AudioWorklet PCM processing → WebSocket streaming.
 * Integrates with @ricky0123/vad-web for voice activity detection.
 * 
 * Audio pipeline:
 *   Microphone (getUserMedia)
 *     → AudioContext (16kHz)
 *       → PCMCaptureProcessor (AudioWorklet, Float32 → Int16 PCM)
 *         → MessagePort → main thread
 *           → WebSocket binary frames → cloud ASR
 */

import type { RealtimeAudioMetrics } from '../types';

export type PauseCategory = 'normal' | 'confirmed' | 'long';

export type AudioEvent =
  | { type: 'volume'; rms: number }
  | { type: 'speechStart' }
  | { type: 'speechEnd'; duration: number }
  | { type: 'pauseDetected'; durationMs: number; category: PauseCategory }
  | { type: 'error'; error: Error };

type AudioEventHandler = (event: AudioEvent) => void;

// Recording state machine
export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

export class AudioStreamManager {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private eventHandlers: Set<AudioEventHandler> = new Set();

  // PCM data callback — set by InterviewService to bridge to WebSocketService
  private _pcmCallback: ((buffer: ArrayBuffer) => void) | null = null;

  // VAD state tracking
  private isSpeaking = false;
  private speechStartTime = 0;
  private lastSpeechEndTime = 0;
  private silenceStartTime = 0;  // when silence actually began (before the 1500ms timer)
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  // Recording state machine
  private _state: RecordingState = 'idle';

  // Software gate: when true, PCM data is discarded instead of forwarded.
  // Used during TTS playback to mute the mic without suspending the AudioContext
  // (AudioContext.suspend/resume can silently break AudioWorklet message delivery
  // in Electron/Chrome, causing the mic to appear active but produce no data).
  private _micGated = false;

  // Config
  private readonly SAMPLE_RATE = 16000;
  private readonly SILENCE_THRESHOLD_MS = 1500; // 1.5s = end of utterance (ASR flush)
  private readonly PAUSE_THRESHOLD_MS = 600;    // 0.6s = first trigger (potential pause)
  private readonly PAUSE_CONFIRM_MS = 2100;     // 2.1s = confirmed pause (score penalty)
  private readonly PAUSE_BREAK_MS = 4000;       // 4.0s = long pause / thought block
  private readonly PCM_BUFFER_SIZE = 4096;      // ~256ms @ 16kHz

  private _isInitialized = false;

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  get state(): RecordingState {
    return this._state;
  }

  /**
   * Register a callback to receive raw PCM data.
   * Used by InterviewService to bridge audio to WebSocketService.sendBinary().
   */
  onPCMData(callback: (buffer: ArrayBuffer) => void): void {
    this._pcmCallback = callback;
  }

  on(handler: AudioEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: AudioEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* ignore */ }
    }
  }

  /**
   * Initialize audio capture pipeline.
   * Must be called after a user gesture (browser autoplay policy).
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    try {
      // 1. Get microphone — we do NOT constrain sampleRate in getUserMedia
      //    (not reliable across browsers). Instead we use AudioContext resampling.
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 2. Create AudioContext at target sample rate (16kHz for ASR)
      this.audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 3. Load and connect AudioWorklet for PCM capture
      // Use URL relative to current document so it works under both
      // http://localhost (dev) and file:// (Electron production) protocols.
      const workletUrl = new URL('pcm-capture-processor.js', window.location.href).href;
      await this.audioContext.audioWorklet.addModule(workletUrl);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-capture-processor');

      // Configure buffer size
      this.workletNode.port.postMessage({
        type: 'setBufferSize',
        size: this.PCM_BUFFER_SIZE,
      });

      // Handle messages from worklet
      this.workletNode.port.onmessage = (event) => {
        const data = event.data;
        if (data.type === 'pcm') {
          this.handlePCMData(data.buffer as ArrayBuffer);
        } else if (data.type === 'volume') {
          this.handleVolume(data.rms as number);
        }
      };

      source.connect(this.workletNode);
      // Don't connect to destination — we don't want to hear ourselves
      // this.workletNode.connect(this.audioContext.destination);

      this._isInitialized = true;
      this._state = 'recording';
    } catch (err) {
      this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      throw err;
    }
  }

  /**
   * Handle raw PCM buffer from AudioWorklet.
   * Forwards to registered PCM callback (bridged to WebSocketService).
   */
  private handlePCMData(buffer: ArrayBuffer): void {
    // When the mic is soft-muted (e.g. during TTS playback), discard data.
    if (this._micGated) return;

    // Forward PCM to InterviewService → WebSocketService.sendBinary()
    if (this._pcmCallback) {
      this._pcmCallback(buffer);
    }

    // Simple energy-based VAD (complements @ricky0123/vad-web)
    const pcm16 = new Int16Array(buffer);
    let energy = 0;
    for (let i = 0; i < pcm16.length; i++) {
      energy += (pcm16[i] / 32768) ** 2;
    }
    const rmsEnergy = Math.sqrt(energy / pcm16.length);
    const isSpeechFrame = rmsEnergy > 0.01; // threshold

    this.updateVADState(isSpeechFrame);
  }

  /**
   * Track speech/silence transitions for pause detection.
   */
  private updateVADState(isSpeechFrame: boolean): void {
    const now = Date.now();

    if (isSpeechFrame && !this.isSpeaking) {
      // Speech started — categorize and emit the preceding pause
      this.isSpeaking = true;
      this.speechStartTime = now;

      if (this.silenceStartTime > 0) {
        const pauseDuration = now - this.silenceStartTime; // true silence duration
        if (pauseDuration >= this.PAUSE_THRESHOLD_MS) {
          const category: PauseCategory =
            pauseDuration >= this.PAUSE_BREAK_MS ? 'long'
            : pauseDuration >= this.PAUSE_CONFIRM_MS ? 'confirmed'
            : 'normal';
          this.emit({ type: 'pauseDetected', durationMs: pauseDuration, category });
        }
        this.silenceStartTime = 0;
      }

      this.emit({ type: 'speechStart' });
      this.clearSilenceTimer();
    }

    if (!isSpeechFrame && this.isSpeaking) {
      // Potential speech end — record silence start and begin timer
      if (!this.silenceTimer) {
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = now; // record when silence actually began
        }
        const speechStart = this.speechStartTime; // capture for closure
        const silenceThreshold = this.SILENCE_THRESHOLD_MS;
        this.silenceTimer = setTimeout(() => {
          // Subtract the wait window to get approximate real speech-end time
          const endTime = Date.now() - silenceThreshold;
          this.isSpeaking = false;
          this.lastSpeechEndTime = endTime;
          const duration = Math.max(0, endTime - speechStart);
          this.emit({ type: 'speechEnd', duration });
        }, this.SILENCE_THRESHOLD_MS);
      }
    }

    if (isSpeechFrame && this.silenceTimer) {
      // Speech resumed during silence window — not a real pause
      this.silenceStartTime = 0;
      this.clearSilenceTimer();
    }
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private handleVolume(rms: number): void {
    // Don't emit volume events while gated (TTS playback) — the InterviewService
    // listener sets isRecording:true on every volume event, which would override
    // the isRecording:false set by the tts_start handler.
    if (this._micGated) return;
    this.emit({ type: 'volume', rms: Math.min(1, rms * 3) }); // amplify for UI
  }

  /**
   * Resume audio capture (unmute).
   * Lifts the software gate so PCM data flows again.
   * Does NOT touch AudioContext state — the AudioContext is kept running
   * at all times to avoid Electron/Chrome worklet msg-drop bugs on resume.
   */
  async resume(): Promise<void> {
    if (this._state === 'stopped') return; // cannot resume after destroy
    this._micGated = false;
    this._state = 'recording';
  }

  /**
   * Reset VAD state machine.
   * Called when suspending for TTS to prevent stale "isSpeaking=true" state
   * from persisting across the TTS gap and blocking speechStart/speechEnd events.
   */
  resetVAD(): void {
    this.clearSilenceTimer();
    this.isSpeaking = false;
    this.silenceStartTime = 0;
  }

  /**
   * Pause audio capture (mute) via software gate.
   * Sets _micGated=true so PCM data is discarded at handlePCMData.
   * Does NOT suspend the AudioContext — keeping it running avoids a
   * Chromium/Electron regression where AudioWorklet stops posting messages
   * after AudioContext.suspend() + AudioContext.resume().
   */
  async suspend(): Promise<void> {
    // Reset VAD first: prevents stale isSpeaking flag from persisting
    // across TTS playback. After resume(), a new speech segment will
    // correctly trigger speechStart again.
    this.resetVAD();

    this._micGated = true;
    if (this._state === 'recording') {
      this._state = 'paused';
    }
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this.clearSilenceTimer();

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this._pcmCallback = null;
    this.eventHandlers.clear();
    this._isInitialized = false;
    this._state = 'stopped';
  }
}
