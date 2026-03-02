/**
 * FluencyAnalyzer
 * 
 * Client-side lightweight fluency analysis engine.
 * Processes ASR transcription results (with word-level timestamps)
 * and VAD events to compute real-time fluency metrics.
 * 
 * Scoring uses weighted formula (weakest dimension gets highest weight),
 * not simple arithmetic average.
 */

import type { FluencySnapshot } from '../types';
import type { PauseCategory } from './AudioStreamManager';

interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export class FluencyAnalyzer {
  // Filler / hedge words (Chinese + English)
  private static readonly FILLER_WORDS = new Set([
    // Chinese
    '然后', '那个', '嗯', '啊', '就是', '所以', '呃',
    '其实', '对吧', '这样', '的话', '可能', '大概',
    '反正', '总之', '怎么说', '就是说',
    // English
    'um', 'uh', 'like', 'you know', 'basically', 'actually',
    'so', 'well', 'I mean',
  ]);

  // Running metrics for the current answer segment
  private wordTimestamps: WordTimestamp[] = [];
  // Categorized word-level gaps
  private normalGaps: number[] = [];     // 600–2100ms (light hesitation)
  private confirmedGaps: number[] = [];  // 2100–4000ms (effective pause)
  private longGaps: number[] = [];       // ≥4000ms (thought block)
  private fillerCounts: Record<string, number> = {};
  private speechRateHistory: number[] = [];
  // VAD pause events with category
  private vadPauses: Array<{ durationMs: number; category: PauseCategory }> = [];
  private fillerPauseCount = 0;  // segments that are filler-words only
  private segmentStartTime = 0;

  constructor() {
    this.reset();
  }

  /**
   * Reset all metrics for a new answer segment.
   */
  reset(): void {
    this.wordTimestamps = [];
    this.normalGaps = [];
    this.confirmedGaps = [];
    this.longGaps = [];
    this.fillerCounts = {};
    this.speechRateHistory = [];
    this.vadPauses = [];
    this.fillerPauseCount = 0;
    this.segmentStartTime = Date.now();
  }

  /**
   * Process ASR transcription result with word-level timestamps.
   * Called each time cloud ASR returns a (partial or final) result.
   */
  processTranscription(text: string, words: WordTimestamp[], isFinal: boolean): void {
    // Detect fillers in text
    this.detectFillers(text);

    // Accumulate word timestamps
    if (words.length > 0) {
      this.wordTimestamps.push(...words);
    }

    // Calculate speech rate from this chunk
    if (words.length > 1) {
      const durationSec =
        (words[words.length - 1].endMs - words[0].startMs) / 1000;
      if (durationSec > 0) {
        const wordsPerMin = (words.length / durationSec) * 60;
        this.speechRateHistory.push(wordsPerMin);
      }
    }

    if (isFinal) {
      this.analyzeWordGaps(words);
      // Detect filler-only segments (effectively a pause with filler noise)
      if (text.trim().length > 0 && this.isFillerOnly(text)) {
        this.fillerPauseCount++;
      }
    }
  }

  /**
   * Record a VAD pause event with category.
   */
  recordPause(durationMs: number, category: PauseCategory = 'confirmed'): void {
    this.vadPauses.push({ durationMs, category });
  }

  /**
   * Check if any word-level speech rate data has been collected.
   */
  hasSpeechRateData(): boolean {
    return this.speechRateHistory.length > 0;
  }

  /**
   * Fallback: estimate speech rate from plain text length and duration.
   * Used when ASR does not provide word-level timestamps.
   * For Chinese text, each character ≈ 1 word.
   */
  addEstimatedRateFromText(text: string, durationMs: number): void {
    if (durationMs <= 0 || !text.trim()) return;
    // Count Chinese characters + English words
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = text.replace(/[\u4e00-\u9fff]/g, ' ').trim().split(/\s+/).filter(w => w.length > 0).length;
    const totalWords = chineseChars + englishWords;
    if (totalWords === 0) return;
    const durationSec = durationMs / 1000;
    const wpm = (totalWords / durationSec) * 60;
    this.speechRateHistory.push(wpm);
  }

  /**
   * Generate a fluency snapshot with weighted scoring.
   */
  generateSnapshot(): FluencySnapshot {
    const avgSpeechRate = this.average(this.speechRateHistory);
    const totalFillers = Object.values(this.fillerCounts).reduce((a, b) => a + b, 0);

    const speechRateScore = this.calcSpeechRateScore(avgSpeechRate);
    const pauseScore = this.calcPauseScore();
    const fillerScore = this.calcFillerScore(totalFillers);

    const scores = [speechRateScore, pauseScore, fillerScore].sort((a, b) => a - b);
    const overallScore = Math.round(
      scores[0] * 0.4 + scores[1] * 0.3 + scores[2] * 0.3
    );

    const pauseCount =
      this.confirmedGaps.length +
      this.vadPauses.filter(p => p.category === 'confirmed').length;
    const longPauseCount =
      this.longGaps.length +
      this.vadPauses.filter(p => p.category === 'long').length;

    return {
      overallScore,
      speechRate: Math.round(avgSpeechRate),
      speechRateScore,
      pauseCount,
      longPauseCount,
      fillerPauseCount: this.fillerPauseCount,
      pauseScore,
      fillerCount: totalFillers,
      fillerBreakdown: { ...this.fillerCounts },
      fillerScore,
      timestamp: Date.now(),
    };
  }

  /**
   * Export detailed fluency evidence for backend evaluation memory.
   */
  exportEvidence(): {
    speechRateHistory: number[];
    vadPauses: Array<{ durationMs: number; category: PauseCategory }>;
    wordGaps: { normalMs: number[]; confirmedMs: number[]; longMs: number[] };
    fillerSegments: number;
    thinking: { toFirstWordSeconds: number; silenceSeconds: number };
  } {
    const toFirstWordSeconds =
      this.wordTimestamps.length > 0
        ? Math.max(0, this.wordTimestamps[0].startMs / 1000)
        : 0;

    const silenceMs =
      this.normalGaps.reduce((sum, value) => sum + value, 0) +
      this.confirmedGaps.reduce((sum, value) => sum + value, 0) +
      this.longGaps.reduce((sum, value) => sum + value, 0) +
      this.vadPauses.reduce((sum, item) => sum + item.durationMs, 0);

    return {
      speechRateHistory: [...this.speechRateHistory],
      vadPauses: this.vadPauses.map((item) => ({ ...item })),
      wordGaps: {
        normalMs: [...this.normalGaps],
        confirmedMs: [...this.confirmedGaps],
        longMs: [...this.longGaps],
      },
      fillerSegments: this.fillerPauseCount,
      thinking: {
        toFirstWordSeconds: Number(toFirstWordSeconds.toFixed(2)),
        silenceSeconds: Number((silenceMs / 1000).toFixed(2)),
      },
    };
  }

  // ── Private helpers ───────────────────────────────────────

  private detectFillers(text: string): void {
    const lowerText = text.toLowerCase();
    for (const filler of FluencyAnalyzer.FILLER_WORDS) {
      const regex = new RegExp(filler, 'gi');
      const matches = lowerText.match(regex);
      if (matches) {
        this.fillerCounts[filler] =
          (this.fillerCounts[filler] || 0) + matches.length;
      }
    }
  }

  private analyzeWordGaps(words: WordTimestamp[]): void {
    for (let i = 1; i < words.length; i++) {
      const gap = words[i].startMs - words[i - 1].endMs;
      if (gap >= 4000)       this.longGaps.push(gap);
      else if (gap >= 2100)  this.confirmedGaps.push(gap);
      else if (gap >= 600)   this.normalGaps.push(gap);
    }
  }

  /**
   * Returns true if the text consists only of filler words and punctuation.
   * Such a segment is treated as a "filler pause" — the speaker was filling
   * silence with hedge words rather than conveying content.
   */
  private isFillerOnly(text: string): boolean {
    // Strip punctuation and whitespace, then check if remaining tokens are all fillers
    const cleaned = text
      .replace(/[，。！？、「」,\.!?;:\s]+/g, ' ')
      .trim()
      .toLowerCase();
    if (!cleaned) return false;
    const tokens = cleaned.split(/\s+/);
    return tokens.length > 0 && tokens.every(t =>
      FluencyAnalyzer.FILLER_WORDS.has(t)
    );
  }

  /**
   * Speech rate score:
   * Ideal range: 120-180 words/min (Chinese characters/min)
   * Stable rate (low variance) scores higher
   */
  private calcSpeechRateScore(avgRate: number): number {
    if (avgRate === 0) return 50; // no data

    // Penalty for being outside ideal range
    let ratePenalty = 0;
    if (avgRate < 120) ratePenalty = (120 - avgRate) * 0.5;
    else if (avgRate > 200) ratePenalty = (avgRate - 200) * 0.5;

    // Penalty for high variance (inconsistent speed)
    const variance = this.calcVariance(this.speechRateHistory);
    const stdDev = Math.sqrt(variance);
    const variancePenalty = Math.min(30, stdDev * 0.3);

    return Math.max(0, Math.round(100 - ratePenalty - variancePenalty));
  }

  /**
   * Pause score: penalize excessive long pauses
   */
  private calcPauseScore(): number {
    const confirmed =
      this.confirmedGaps.length +
      this.vadPauses.filter(p => p.category === 'confirmed').length;
    const long =
      this.longGaps.length +
      this.vadPauses.filter(p => p.category === 'long').length;
    const fillerPauses = this.fillerPauseCount;

    return Math.max(0, Math.round(
      100 - confirmed * 8 - long * 20 - fillerPauses * 5
    ));
  }

  /**
   * Filler score: penalize high filler density
   * Threshold: >5 fillers per 100 words starts losing points
   */
  private calcFillerScore(totalFillers: number): number {
    const totalWords = this.wordTimestamps.length || 1;
    const fillerDensity = (totalFillers / totalWords) * 100;

    if (fillerDensity <= 3) return 100;
    if (fillerDensity <= 5) return 85;
    return Math.max(0, Math.round(100 - (fillerDensity - 3) * 8));
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private calcVariance(arr: number[]): number {
    if (arr.length < 2) return 0;
    const avg = this.average(arr);
    return arr.reduce((sum, x) => sum + (x - avg) ** 2, 0) / arr.length;
  }
}
