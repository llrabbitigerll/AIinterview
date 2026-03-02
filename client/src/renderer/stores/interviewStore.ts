import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  InterviewPhase,
  InterviewRound,
  AgentState,
  ChatMessage,
  FluencySnapshot,
  RealtimeAudioMetrics,
  BlackboardSnapshot,
  InterviewConfig,
  StructuredResume,
  CodeChallenge,
} from '../types';

// ── Store Shape ─────────────────────────────────────────────

interface InterviewStore {
  // ── App-level navigation ───
  appView: 'main' | 'settings';
  setAppView: (view: 'main' | 'settings') => void;

  // ── Interview lifecycle ───
  phase: InterviewPhase;
  interviewId: string | null;
  round: InterviewRound;
  config: InterviewConfig | null;

  // ── Agents ───
  agents: {
    agentB: AgentState;
    agentC: AgentState;
  };

  // ── Chat ───
  messages: ChatMessage[];
  streamingMessage: ChatMessage | null; // currently streaming agent response

  // ── Audio & Fluency ───
  audio: RealtimeAudioMetrics;
  latestFluency: FluencySnapshot | null;

  // ── Blackboard (synced from cloud, read-only) ───
  blackboard: BlackboardSnapshot | null;

  // ── Resume ───
  resume: StructuredResume | null;

  // ── Code Editor ───
  codeEditorActive: boolean;
  codeChallenge: CodeChallenge | null;

  // ── Session meta ───
  isDoubleAgentMode: boolean;
  isQASession: boolean;

  // ── Report (from server after interview ends) ───
  report: Record<string, unknown> | null;

  // ── Actions ───
  setPhase: (phase: InterviewPhase) => void;
  initInterview: (config: InterviewConfig) => void;
  addMessage: (msg: ChatMessage) => void;
  updateStreamingMessage: (content: string, isComplete: boolean) => void;
  startStreamingMessage: (role: ChatMessage['role'], id: string) => void;
  updateAudio: (partial: Partial<RealtimeAudioMetrics>) => void;
  updateFluency: (snapshot: FluencySnapshot) => void;
  syncBlackboard: (bb: BlackboardSnapshot) => void;
  setResume: (resume: StructuredResume) => void;
  setAgents: (agentB: Partial<AgentState>, agentC: Partial<AgentState>) => void;
  setCodeEditor: (active: boolean, challenge?: CodeChallenge | null) => void;
  setDoubleAgentMode: (isDouble: boolean) => void;
  setQASession: (isQA: boolean) => void;
  setReport: (report: Record<string, unknown>) => void;
  reset: () => void;
}

// ── Initial state ───────────────────────────────────────────

const initialAudio: RealtimeAudioMetrics = {
  isRecording: false,
  currentVolume: 0,
  isSpeaking: false,
  currentTranscription: '',
  wordGapAlert: false,
  pendingVoiceText: '',
  hadVoiceInput: false,
  isAnswerLocked: false,
  isTtsPlaying: false,
};

const makeAgent = (role: 'agent_b' | 'agent_c', name: string): AgentState => ({
  role: `agent_${role.slice(-1)}` as AgentState['role'],
  displayName: name,
  persona: '',
  isActive: false,
});

// ── Store ───────────────────────────────────────────────────

export const useInterviewStore = create<InterviewStore>()(
  immer((set) => ({
    appView: 'main' as const,
    phase: 'idle',
    interviewId: null,
    round: 1 as InterviewRound,
    config: null,
    agents: {
      agentB: makeAgent('agent_b', '技术面试官'),
      agentC: makeAgent('agent_c', '业务面试官'),
    },
    messages: [],
    streamingMessage: null,
    audio: { ...initialAudio },
    latestFluency: null,
    blackboard: null,
    resume: null,
    codeEditorActive: false,
    codeChallenge: null,
    isDoubleAgentMode: false,
    isQASession: false,
    report: null,

    setAppView: (view) =>
      set((s) => {
        s.appView = view;
      }),

    setPhase: (phase) =>
      set((s) => {
        s.phase = phase;
      }),

    initInterview: (config) =>
      set((s) => {
        s.interviewId = config.interviewId;
        s.round = config.round;
        s.config = config;
        s.phase = 'connecting';
        s.messages = [];
        s.streamingMessage = null;
        s.latestFluency = null;
        s.blackboard = null;
      }),

    addMessage: (msg) =>
      set((s) => {
        s.messages.push(msg);
      }),

    startStreamingMessage: (role, id) =>
      set((s) => {
        s.streamingMessage = {
          id,
          role,
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        };
        // Mark the corresponding agent as active
        if (role === 'agent_b') s.agents.agentB.isActive = true;
        if (role === 'agent_c') s.agents.agentC.isActive = true;
      }),

    updateStreamingMessage: (content, isComplete) =>
      set((s) => {
        if (!s.streamingMessage) return;
        s.streamingMessage.content += content;
        if (isComplete) {
          s.streamingMessage.isStreaming = false;
          // Move to messages array
          s.messages.push({ ...s.streamingMessage });
          const role = s.streamingMessage.role;
          s.streamingMessage = null;
          // Deactivate agent
          if (role === 'agent_b') s.agents.agentB.isActive = false;
          if (role === 'agent_c') s.agents.agentC.isActive = false;
        }
      }),

    updateAudio: (partial) =>
      set((s) => {
        Object.assign(s.audio, partial);
      }),

    updateFluency: (snapshot) =>
      set((s) => {
        s.latestFluency = snapshot;
      }),

    syncBlackboard: (bb) =>
      set((s) => {
        s.blackboard = bb;
      }),

    setResume: (resume) =>
      set((s) => {
        s.resume = resume;
      }),

    setAgents: (agentB, agentC) =>
      set((s) => {
        Object.assign(s.agents.agentB, agentB);
        Object.assign(s.agents.agentC, agentC);
      }),

    setCodeEditor: (active, challenge) =>
      set((s) => {
        s.codeEditorActive = active;
        if (challenge !== undefined) s.codeChallenge = challenge;
      }),

    setDoubleAgentMode: (isDouble) =>
      set((s) => {
        s.isDoubleAgentMode = isDouble;
      }),

    setQASession: (isQA) =>
      set((s) => {
        s.isQASession = isQA;
      }),

    setReport: (report) =>
      set((s) => {
        s.report = report;
      }),

    reset: () =>
      set((s) => {
        s.phase = 'idle';
        s.interviewId = null;
        s.round = 1;
        s.config = null;
        s.messages = [];
        s.streamingMessage = null;
        s.audio = { ...initialAudio };
        s.latestFluency = null;
        s.blackboard = null;
        s.codeEditorActive = false;
        s.codeChallenge = null;
        s.isDoubleAgentMode = false;
        s.isQASession = false;
        s.report = null;
      }),
  }))
);
