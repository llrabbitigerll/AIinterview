import React, { useState } from 'react';
import { useStore } from '../store';
import type { DevToolsEvent } from '../types';

const TYPE_COLORS: Record<string, string> = {
  ws_c2s: '#dcdcaa',
  ws_s2c: '#4ec9b0',
  llm_call_start: '#c586c0',
  llm_stream_start: '#c586c0',
  llm_call_end: '#9cdcfe',
  llm_stream_end: '#9cdcfe',
  agent_decision: '#ce9178',
  blackboard_snapshot: '#569cd6',
  eval_result: '#4ec9b0',
  research_phase_start: '#dcdcaa',
  research_phase_end: '#b5cea8',
  log_record: '#808080',
  session_start: '#f44747',
  devtools_connected: '#4ec9b0',
  keepalive: '#333',
};

const ALL_TYPES = [
  'ws_c2s', 'ws_s2c', 'llm_call_start', 'llm_call_end',
  'llm_stream_start', 'llm_stream_end', 'agent_decision',
  'blackboard_snapshot', 'eval_result', 'research_phase_start',
  'research_phase_end', 'log_record', 'session_start',
];

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh', { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
}

function EventRow({ ev }: { ev: DevToolsEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = TYPE_COLORS[ev.type] ?? '#d4d4d4';
  const preview = JSON.stringify(ev.payload).slice(0, 120);

  return (
    <div className="event-row">
      <span className="event-time">{fmt(ev.timestamp)}</span>
      <span className="event-session" title={ev.session_id}>{ev.session_id.slice(0, 8) || '-'}</span>
      <span className="event-type" style={{ color }}>{ev.type}</span>
      <span className="event-body">
        <span
          className="json-preview"
          onClick={() => setExpanded(!expanded)}
          title="点击展开/收起"
        >
          {expanded ? '▼ ' : '▶ '}{preview}{preview.length === 120 ? '...' : ''}
        </span>
        {expanded && (
          <div className="json-full">
            {JSON.stringify(ev.payload, null, 2)}
          </div>
        )}
      </span>
    </div>
  );
}

export default function TimelinePanel() {
  const events = useStore((s) => s.events);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const toggle = (t: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const filtered = [...events]
    .reverse()
    .filter((e) => {
      if (activeFilters.size > 0 && !activeFilters.has(e.type)) return false;
      if (search && !JSON.stringify(e).toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

  return (
    <>
      <div className="search-bar">
        <input
          placeholder="搜索事件内容..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="filter-bar">
        {ALL_TYPES.map((t) => (
          <span
            key={t}
            className={`filter-chip ${activeFilters.has(t) ? 'active' : ''}`}
            onClick={() => toggle(t)}
            style={{ borderColor: activeFilters.has(t) ? (TYPE_COLORS[t] ?? '#0e639c') : undefined }}
          >
            {t.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
      <div className="panel-scroll">
        {filtered.length === 0 && (
          <div className="empty-state">暂无事件 — 等待服务器连接...</div>
        )}
        {filtered.map((ev, i) => (
          <EventRow key={`${ev.timestamp}-${i}`} ev={ev} />
        ))}
      </div>
    </>
  );
}
