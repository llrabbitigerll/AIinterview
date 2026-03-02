import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { DevToolsEvent } from '../types';

interface ArchivedInterview {
  interview_id: string;
  event_count: number;
  first_timestamp: number | null;
  last_timestamp: number | null;
}

function fmt(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('zh', { hour12: false });
}

export default function ReplayPanel() {
  const replayEvents = useStore((s) => s.replayEvents);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const [items, setItems] = useState<ArchivedInterview[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string>('');
  const [search, setSearch] = useState('');

  const BASE = 'http://localhost:8001';

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => x.interview_id.toLowerCase().includes(s));
  }, [items, search]);

  const loadList = async () => {
    setLoadingList(true);
    setError('');
    try {
      const r = await fetch(`${BASE}/devtools/archive/interviews`);
      const data = await r.json();
      const rows = Array.isArray(data.interviews) ? data.interviews as ArchivedInterview[] : [];
      setItems(rows);
      if (!selected && rows.length > 0) {
        setSelected(rows[0].interview_id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingList(false);
    }
  };

  const loadReplay = async (interviewId: string) => {
    if (!interviewId) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${BASE}/devtools/archive/${encodeURIComponent(interviewId)}?limit=5000`);
      const data = await r.json();
      const events = Array.isArray(data.events) ? data.events as DevToolsEvent[] : [];
      replayEvents(events);
      setActiveTab('timeline');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  return (
    <>
      <div className="search-bar replay-toolbar">
        <input
          placeholder="搜索 interview_id..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={loadList} disabled={loadingList}>
          {loadingList ? '刷新中...' : '刷新历史列表'}
        </button>
        <button
          className="btn"
          disabled={!selected || loading}
          onClick={() => loadReplay(selected)}
        >
          {loading ? '回放中...' : '回放选中面试'}
        </button>
      </div>

      <div className="panel-scroll">
        {error && <div className="replay-error">{error}</div>}
        {filtered.length === 0 && !loadingList && <div className="empty-state">暂无历史归档</div>}

        {filtered.map((item) => {
          const active = item.interview_id === selected;
          return (
            <div
              key={item.interview_id}
              className={`replay-item ${active ? 'active' : ''}`}
              onClick={() => setSelected(item.interview_id)}
            >
              <div className="replay-id">{item.interview_id}</div>
              <div className="replay-meta">
                <span>事件: {item.event_count ?? 0}</span>
                <span>开始: {fmt(item.first_timestamp)}</span>
                <span>结束: {fmt(item.last_timestamp)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
