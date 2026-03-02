/// <reference types="vite/client" />
/**
 * ResearchService — Client-side wrapper for company intelligence pre-research API.
 *
 * Usage:
 *   const svc = new ResearchService();
 *   await svc.startResearch({ interviewId, company, ... });
 *   const status = await svc.pollUntilDone(interviewId, onProgress);
 */

const SERVER_URL = import.meta.env.VITE_API_BASE_URL as string;

export type ResearchStatus =
  | 'pending'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'completed'
  | 'failed'
  | 'not_started';

export const RESEARCH_PHASE_LABELS: Record<ResearchStatus, string> = {
  not_started: '未开始',
  pending:     '初始化中...',
  phase1:      '正在搜集版本情报...',
  phase2:      '正在分析技术战略...',
  phase3:      '正在预测面试问题...',
  completed:   '预调研完成 ✓',
  failed:      '调研失败',
};

export const RESEARCH_PHASE_PROGRESS: Record<ResearchStatus, number> = {
  not_started: 0,
  pending:     5,
  phase1:      25,
  phase2:      55,
  phase3:      80,
  completed:   100,
  failed:      0,
};

export interface ResearchStartParams {
  interviewId: string;
  company: string;
  businessUnit: string;
  positionType: string;
  candidateTechStack?: string[];
}

export interface ResearchStatusResponse {
  interview_id: string;
  status: ResearchStatus;
  error?: string;
  summary_preview?: string;
}

export class ResearchService {
  /** Start a new research task. Returns immediately. */
  async startResearch(params: ResearchStartParams): Promise<void> {
    const resp = await fetch(`${SERVER_URL}/api/research/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interview_id: params.interviewId,
        company: params.company,
        business_unit: params.businessUnit,
        position_type: params.positionType,
        candidate_tech_stack: params.candidateTechStack ?? [],
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Research start failed: ${resp.status} ${err}`);
    }
  }

  /** Poll current status once. */
  async getStatus(interviewId: string): Promise<ResearchStatusResponse> {
    const resp = await fetch(`${SERVER_URL}/api/research/${interviewId}/status`);
    if (!resp.ok) {
      throw new Error(`Status poll failed: ${resp.status}`);
    }
    return resp.json() as Promise<ResearchStatusResponse>;
  }

  /**
   * Poll until completed or failed. Calls onProgress on every tick.
   * Resolves with the final status response.
   */
  async pollUntilDone(
    interviewId: string,
    onProgress: (status: ResearchStatusResponse) => void,
    intervalMs = 2000,
    timeoutMs = 600_000,
  ): Promise<ResearchStatusResponse> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = async () => {
        if (Date.now() - start > timeoutMs) {
          // Before giving up, do one final check — the backend may have just finished
          try {
            const finalStatus = await this.getStatus(interviewId);
            onProgress(finalStatus);
            if (finalStatus.status === 'completed' || finalStatus.status === 'failed') {
              resolve(finalStatus);
              return;
            }
          } catch (_) {
            // ignore, fall through to timeout rejection
          }
          const minutes = Math.round(timeoutMs / 60_000);
          reject(new Error(`Research polling timed out after ${minutes} minutes`));
          return;
        }
        try {
          const status = await this.getStatus(interviewId);
          onProgress(status);
          if (status.status === 'completed' || status.status === 'failed') {
            resolve(status);
          } else {
            setTimeout(tick, intervalMs);
          }
        } catch (err) {
          reject(err);
        }
      };
      setTimeout(tick, intervalMs);
    });
  }
}

let _instance: ResearchService | null = null;
export const getResearchService = (): ResearchService => {
  if (!_instance) _instance = new ResearchService();
  return _instance;
};
