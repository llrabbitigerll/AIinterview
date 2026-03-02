/**
 * InterviewService
 * 
 * Orchestrates the interview flow on the client side:
 * - Connects AudioStreamManager (mic capture) + WebSocketService (cloud comm)
 * - Dispatches ASR transcription results to FluencyAnalyzer
 * - Routes server messages to Zustand store updates
 * - Manages interview lifecycle (init → interview → complete)
 */

import { v4 as uuidv4 } from 'uuid';
import { AudioStreamManager } from '../audio/AudioStreamManager';
import { FluencyAnalyzer } from '../audio/FluencyAnalyzer';
import { WebSocketService } from './WebSocketService';
import { TTSPlayer } from './TTSPlayer';
import { useInterviewStore } from '../stores/interviewStore';
import type { ServerMessage, ClientMessage } from '../types/protocol';
import type { InterviewConfig } from '../types';

const SERVER_WS_URL = `${import.meta.env.VITE_WS_BASE_URL}/ws/interview`;

export class InterviewService {
  private audio: AudioStreamManager;
  private ws: WebSocketService;
  private fluency: FluencyAnalyzer;
  private ttsPlayer: TTSPlayer;
  private cleanupFns: Array<() => void> = [];
  private currentInterviewId: string | null = null;
  private lastSpeechDurationMs = 0;  // duration of last VAD speech burst
  private _skipNextReport = false;    // true when user ends with zero answered questions

  // Safety timeout: if onFinished doesn't fire within MAX_TTS_DURATION_MS,
  // force-resume mic so user is never permanently locked out.
  private _ttsTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _ttsSuspendPromise: Promise<void> | null = null;
  private static readonly MAX_TTS_DURATION_MS = 90_000; // 90 s hard limit

  constructor() {
    this.audio = new AudioStreamManager();
    this.ws = new WebSocketService({ url: SERVER_WS_URL });
    this.fluency = new FluencyAnalyzer();
    this.ttsPlayer = new TTSPlayer();

    // When TTS finishes playing all chunks, resume mic and clear playing state
    this.ttsPlayer.onFinished = () => {
      this._clearTtsTimeout();
      void this._resumeMicAfterTTS('tts.onFinished');
    };
  }

  private async _resumeMicAfterTTS(source: string): Promise<void> {
    try {
      if (this._ttsSuspendPromise) {
        await this._ttsSuspendPromise;
      }
      await this.audio.resume();
      useInterviewStore.getState().updateAudio({ isTtsPlaying: false, isRecording: true });
      // Notify server that TTS playback is fully complete and the mic is active.
      // The server uses this signal to re-check / restart the ASR connection at
      // the correct moment — AFTER the client finishes playing audio, not when
      // tts_done was sent (which can be many seconds before playback ends).
      if (this.currentInterviewId) {
        this.ws.sendJSON({
          type: 'tts_playback_done',
          seq: this.ws.nextSeq,
        } as any);
      }
    } catch (err) {
      console.error(`[InterviewService] Failed to resume mic after ${source}:`, err);
      useInterviewStore.getState().updateAudio({ isTtsPlaying: false, isRecording: false });
    }
  }

  /** Arm a watchdog timer when TTS starts.  Forces mic restoration if needed. */
  private _armTtsTimeout(): void {
    this._clearTtsTimeout();
    this._ttsTimeoutId = setTimeout(() => {
      console.warn('[InterviewService] TTS timeout watchdog fired — forcing mic resume');
      this.ttsPlayer.stop();
      void this._resumeMicAfterTTS('tts.watchdog');
      this._ttsTimeoutId = null;
    }, InterviewService.MAX_TTS_DURATION_MS);
  }

  private _clearTtsTimeout(): void {
    if (this._ttsTimeoutId !== null) {
      clearTimeout(this._ttsTimeoutId);
      this._ttsTimeoutId = null;
    }
  }

  /**
   * Initialize and start a new interview session.
   * @param preGeneratedId Optional pre-generated interview ID (used when research was run first)
   */
  async startInterview(config: Omit<InterviewConfig, 'interviewId'>, preGeneratedId?: string): Promise<void> {
    const store = useInterviewStore.getState();
    const interviewId = preGeneratedId ?? uuidv4();
    this.currentInterviewId = interviewId;

    const fullConfig: InterviewConfig = { ...config, interviewId };

    // 1. Update store
    store.initInterview(fullConfig);

    try {
      // 2. Initialize audio pipeline
      await this.audio.initialize();

      // 2.5. Bridge PCM audio data → WebSocket binary frames
      this.audio.onPCMData((buffer) => {
        this.ws.sendBinary(buffer);
      });

      // 3. Wire up audio events → store updates
      const unsubAudio = this.audio.on((event) => {
        const s = useInterviewStore.getState();
        switch (event.type) {
          case 'volume':
            s.updateAudio({ currentVolume: event.rms, isRecording: true });
            break;
          case 'speechStart':
            s.updateAudio({ isSpeaking: true, wordGapAlert: false });
            break;
          case 'speechEnd':
            s.updateAudio({ isSpeaking: false });
            // Track duration for fallback speech rate estimation
            this.lastSpeechDurationMs = event.duration;
            // Notify server
            this.ws.sendJSON({
              type: 'speech_end',
              interviewId,
              seq: this.ws.nextSeq,
            });
            // Generate fluency snapshot for real-time sidebar display
            // (Do NOT reset here — reset happens when user actually sends the message)
            const snapshot = this.fluency.generateSnapshot();
            s.updateFluency(snapshot);
            break;
          case 'pauseDetected':
            if (event.category !== 'normal') {
              s.updateAudio({ wordGapAlert: true });
            }
            this.fluency.recordPause(event.durationMs, event.category);
            break;
          case 'error':
            console.error('[Interview] Audio error:', event.error);
            break;
        }
      });
      this.cleanupFns.push(unsubAudio);

      // 4. Wire up WebSocket messages → store updates
      const unsubMsg = this.ws.onMessage((msg) => this.handleServerMessage(msg));
      this.cleanupFns.push(unsubMsg);

      const unsubConn = this.ws.onConnectionChange((connected) => {
        const s = useInterviewStore.getState();
        if (connected && s.phase === 'connecting') {
          s.setPhase('interviewing');
        }
      });
      this.cleanupFns.push(unsubConn);

      // 5. Connect WebSocket
      this.ws.connect();

      // 6. Send init message once connected
      const waitForConnection = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
        const unsub = this.ws.onConnectionChange((connected) => {
          if (connected) {
            clearTimeout(timeout);
            unsub();
            resolve();
          }
        });
      });

      await waitForConnection;

      this.ws.sendJSON({
        type: 'init_interview',
        interviewId,
        config: {
          company: config.company,
          businessUnit: config.businessUnit,
          team: config.team,
          positionType: config.positionType,
          round: config.round,
          resumeJson: JSON.stringify(config.resume),
        },
        seq: this.ws.nextSeq,
      });

      // 7. Start audio streaming
      await this.audio.resume();
    } catch (err) {
      // Clean up resources on failure so next attempt starts fresh
      this.destroy();
      throw err;
    }
  }

  /**
   * Send voice-transcribed text (with fluency data).
   * Called when user confirms the voice transcription.
   */
  sendVoiceMessage(text: string): void {
    if (!this.currentInterviewId) return;
    const store = useInterviewStore.getState();

    // Generate final fluency snapshot for the complete answer segment
    const snapshot = this.fluency.generateSnapshot();
    const evidence = this.fluency.exportEvidence();

    // Add user message with fluency data
    store.addMessage({
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      fluency: snapshot,
    });

    // Send to server
    this.ws.sendJSON({
      type: 'text_input',
      interviewId: this.currentInterviewId,
      text,
      fluencyPayload: {
        snapshot,
        details: {
          speechRateHistory: evidence.speechRateHistory,
          vadPauses: evidence.vadPauses,
          wordGaps: evidence.wordGaps,
          fillerSegments: evidence.fillerSegments,
        },
        thinking: {
          toFirstWordSeconds: evidence.thinking.toFirstWordSeconds,
          silenceSeconds: evidence.thinking.silenceSeconds,
        },
      },
      seq: this.ws.nextSeq,
    });

    // Persist the final snapshot so the report page always shows the correct
    // speech rate.  Without this, VAD speechEnd events that fire after reset()
    // would overwrite latestFluency with a zero-rate snapshot.
    store.updateFluency(snapshot);

    // Now reset fluency for the next answer segment
    this.fluency.reset();
    this.lastSpeechDurationMs = 0;

    // Clear pending state
    store.updateAudio({
      pendingVoiceText: '',
      hadVoiceInput: false,
    });
  }

  /**
   * Send text input (fallback mode without mic).
   */
  sendTextInput(text: string): void {
    if (!this.currentInterviewId) return;
    const store = useInterviewStore.getState();

    // Add user message to store
    store.addMessage({
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    this.ws.sendJSON({
      type: 'text_input',
      interviewId: this.currentInterviewId,
      text,
      seq: this.ws.nextSeq,
    });
  }

  /**
   * Submit code from code editor panel.
   */
  sendCodeSubmit(code: string, language: string): void {
    if (!this.currentInterviewId) return;
    const store = useInterviewStore.getState();

    // Add code as user message (formatted)
    store.addMessage({
      id: uuidv4(),
      role: 'user',
      content: `\`\`\`${language}\n${code}\n\`\`\``,
      timestamp: Date.now(),
    });

    this.ws.sendJSON({
      type: 'code_submit',
      interviewId: this.currentInterviewId,
      code,
      language,
      seq: this.ws.nextSeq,
    } as any);
  }

  /**
   * Lock answer: immediately suspend mic + fluency stats, then flush ASR.
   * Triggered by the '回答结束' button. After this, the user reviews the
   * transcribed text and explicitly clicks send.
   */
  lockAnswer(): void {
    if (!this.currentInterviewId) return;
    const s = useInterviewStore.getState();

    // 1. Suspend mic — stops PCM stream so VAD won't fire more speechEnd events
    this.audio.suspend();

    // 2. Freeze fluency snapshot at this moment
    const snap = this.fluency.generateSnapshot();
    s.updateFluency(snap);

    // 3. Tell server to flush ASR buffer → server sends final transcription back
    //    (server will NOT trigger LLM — on_speech_end now only flushes)
    this.ws.sendJSON({
      type: 'speech_end',
      interviewId: this.currentInterviewId,
      seq: this.ws.nextSeq,
    });

    // 4. Mark answer as locked in store
    s.updateAudio({
      isAnswerLocked: true,
      isSpeaking: false,
      wordGapAlert: false,
    });
  }

  /**
   * Unlock answer: resume mic so user can re-record if they want to redo.
   * Also clears the locked state without sending any message.
   */
  unlockAnswer(): void {
    const s = useInterviewStore.getState();
    this.audio.resume();
    s.updateAudio({
      isAnswerLocked: false,
      currentTranscription: '',
    });
  }

  /**
   * Pause / resume the interview.
   */
  pauseInterview(): void {
    if (!this.currentInterviewId) return;
    this.audio.suspend();
    useInterviewStore.getState().setPhase('paused');
    this.ws.sendJSON({
      type: 'control',
      interviewId: this.currentInterviewId,
      action: 'pause',
      seq: this.ws.nextSeq,
    });
  }

  resumeInterview(): void {
    if (!this.currentInterviewId) return;
    this.audio.resume();
    useInterviewStore.getState().setPhase('interviewing');
    this.ws.sendJSON({
      type: 'control',
      interviewId: this.currentInterviewId,
      action: 'resume',
      seq: this.ws.nextSeq,
    });
  }

  /**
   * End the interview.
   * If zero questions have been answered, skip the report page and return to home.
   */
  endInterview(): void {
    if (!this.currentInterviewId) return;
    const bb = useInterviewStore.getState().blackboard;
    if ((bb?.totalQuestions ?? 0) === 0) {
      // No questions answered — skip report, just go back to idle (PreparePage)
      this._skipNextReport = true;
    }
    this.ws.sendJSON({
      type: 'control',
      interviewId: this.currentInterviewId,
      action: 'end',
      seq: this.ws.nextSeq,
    });
  }

  /**
   * Full cleanup.
   */
  destroy(): void {
    this._clearTtsTimeout();
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    this.audio.destroy();
    this.ws.disconnect();
    this.ttsPlayer.stop();
    this.currentInterviewId = null;
    // Reset singleton so next call to getInterviewService() creates a fresh instance
    _interviewService = null;
  }

  // ── Server message routing ──────────────────────────────

  private handleServerMessage(msg: ServerMessage): void {
    const store = useInterviewStore.getState();

    switch (msg.type) {
      case 'interview_ready':
        store.setPhase('interviewing');
        store.setDoubleAgentMode(msg.isDoubleAgentMode ?? false);
        store.setAgents(
          { displayName: msg.agents.agentB.displayName, persona: msg.agents.agentB.persona },
          msg.agents.agentC
            ? { displayName: msg.agents.agentC.displayName, persona: msg.agents.agentC.persona }
            : {}
        );
        // Add the first question as a message
        store.addMessage({
          id: uuidv4(),
          role: msg.firstAgent,
          content: msg.firstQuestion,
          timestamp: Date.now(),
        });
        break;

      case 'asr_status':
        if (!(msg as any).available) {
          const asrWarn = (msg as any).warning || 'ASR 语音识别服务不可用';
          console.warn('[ASR] Service unavailable:', asrWarn);
          store.addMessage({
            id: uuidv4(),
            role: 'system',
            content: `⚠️ 语音识别暂不可用，请使用文字输入。`,
            timestamp: Date.now(),
          });
        }
        break;

      case 'transcription':
        store.updateAudio({
          currentTranscription: msg.text,
        });
        // Feed to fluency analyzer
        this.fluency.processTranscription(msg.text, msg.words, msg.isFinal);

        // If final, populate pending voice text for user confirmation (do NOT auto-send)
        if (msg.isFinal && msg.text.trim()) {
          // Fallback speech rate estimation if no word-level timestamps
          if (!this.fluency.hasSpeechRateData() && this.lastSpeechDurationMs > 0) {
            this.fluency.addEstimatedRateFromText(msg.text, this.lastSpeechDurationMs);
          }
          // Update fluency snapshot with latest data
          const finalSnapshot = this.fluency.generateSnapshot();
          store.updateFluency(finalSnapshot);
          // Set pending text for user to review and send
          store.updateAudio({
            pendingVoiceText: msg.text,
            hadVoiceInput: true,
            // Keep currentTranscription visible until InterviewPage consumes pendingVoiceText
          });
        }
        break;

      case 'agent_response':
        if (!store.streamingMessage) {
          store.startStreamingMessage(msg.agent, uuidv4());
        }
        store.updateStreamingMessage(msg.content, msg.isComplete);
        break;

      case 'tts_start':
        // Clear any leftover audio from previous turn, then suspend mic.
        // audio.suspend() also resets VAD state so stale isSpeaking=true
        // from before TTS doesn't block speechStart events after TTS ends.
        this.ttsPlayer.stop();
        this._ttsSuspendPromise = this.audio.suspend()
          .catch((err) => {
            console.error('[InterviewService] Failed to suspend mic for TTS:', err);
          })
          .finally(() => {
            this._ttsSuspendPromise = null;
          });
        store.updateAudio({ isTtsPlaying: true, isRecording: false, isSpeaking: false });
        // Arm watchdog: if onFinished never fires, force-restore mic
        this._armTtsTimeout();
        break;

      case 'tts_audio_chunk':
        this.ttsPlayer.addChunk(msg.audio);
        break;

      case 'tts_done':
        this.ttsPlayer.markDone();
        break;

      case 'state_sync':
        store.syncBlackboard({
          currentRound: store.round,
          currentMode: msg.blackboard.currentMode,
          nextAgent: msg.blackboard.nextAgent,
          projectDrillCount: msg.blackboard.projectDrillCount,
          generalTechCount: msg.blackboard.generalTechCount,
          projectsAsked: [],
          generalAreasCovered: [],
          totalQuestions: msg.blackboard.totalQuestions,
          // V1.1 fields
          pFollowupCount: (msg.blackboard as any).pFollowupCount ?? 0,
          consecutiveTCount: (msg.blackboard as any).consecutiveTCount ?? 0,
          elapsedMinutes: (msg.blackboard as any).elapsedMinutes ?? 0,
          timeLimitMinutes: (msg.blackboard as any).timeLimitMinutes ?? 60,
          codingTriggered: (msg.blackboard as any).codingTriggered ?? false,
          round: (msg.blackboard as any).round ?? store.round,
        });
        break;

      case 'interview_end':
        this.audio.suspend();
        if (this._skipNextReport) {
          // Zero questions: go straight back to PreparePage
          this._skipNextReport = false;
          store.reset();
        } else {
          // Parse and store the server report, then navigate to ReportPage
          try {
            const reportData = JSON.parse((msg as any).reportJson ?? '{}') as Record<string, unknown>;
            store.setReport(reportData);
          } catch (e) {
            console.error('[InterviewService] Failed to parse reportJson:', e);
          }
          store.setPhase('completed');
        }
        break;

      case 'code_challenge':
        store.setCodeEditor(true, {
          title: (msg as any).title || '编码题',
          description: (msg as any).description || '',
          language: (msg as any).language,
        });
        store.addMessage({
          id: uuidv4(),
          role: 'system',
          content: `进入编码环节：${(msg as any).title || '请在右侧代码编辑器中作答'}`,
          timestamp: Date.now(),
        });
        break;

      case 'qa_session':
        store.setQASession(true);
        store.addMessage({
          id: uuidv4(),
          role: 'system',
          content: (msg as any).message || '面试进入反问环节，你可以向面试官提问。',
          timestamp: Date.now(),
        });
        break;

      case 'error':
        console.error(`[Server Error] ${msg.code}: ${msg.message}`);
        break;

      case 'pong':
        // Heartbeat response — no action needed
        break;
    }
  }
}

// Singleton instance
let _interviewService: InterviewService | null = null;

export function getInterviewService(): InterviewService {
  if (!_interviewService) {
    _interviewService = new InterviewService();
  }
  return _interviewService;
}
