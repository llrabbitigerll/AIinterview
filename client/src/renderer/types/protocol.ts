/* ═══════════════════════════════════════════════════════════
   WebSocket Message Protocol
   Client ↔ Server communication contract
   
   All messages are JSON text frames except audio data
   which is sent as binary frames (raw PCM Int16 LE).
   Each JSON message has a `type` field for routing.
   ═══════════════════════════════════════════════════════════ */

// ── Client → Server ─────────────────────────────────────────

/** Start a new interview session */
export interface C2S_InitInterview {
  type: 'init_interview';
  interviewId: string;
  config: {
    company: string;
    businessUnit: string;
    team: string;
    positionType: string;
    round: 1 | 2 | 3;
    resumeJson: string;  // stringified StructuredResume
    targetLevel?: string; // V1.1: T1~T6
    previousRoundData?: string; // V1.1 §6: stringified RoundTransferData from previous round
  };
  seq: number;
}

/** Tell server that user finished speaking (VAD end-of-speech) */
export interface C2S_SpeechEnd {
  type: 'speech_end';
  interviewId: string;
  seq: number;
}

/** User sends text input (fallback for no-mic mode) */
export interface C2S_TextInput {
  type: 'text_input';
  interviewId: string;
  text: string;
  fluencyPayload?: {
    snapshot: {
      overallScore: number;
      speechRate: number;
      speechRateScore: number;
      pauseCount: number;
      longPauseCount: number;
      fillerPauseCount: number;
      pauseScore: number;
      fillerCount: number;
      fillerBreakdown: Record<string, number>;
      fillerScore: number;
      timestamp: number;
    };
    details?: {
      speechRateHistory?: number[];
      vadPauses?: Array<{ durationMs: number; category: 'normal' | 'confirmed' | 'long' }>;
      wordGaps?: {
        normalMs?: number[];
        confirmedMs?: number[];
        longMs?: number[];
      };
      fillerSegments?: number;
    };
    thinking?: {
      toFirstWordSeconds?: number;
      silenceSeconds?: number;
    };
  };
  seq: number;
}

/** User submits code from code editor panel */
export interface C2S_CodeSubmit {
  type: 'code_submit';
  interviewId: string;
  code: string;
  language: string;
  seq: number;
}

/** Request to pause/resume */
export interface C2S_Control {
  type: 'control';
  interviewId: string;
  action: 'pause' | 'resume' | 'end';
  seq: number;
}

/** Heartbeat ping */
export interface C2S_Ping {
  type: 'ping';
  timestamp: number;
}

/**
 * Client notifies server that TTS audio playback has finished and the mic is
 * active again. On receipt the server re-checks (or re-creates) the ASR
 * connection so the user's next speech is properly transcribed.
 */
export interface C2S_TtsPlaybackDone {
  type: 'tts_playback_done';
  seq: number;
}

export type ClientMessage =
  | C2S_InitInterview
  | C2S_SpeechEnd
  | C2S_TextInput
  | C2S_CodeSubmit
  | C2S_Control
  | C2S_Ping
  | C2S_TtsPlaybackDone;

// ── Server → Client ─────────────────────────────────────────

/** Interview session initialized successfully */
export interface S2C_InterviewReady {
  type: 'interview_ready';
  interviewId: string;
  agents: {
    agentB: { displayName: string; persona: string };
    agentC?: { displayName: string; persona: string };
  };
  isDoubleAgentMode: boolean;
  interviewerLevel: string;
  firstQuestion: string;
  firstAgent: 'agent_b' | 'agent_c';
  seq: number;
}

/** Real-time ASR transcription result */
export interface S2C_Transcription {
  type: 'transcription';
  text: string;
  words: Array<{ word: string; startMs: number; endMs: number }>;
  isFinal: boolean;
  seq: number;
}

/** Agent response (streamed token by token) */
export interface S2C_AgentResponse {
  type: 'agent_response';
  agent: 'agent_a' | 'agent_b' | 'agent_c';
  content: string;       // incremental token(s)
  isComplete: boolean;   // true = last chunk
  seq: number;
}

/** Blackboard state sync (periodic snapshot) */
export interface S2C_StateSync {
  type: 'state_sync';
  blackboard: {
    currentMode: 'project' | 'general' | 'coding' | 'qa_session';
    nextAgent: 'agent_b' | 'agent_c';
    projectDrillCount: number;
    generalTechCount: number;
    totalQuestions: number;
    // V1.1 fields
    pFollowupCount: number;
    consecutiveTCount: number;
    elapsedMinutes: number;
    timeLimitMinutes: number;
    codingTriggered: boolean;
    round: number;
  };
  seq: number;
}

/** Code challenge: server instructs client to show code editor */
export interface S2C_CodeChallenge {
  type: 'code_challenge';
  title: string;
  description: string;
  language?: string;
  seq: number;
}

/** Q&A session started */
export interface S2C_QASession {
  type: 'qa_session';
  message: string;
  seq: number;
}

/** Interview ended */
export interface S2C_InterviewEnd {
  type: 'interview_end';
  reportJson: string;  // stringified report
  seq: number;
}

/** Error */
export interface S2C_Error {
  type: 'error';
  code: string;
  message: string;
  seq: number;
}

/** Heartbeat pong */
export interface S2C_Pong {
  type: 'pong';
  timestamp: number;
}

/** ASR availability status (sent after async ASR init completes) */
export interface S2C_ASRStatus {
  type: 'asr_status';
  available: boolean;
  warning?: string;
  seq: number;
}

/** TTS playback: server starts streaming audio for an agent response */
export interface S2C_TtsStart {
  type: 'tts_start';
  agent: 'agent_b' | 'agent_c';
  seq: number;
}

/** TTS playback: one audio chunk (base64-encoded WAV bytes for a sentence) */
export interface S2C_TtsAudioChunk {
  type: 'tts_audio_chunk';
  audio: string;  // base64-encoded WAV
  seq: number;
}

/** TTS playback: all chunks sent, client may finalize playback queue */
export interface S2C_TtsDone {
  type: 'tts_done';
  seq: number;
}

export type ServerMessage =
  | S2C_InterviewReady
  | S2C_Transcription
  | S2C_AgentResponse
  | S2C_StateSync
  | S2C_CodeChallenge
  | S2C_QASession
  | S2C_InterviewEnd
  | S2C_Error
  | S2C_Pong
  | S2C_ASRStatus
  | S2C_TtsStart
  | S2C_TtsAudioChunk
  | S2C_TtsDone;
