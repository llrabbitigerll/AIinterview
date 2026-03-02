import React, { useState } from 'react';
import { useStore } from '../store';
import type { BlackboardSnapshotPayload } from '../types';

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh', { hour12: false });
}

const MODE_COLORS: Record<string, string> = {
  project: '#4ec9b0',
  general: '#9cdcfe',
  coding: '#f44747',
  qa_session: '#b5cea8',
};

function diffSummary(prev: BlackboardSnapshotPayload, curr: BlackboardSnapshotPayload): string[] {
  const changes: string[] = [];
  const keys: (keyof BlackboardSnapshotPayload)[] = [
    'current_mode', 'next_agent', 'total_questions', 'p_followup_count',
    'consecutive_t_count', 'elapsed_minutes', 'coding_triggered', 'messages_count',
  ];
  for (const key of keys) {
    if (prev[key] !== curr[key]) {
      changes.push(`${key}: ${prev[key]} → ${curr[key]}`);
    }
  }
  return changes;
}

function BBRow({ item, prev }: {
  item: { timestamp: number; session_id: string; payload: BlackboardSnapshotPayload };
  prev?: { payload: BlackboardSnapshotPayload };
}) {
  const [expanded, setExpanded] = useState(false);
  const p = item.payload;
  const changes = prev ? diffSummary(prev.payload, p) : [];

  return (
    <div className="bb-record">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <span style={{ color: '#808080', minWidth: 80 }}>{fmt(item.timestamp)}</span>
        <span style={{ color: MODE_COLORS[p.current_mode] ?? '#d4d4d4', fontWeight: 'bold', minWidth: 70 }}>
          {p.current_mode}
        </span>
        <span style={{ color: '#9cdcfe', minWidth: 60 }}>{p.next_agent}</span>
        <span style={{ color: '#dcdcaa', minWidth: 50 }}>Q#{p.total_questions}</span>
        <span style={{ color: '#b5cea8', minWidth: 60 }}>{p.elapsed_minutes}min</span>
        {changes.length > 0 ? (
          <span style={{ color: '#ce9178', fontSize: 10, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            ΔΔ {changes.join(' | ')}
          </span>
        ) : (
          <span style={{ color: '#555', fontSize: 10 }}>无变化</span>
        )}
        <span style={{ color: '#555' }}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {/* Diff highlight */}
          {changes.length > 0 && (
            <div style={{ background: '#1a1a00', padding: 6, borderRadius: 2, marginBottom: 8 }}>
              <div style={{ color: '#dcdcaa', marginBottom: 4, fontSize: 10 }}>与上一次快照的差异</div>
              {changes.map((c, i) => (
                <div key={i} style={{ color: '#ce9178', fontSize: 11 }}>• {c}</div>
              ))}
            </div>
          )}
          {/* Full BB grid */}
          <div className="bb-grid">
            {(Object.entries(p) as [string, unknown][]).map(([k, v]) => (
              <div key={k} className="bb-field">
                <div className="bb-field-key">{k}</div>
                <div className="bb-field-val" style={{ color: changes.some((c) => c.startsWith(k)) ? '#ce9178' : '#9cdcfe' }}>
                  {String(v)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BlackboardPanel() {
  const snapshots = useStore((s) => s.blackboardSnapshots);
  const [search, setSearch] = useState('');

  const filtered = [...snapshots]
    .reverse()
    .filter((s) => !search || JSON.stringify(s).toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="search-bar">
        <input
          placeholder="搜索快照字段..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div style={{ padding: '4px 8px', background: '#252526', borderBottom: '1px solid #333', fontSize: 10, color: '#808080' }}>
        共 {snapshots.length} 次 Blackboard 快照
      </div>
      <div className="panel-scroll">
        {filtered.length === 0 && <div className="empty-state">暂无 Blackboard 快照</div>}
        {filtered.map((item, i) => {
          // prev is the NEXT item in reversed list (which is the one before in time)
          const prevOrigIdx = snapshots.length - 1 - (i + 1);
          const prev = prevOrigIdx >= 0 ? snapshots[prevOrigIdx] : undefined;
          return (
            <BBRow key={`${item.timestamp}-${i}`} item={item} prev={prev as typeof item | undefined} />
          );
        })}
      </div>
    </>
  );
}
