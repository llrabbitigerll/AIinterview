import React, { useState } from 'react';
import { useStore } from '../store';
import type { LlmCallRecord } from '../types';

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh', { hour12: false });
}

function roleColor(role: string): string {
  if (role === 'system') return 'system';
  if (role === 'user') return 'user';
  return 'assistant';
}

function LlmRecord({ call }: { call: LlmCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  const statusColor = call.success === null ? '#808080' : call.success ? '#4ec9b0' : '#f44747';
  const statusText = call.success === null ? '⏳ 进行中' : call.success ? '✅ 成功' : '❌ 失败';

  return (
    <div className="llm-record">
      <div className="llm-record-header" onClick={() => setExpanded(!expanded)}>
        <span style={{ color: '#808080', minWidth: 80 }}>{fmt(call.started_at)}</span>
        <span style={{ color: '#9cdcfe', minWidth: 50 }}>{call.call_type}</span>
        <span className="llm-model">{call.model ?? '(default)'}</span>
        {call.elapsed_ms !== null && (
          <span className="llm-elapsed">{call.elapsed_ms}ms</span>
        )}
        {call.response_full !== null && (
          <span className="llm-chars">{call.response_full.length} chars</span>
        )}
        {call.token_count !== null && (
          <span style={{ color: '#b5cea8' }}>{call.token_count} tokens</span>
        )}
        <span style={{ color: statusColor }}>{statusText}</span>
        <span style={{ color: '#808080', marginLeft: 'auto' }}>{call.session_id.slice(0, 8)}</span>
        <span style={{ color: '#555', marginLeft: 8 }}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {/* Metadata */}
          <div style={{ color: '#808080', fontSize: 10, marginBottom: 6 }}>
            temp={call.temperature} max_tokens={call.max_tokens} msgs={call.messages?.length ?? 0}
          </div>

          {/* Messages toggle */}
          <div
            style={{ color: '#569cd6', cursor: 'pointer', marginBottom: 4 }}
            onClick={() => setShowMessages(!showMessages)}
          >
            {showMessages ? '▼' : '▶'} 查看 Prompt Messages ({call.messages?.length ?? 0})
          </div>
          {showMessages && (
            <div className="llm-messages">
              {(call.messages ?? []).map((msg, i) => (
                <div key={i} className="llm-msg">
                  <span className={`llm-msg-role ${roleColor(msg.role)}`}>{msg.role}</span>
                  <div className="llm-msg-content">{msg.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* Response toggle */}
          {call.response_full && (
            <>
              <div
                style={{ color: '#4ec9b0', cursor: 'pointer', marginTop: 6, marginBottom: 4 }}
                onClick={() => setShowResponse(!showResponse)}
              >
                {showResponse ? '▼' : '▶'} 查看完整响应 ({call.response_full.length} chars)
              </div>
              {showResponse && (
                <div className="llm-response">
                  <div className="llm-response-text">{call.response_full}</div>
                </div>
              )}
            </>
          )}

          {/* Error */}
          {call.error && (
            <div style={{ color: '#f44747', marginTop: 6, background: '#1a0000', padding: 6, borderRadius: 2 }}>
              错误: {call.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LLMPanel() {
  const llmCalls = useStore((s) => s.llmCalls);
  const inProgress = useStore((s) => Object.values(s._llmCallsInProgress));
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'complete' | 'stream'>('all');

  const allCalls = [...inProgress.map((r) => ({ ...r, success: null })), ...llmCalls].reverse();

  const filtered = allCalls.filter((c) => {
    if (typeFilter !== 'all' && c.call_type !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (
        !(c.model ?? '').toLowerCase().includes(s) &&
        !JSON.stringify(c.messages ?? []).toLowerCase().includes(s) &&
        !(c.response_full ?? '').toLowerCase().includes(s)
      ) return false;
    }
    return true;
  });

  return (
    <>
      <div className="search-bar">
        <input
          placeholder="搜索模型/prompt/响应内容..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="filter-bar">
        {(['all', 'complete', 'stream'] as const).map((t) => (
          <span key={t} className={`filter-chip ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>
            {t === 'all' ? '全部' : t}
          </span>
        ))}
        <span style={{ color: '#808080', fontSize: 10, marginLeft: 4 }}>
          共 {llmCalls.length} 次调用
          {inProgress.length > 0 && ` | ${inProgress.length} 进行中`}
        </span>
      </div>
      <div className="panel-scroll">
        {filtered.length === 0 && <div className="empty-state">暂无 LLM 调用记录</div>}
        {filtered.map((call, i) => (
          <LlmRecord key={`${call.call_id}-${i}`} call={call as LlmCallRecord} />
        ))}
      </div>
    </>
  );
}
