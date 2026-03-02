// ── Event Types from DevTools Event Bus ──────────────────────

export interface DevToolsEvent {
  type: string;
  timestamp: number;
  session_id: string;
  payload: Record<string, unknown>;
}

// WebSocket traffic
export interface WsEvent extends DevToolsEvent {
  type: 'ws_c2s' | 'ws_s2c' | 'ws_binary' | 'ws_connected' | 'ws_disconnected';
}

// LLM calls
export interface LlmCallStartPayload {
  call_id: string;
  call_type: 'complete' | 'stream';
  model: string | null;
  temperature: number;
  max_tokens: number;
  enable_search?: boolean;
  messages: Array<{ role: string; content: string }>;
  messages_count: number;
  system_chars: number;
}

export interface LlmCallEndPayload {
  call_id: string;
  call_type: 'complete' | 'stream';
  model: string | null;
  elapsed_ms: number;
  response_chars?: number;
  response_preview?: string;
  response_full?: string;
  token_count?: number;
  success: boolean;
  error?: string;
}

export interface LlmStreamTokenPayload {
  call_id: string;
  token: string;
}

// Agent decision
export interface AgentDecisionPayload {
  action: string;
  next_agent: string | null;
  next_mode: string | null;
  question_type: string;
  target_project: number | null;
  tech_area: string | null;
  reasoning: string;
  is_followup: boolean;
  followup_depth: number;
  intervention_message: string | null;
  bb_total_questions: number;
  bb_current_mode: string;
  bb_p_followup_count: number;
  bb_consecutive_t_count: number;
  bb_elapsed_minutes: number;
}

// Blackboard
export interface BlackboardSnapshotPayload {
  current_mode: string;
  next_agent: string | null;
  project_drill_count: number;
  general_tech_count: number;
  total_questions: number;
  p_followup_count: number;
  consecutive_t_count: number;
  elapsed_minutes: number;
  time_limit_minutes: number;
  coding_triggered: boolean;
  round: number;
  is_double_agent_mode: boolean;
  interviewer_level: string;
  messages_count: number;
  evaluations_count: number;
}

// Evaluation
export interface EvalResultPayload {
  round_num: number;
  question_id: string;
  question_index: number;
  question_type: string;
  question_text: string;
  answer_text: string;
  quality_score_5: number;
  quality_score_10_raw: number;
  rubric_scores: Record<string, number>;
  key_defects: string[];
  follow_up_hints: string[];
  live_judgment: string;
  fluency_tag: string;
  duration_seconds: number;
  thinking_time_to_first_word_seconds: number;
}

// Research
export interface ResearchPhasePayload {
  phase: number;
  interview_id: string;
  elapsed_ms?: number;
  success?: boolean;
  result?: unknown;
  error?: string;
}

// Log
export interface LogRecordPayload {
  level: string;
  logger: string;
  message: string;
  module: string;
  funcName: string;
  lineno: number;
}

// Session
export interface SessionStartPayload {
  interview_id: string;
  company: string;
  business_unit: string;
  round: number;
  target_level: string;
  position_type: string;
  has_research: boolean;
}

// Merged LLM call record (start + end)
export interface LlmCallRecord {
  call_id: string;
  call_type: 'complete' | 'stream';
  model: string | null;
  temperature: number;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
  started_at: number;
  ended_at: number | null;
  elapsed_ms: number | null;
  response_full: string | null;
  response_preview: string | null;
  token_count: number | null;
  success: boolean | null;
  error: string | null;
  session_id: string;
}
