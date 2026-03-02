import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  DevToolsEvent,
  LlmCallRecord,
  AgentDecisionPayload,
  BlackboardSnapshotPayload,
  EvalResultPayload,
  ResearchPhasePayload,
  LogRecordPayload,
  SessionStartPayload,
  LlmCallStartPayload,
  LlmCallEndPayload,
} from './types';

const MAX_ITEMS = 1000;

export interface DevToolsState {
  connected: boolean;
  connectionError: string | null;

  events: DevToolsEvent[];
  wsMessages: DevToolsEvent[];

  llmCalls: LlmCallRecord[];
  _llmCallsInProgress: Record<string, LlmCallRecord>;

  agentDecisions: Array<{ timestamp: number; session_id: string; payload: AgentDecisionPayload }>;
  blackboardSnapshots: Array<{ timestamp: number; session_id: string; payload: BlackboardSnapshotPayload }>;
  evalResults: Array<{ timestamp: number; session_id: string; payload: EvalResultPayload }>;
  researchEvents: Array<{ timestamp: number; session_id: string; event_type: string; payload: ResearchPhasePayload }>;
  logRecords: Array<{ timestamp: number; payload: LogRecordPayload }>;
  sessions: Array<{ timestamp: number; payload: SessionStartPayload }>;

  activeTab: string;

  handleEvent: (event: DevToolsEvent) => void;
  replayEvents: (events: DevToolsEvent[]) => void;
  setConnected: (connected: boolean) => void;
  clearAll: () => void;
  setActiveTab: (tab: string) => void;
}

function trimArray<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

function applyEvent(state: DevToolsState, event: DevToolsEvent): void {
  const { type, timestamp, session_id, payload } = event;

  if (type !== 'ws_binary' && type !== 'llm_stream_token') {
    state.events = trimArray([...state.events, event], MAX_ITEMS);
  }

  switch (type) {
    case 'devtools_connected':
      state.connected = true;
      break;

    case 'devtools_disconnected':
      state.connected = false;
      break;

    case 'ws_c2s':
    case 'ws_s2c': {
      state.wsMessages = trimArray([...state.wsMessages, event], MAX_ITEMS);
      break;
    }

    case 'llm_call_start':
    case 'llm_stream_start': {
      const p = payload as unknown as LlmCallStartPayload;
      const record: LlmCallRecord = {
        call_id: p.call_id,
        call_type: p.call_type ?? (type === 'llm_stream_start' ? 'stream' : 'complete'),
        model: p.model,
        temperature: p.temperature,
        max_tokens: p.max_tokens,
        messages: p.messages,
        started_at: timestamp,
        ended_at: null,
        elapsed_ms: null,
        response_full: null,
        response_preview: null,
        token_count: null,
        success: null,
        error: null,
        session_id,
      };
      state._llmCallsInProgress[p.call_id] = record;
      break;
    }

    case 'llm_call_end':
    case 'llm_stream_end': {
      const p = payload as unknown as LlmCallEndPayload;
      const inProgress = state._llmCallsInProgress[p.call_id];
      if (inProgress) {
        inProgress.ended_at = timestamp;
        inProgress.elapsed_ms = p.elapsed_ms;
        inProgress.response_full = p.response_full ?? null;
        inProgress.response_preview = p.response_preview ?? null;
        inProgress.token_count = p.token_count ?? null;
        inProgress.success = p.success;
        inProgress.error = p.error ?? null;
        state.llmCalls = trimArray([...state.llmCalls, { ...inProgress }], MAX_ITEMS);
        delete state._llmCallsInProgress[p.call_id];
      }
      break;
    }

    case 'agent_decision': {
      state.agentDecisions = trimArray(
        [...state.agentDecisions, { timestamp, session_id, payload: payload as unknown as AgentDecisionPayload }],
        MAX_ITEMS
      );
      break;
    }

    case 'blackboard_snapshot': {
      state.blackboardSnapshots = trimArray(
        [...state.blackboardSnapshots, { timestamp, session_id, payload: payload as unknown as BlackboardSnapshotPayload }],
        MAX_ITEMS
      );
      break;
    }

    case 'eval_result': {
      state.evalResults = trimArray(
        [...state.evalResults, { timestamp, session_id, payload: payload as unknown as EvalResultPayload }],
        MAX_ITEMS
      );
      break;
    }

    case 'research_phase_start':
    case 'research_phase_end': {
      state.researchEvents = trimArray(
        [...state.researchEvents, { timestamp, session_id, event_type: type, payload: payload as unknown as ResearchPhasePayload }],
        500
      );
      break;
    }

    case 'log_record': {
      state.logRecords = trimArray(
        [...state.logRecords, { timestamp, payload: payload as unknown as LogRecordPayload }],
        MAX_ITEMS
      );
      break;
    }

    case 'session_start': {
      state.sessions = trimArray(
        [...state.sessions, { timestamp, payload: payload as unknown as SessionStartPayload }],
        MAX_ITEMS
      );
      break;
    }
  }
}

export const useStore = create<DevToolsState>()(
  immer((set) => ({
    connected: false,
    connectionError: null,
    events: [],
    wsMessages: [],
    llmCalls: [],
    _llmCallsInProgress: {},
    agentDecisions: [],
    blackboardSnapshots: [],
    evalResults: [],
    researchEvents: [],
    logRecords: [],
    sessions: [],
    activeTab: 'timeline',

    setConnected: (connected) =>
      set((state) => {
        state.connected = connected;
      }),

    setActiveTab: (tab) =>
      set((state) => {
        state.activeTab = tab;
      }),

    clearAll: () =>
      set((state) => {
        state.events = [];
        state.wsMessages = [];
        state.llmCalls = [];
        state._llmCallsInProgress = {};
        state.agentDecisions = [];
        state.blackboardSnapshots = [];
        state.evalResults = [];
        state.researchEvents = [];
        state.logRecords = [];
        state.sessions = [];
      }),

    handleEvent: (event: DevToolsEvent) =>
      set((state) => {
        applyEvent(state, event);
      }),

    replayEvents: (events: DevToolsEvent[]) =>
      set((state) => {
        state.events = [];
        state.wsMessages = [];
        state.llmCalls = [];
        state._llmCallsInProgress = {};
        state.agentDecisions = [];
        state.blackboardSnapshots = [];
        state.evalResults = [];
        state.researchEvents = [];
        state.logRecords = [];
        state.sessions = [];

        for (const event of events) {
          applyEvent(state, event);
        }
      }),
  }))
);
