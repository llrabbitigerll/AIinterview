/**
 * AudioWorklet Processor: captures raw PCM audio frames.
 * Runs in AudioWorkletGlobalScope (no DOM, no fetch).
 * Receives Float32 audio data and converts to Int16 PCM,
 * then posts it back to the main thread via MessagePort.
 *
 * This file MUST remain plain JavaScript — AudioWorklet
 * processors cannot be bundled by Vite / TS compiler.
 */
// @ts-nocheck
/* eslint-disable */
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {number} */
    this.bufferSize = 4096; // accumulate ~256ms @16kHz before sending
    /** @type {Float32Array} */
    this.buffer = new Float32Array(this.bufferSize);
    /** @type {number} */
    this.writeIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === 'setBufferSize') {
        this.bufferSize = event.data.size;
        this.buffer = new Float32Array(this.bufferSize);
        this.writeIndex = 0;
      }
    };
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0]; // mono
    if (!channelData) return true;

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.writeIndex++] = channelData[i];

      if (this.writeIndex >= this.bufferSize) {
        // Convert Float32 [-1, 1] → Int16 [-32768, 32767]
        const pcm16 = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Transfer the buffer (zero-copy)
        this.port.postMessage(
          { type: 'pcm', buffer: pcm16.buffer, frames: this.bufferSize },
          [pcm16.buffer]
        );

        this.buffer = new Float32Array(this.bufferSize);
        this.writeIndex = 0;
      }
    }

    // Also compute RMS volume for UI feedback
    let sum = 0;
    for (let i = 0; i < channelData.length; i++) {
      sum += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(sum / channelData.length);
    this.port.postMessage({ type: 'volume', rms });

    return true;
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
