import React, { useState } from 'react';
import { useStore } from '../store';
import type { AgentDecisionPayload } from '../types';

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh', { hour12: false });
}

const MODE_COLORS: Record<string, string> = {
  project: '#4ec9b0',
  general: '#9cdcfe',
  coding: '#f44747',
  qa_session: '#b5cea8',
};

const ACTION_COLORS: Record<string, string> = {
  pass: '#4ec9b0',
  intervene: '#f44747',
};

const QTYPE_COLORS: Record<string, string> = {
  project_drill: '#4ec9b0',
  project_followup: '#dcdcaa',
  new_project: '#569cd6',
  general_tech: '#9cdcfe',
  coding: '#f44747',
};

function DecisionRow({ item }: { item: { timestamp: number; session_id: string; payload: AgentDecisionPayload } }) {
  const [expanded, setExpanded] = useState(false);
  const p = item.payload;

  return (
    <div className="llm-record">
      <div className="llm-record-header" onClick={() => setExpanded(!expanded)}>
        <span style={{ color: '#808080', minWidth: 80 }}>{fmt(item.timestamp)}</span>
        <span style={{ color: ACTION_COLORS[p.action] ?? '#d4d4d4', minWidth: 70, fontWeight: 'bold' }}>
          {p.action.toUpperCase()}
        </span>
        <span style={{ color: MODE_COLORS[p.next_mode ?? ''] ?? '#d4d4d4', minWidth: 70 }}>
          {p.next_mode}
        </span>
        <span style={{ color: QTYPE_COLORS[p.question_type] ?? '#d4d4d4', minWidth: 120 }}>
          {p.question_type}
        </span>
        <span style={{ color: '#9cdcfe', minWidth: 60 }}>{p.next_agent}</span>
        <span style={{ color: '#808080', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.reasoning}
        </span>
        <span style={{ color: '#555' }}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 8 }}>
          {/* Reasoning */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: '#808080' }}>推理: </span>
            <span style={{ color: '#ce9178' }}>{p.reasoning}</span>
          </div>

          {/* Blackboard at decision time */}
          <div style={{ background: '#1e1e1e', padding: 6, borderRadius: 2, fontSize: 11 }}>
            <div style={{ color: '#808080', marginBottom: 4 }}>决策时 Blackboard 状态</div>
            <div className="bb-grid">
              {[
                ['总题数', p.bb_total_questions],
                ['当前模式', p.bb_current_mode],
                ['P追问深度', p.bb_p_followup_count],
                ['连续T计数', p.bb_consecutive_t_count],
                ['已用时', `${p.bb_elapsed_minutes}min`],
                ['followup?', p.is_followup ? '是' : '否'],
                ['followup深度', p.followup_depth],
                ['目标项目', p.target_project ?? '-'],
              ].map(([k, v]) => (
                <div key={String(k)} className="bb-field">
                  <div className="bb-field-key">{k}</div>
                  <div className="bb-field-val">{String(v)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Intervention message */}
          {p.intervention_message && (
            <div style={{ marginTop: 8, background: '#2b1a00', padding: 6, borderRadius: 2 }}>
              <span style={{ color: '#dcdcaa' }}>干预消息: </span>
              <span style={{ color: '#ce9178' }}>{p.intervention_message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentPanel() {
  const decisions = useStore((s) => s.agentDecisions);
  const [search, setSearch] = useState('');

  const filtered = [...decisions]
    .reverse()
    .filter((d) => {
      if (!search) return true;
      return JSON.stringify(d).toLowerCase().includes(search.toLowerCase());
    });

  return (
    <>
      <div className="search-bar">
        <input
          placeholder="搜索决策 (action/mode/reasoning...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div style={{ padding: '4px 8px', background: '#252526', borderBottom: '1px solid #333', fontSize: 10, color: '#808080' }}>
        共 {decisions.length} 次 Agent A 决策
        &nbsp;|&nbsp;
        {decisions.filter((d) => d.payload.action === 'intervene').length} 次干预
        &nbsp;|&nbsp;
        {decisions.filter((d) => d.payload.question_type === 'coding').length} 次编码题
      </div>
      <div className="panel-scroll">
        {filtered.length === 0 && <div className="empty-state">暂无 Agent A 决策记录</div>}
        {filtered.map((item, i) => (
          <DecisionRow key={`${item.timestamp}-${i}`} item={item} />
        ))}
      </div>
    </>
  );
}
