/* ═══════════════════════════════════════════════════════════
   Core type definitions for the AI Interview App
   ═══════════════════════════════════════════════════════════ */

// ── Interview State ─────────────────────────────────────────

export type InterviewPhase =
  | 'idle'        // 未开始
  | 'connecting'  // 正在连接云端
  | 'interviewing'// 面试进行中
  | 'paused'      // 暂停
  | 'completed';  // 已完成

export type InterviewRound = 1 | 2 | 3;

export type AgentRole = 'agent_a' | 'agent_b' | 'agent_c';
export type MessageRole = 'user' | AgentRole | 'system';

export interface AgentState {
  role: AgentRole;
  displayName: string;
  persona: string;         // 角色简述
  isActive: boolean;       // 当前是否正在说话/思考
  lastMessage?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  fluency?: FluencySnapshot;
  isStreaming?: boolean;    // 正在流式接收中
}

// ── Fluency Analysis ────────────────────────────────────────

export interface FluencySnapshot {
  overallScore: number;       // 0-100
  speechRate: number;         // 词/分钟
  speechRateScore: number;    // 0-100
  pauseCount: number;         // confirmed 停顿次数 (词级+VAD)
  longPauseCount: number;     // long 停顿次数 (思路中断)
  fillerPauseCount: number;   // 填充词独占段次数
  pauseScore: number;         // 0-100
  fillerCount: number;
  fillerBreakdown: Record<string, number>;
  fillerScore: number;        // 0-100
  timestamp: number;
}

export interface RealtimeAudioMetrics {
  isRecording: boolean;
  currentVolume: number;       // 0-1 normalized
  isSpeaking: boolean;
  currentTranscription: string;
  wordGapAlert: boolean;       // 正在长停顿中
  pendingVoiceText: string;    // ASR final text waiting for user confirmation
  hadVoiceInput: boolean;      // true if current pending text came from voice
  isAnswerLocked: boolean;     // true after '回答结束' pressed — mic suspended, awaiting send
  isTtsPlaying: boolean;       // true while AI interviewer TTS audio is playing
}

// ── Resume ──────────────────────────────────────────────────

export interface CandidateProfile {
  name: string;
  yearsExp: string;
  education: string;
  currentRole: string;
  skillTags: string[];
}

export interface ProjectInfo {
  index: number;
  name: string;
  role: string;
  duration: string;
  techStack: string[];
  keyMetrics: Record<string, string>;
  businessContext: string;
  technicalHighlights: string[];
  suspiciousPoints: string[];
  drillSuggestions: string[];
}

export interface StructuredResume {
  candidateProfile: CandidateProfile;
  projects: ProjectInfo[];
  careerTrajectory: string;
  redFlags: string[];
  interviewFocus: string[];
  interviewCheatSheet: string;
}

// ── Interview Config ────────────────────────────────────────

export interface InterviewConfig {
  interviewId: string;
  company: string;
  businessUnit: string;
  team: string;
  positionType: string;
  round: InterviewRound;
  resume: StructuredResume;
  persona?: PersonaConfig;
}

export interface PersonaConfig {
  systemPromptFragment: string;
  suggestedDrillAreas: string[];
  companyValues: string[];
}

// ── Code Editor ───────────────────────────────────────────

export interface CodeChallenge {
  title: string;
  description: string;
  language?: string;
}

// ── Blackboard (cloud state, synced to client read-only) ────

export interface BlackboardSnapshot {
  currentRound: number;
  currentMode: 'project' | 'general' | 'coding' | 'qa_session';
  nextAgent: 'agent_b' | 'agent_c';
  projectDrillCount: number;
  generalTechCount: number;
  projectsAsked: number[];
  generalAreasCovered: string[];
  totalQuestions: number;
  // V1.1 fields
  pFollowupCount: number;
  consecutiveTCount: number;
  elapsedMinutes: number;
  timeLimitMinutes: number;
  codingTriggered: boolean;
  round: number;
}

// V1.1 §6 — Multi-round transfer data
export interface RoundTransferData {
  asked_projects: Array<{ project_index: number; project_name: string; max_followup_depth: number }>;
  asked_t_topics: string[];
  density_score: 'sufficient' | 'insufficient' | 'veto';
  coding_result: { had_coding: boolean; quality: string | null; overtime: boolean; duration_min: number } | null;
  total_questions: number;
  round: number;
}
