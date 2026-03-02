/**
 * TTSPlayer
 *
 * Manages sequential playback of TTS audio chunks received from the server.
 * Each chunk is a base64-encoded WAV file corresponding to one sentence.
 *
 * Playback model:
 *   - Chunks arrive asynchronously (via addChunk) and are queued in order.
 *   - As soon as the first chunk arrives, playback starts immediately.
 *   - Subsequent chunks play back-to-back (chained via `onended`).
 *   - When `markDone()` is called AND the queue is empty, `onFinished` fires.
 *
 * Lifecycle:
 *   tts_start  → stop() + audio.suspend() + isTtsPlaying=true
 *   tts_audio_chunk × n → addChunk()
 *   tts_done   → markDone()
 *   last chunk onended → onFinished() → audio.resume() + isTtsPlaying=false
 */
export class TTSPlayer {
  private queue: string[] = [];        // base64 WAV blobs waiting to play
  private blobUrls: string[] = [];     // track for cleanup
  private currentAudio: HTMLAudioElement | null = null;
  private isPlaying = false;
  private isDone = false;              // tts_done received

  /** Called when the last audio chunk finishes playing */
  onFinished: (() => void) | null = null;

  /**
   * Receive a base64-encoded WAV chunk from the server.
   * Starts playback immediately if not already playing.
   */
  addChunk(base64Wav: string): void {
    this.queue.push(base64Wav);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /**
   * Signal that all chunks have been sent by the server.
   * If the queue is already empty (fast TTS), fires onFinished immediately.
   */
  markDone(): void {
    this.isDone = true;
    // Edge case: all chunks already played before markDone arrived
    if (!this.isPlaying && this.queue.length === 0) {
      this.onFinished?.();
    }
  }

  /**
   * Immediately stop playback and clear all pending chunks.
   * Called at the start of each new TTS session to clear leftovers.
   */
  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.onended = null;
      this.currentAudio = null;
    }
    this.queue = [];
    this.isPlaying = false;
    this.isDone = false;
    // Revoke all pending blob URLs to free memory
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls = [];
  }

  // ── Private ─────────────────────────────────────────────

  private playNext(): void {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      if (this.isDone) {
        // All chunks played AND server confirmed done
        this.onFinished?.();
      }
      return;
    }

    const base64 = this.queue.shift()!;
    this.isPlaying = true;

    // Decode base64 → binary → Blob → Object URL
    let blobUrl: string;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      blobUrl = URL.createObjectURL(blob);
      this.blobUrls.push(blobUrl);
    } catch (err) {
      console.error('[TTSPlayer] Failed to decode audio chunk:', err);
      // Skip this chunk and try the next
      this.playNext();
      return;
    }

    const audio = new Audio(blobUrl);
    this.currentAudio = audio;

    audio.onended = () => {
      URL.revokeObjectURL(blobUrl);
      this.blobUrls = this.blobUrls.filter((u) => u !== blobUrl);
      this.currentAudio = null;
      this.playNext();
    };

    audio.onerror = (e) => {
      console.error('[TTSPlayer] Audio playback error:', e);
      URL.revokeObjectURL(blobUrl);
      this.blobUrls = this.blobUrls.filter((u) => u !== blobUrl);
      this.currentAudio = null;
      this.playNext(); // continue with next chunk despite error
    };

    audio.play().catch((err) => {
      console.error('[TTSPlayer] audio.play() rejected:', err);
      this.currentAudio = null;
      this.playNext();
    });
  }
}
