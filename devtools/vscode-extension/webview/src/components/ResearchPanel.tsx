import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import type { ResearchPhasePayload } from '../types';

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh', { hour12: false });
}

interface ResearchFile {
  size_bytes: number;
  modified: number;
}

interface ResearchFolderInfo {
  files: Record<string, ResearchFile>;
}

export default function ResearchPanel() {
  const researchEvents = useStore((s) => s.researchEvents);
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folderInfo, setFolderInfo] = useState<ResearchFolderInfo | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const BASE = 'http://localhost:8001';

  const fetchFolders = async () => {
    try {
      const r = await fetch(`${BASE}/devtools/research`);
      const data = await r.json();
      setFolders(data.folders ?? []);
    } catch {}
  };

  const fetchFolder = async (folder: string) => {
    setSelectedFolder(folder);
    setFileContent(null);
    setSelectedFile(null);
    try {
      const r = await fetch(`${BASE}/devtools/research/${folder}`);
      const data = await r.json();
      setFolderInfo(data);
    } catch {}
  };

  const fetchFile = async (folder: string, filename: string) => {
    setLoading(true);
    setSelectedFile(filename);
    try {
      const r = await fetch(`${BASE}/devtools/research/${folder}/${filename}`);
      const data = await r.json();
      setFileContent(JSON.stringify(data.content, null, 2));
    } catch (e) {
      setFileContent(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFolders();
  }, []);

  const phaseEvents = [...researchEvents].reverse();

  return (
    <div className="panel-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Phase event stream */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #333' }}>
        <div style={{ color: '#569cd6', fontWeight: 'bold', marginBottom: 4 }}>实时调研进度</div>
        {phaseEvents.length === 0 && (
          <div style={{ color: '#555', fontSize: 11 }}>暂无调研事件</div>
        )}
        {phaseEvents.map((item, i) => {
          const p = item.payload as ResearchPhasePayload;
          const isEnd = item.event_type === 'research_phase_end';
          return (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 11 }}>
              <span style={{ color: '#808080', minWidth: 90 }}>{fmt(item.timestamp)}</span>
              <span style={{ color: isEnd ? '#4ec9b0' : '#dcdcaa', minWidth: 30 }}>
                {isEnd ? '✅' : '⏳'} P{p.phase}
              </span>
              <span style={{ color: '#9cdcfe', minWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.interview_id?.slice(0, 8) ?? '-'}
              </span>
              {isEnd && p.elapsed_ms !== undefined && (
                <span style={{ color: '#b5cea8' }}>{p.elapsed_ms}ms</span>
              )}
              {!p.success && p.error && (
                <span style={{ color: '#f44747' }}>{p.error}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Research output file browser */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#569cd6', fontWeight: 'bold' }}>调研输出文件</span>
        <button className="btn" onClick={fetchFolders} style={{ fontSize: 10, padding: '1px 6px' }}>刷新</button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Folder list */}
        <div style={{ width: 180, borderRight: '1px solid #333', overflow: 'y', overflowY: 'auto', padding: 4 }}>
          {folders.length === 0 && <div style={{ color: '#555', fontSize: 11, padding: 4 }}>暂无调研结果</div>}
          {folders.map((f) => (
            <div
              key={f}
              onClick={() => fetchFolder(f)}
              style={{
                padding: '3px 6px', cursor: 'pointer', borderRadius: 2, fontSize: 11,
                background: selectedFolder === f ? '#0e639c33' : undefined,
                color: selectedFolder === f ? '#9cdcfe' : '#d4d4d4',
              }}
              title={f}
            >
              📁 {f.slice(0, 10)}...
            </div>
          ))}
        </div>

        {/* File list */}
        {folderInfo && (
          <div style={{ width: 160, borderRight: '1px solid #333', overflow: 'y', overflowY: 'auto', padding: 4 }}>
            {Object.entries(folderInfo.files ?? {}).map(([name, info]) => (
              <div
                key={name}
                onClick={() => selectedFolder && fetchFile(selectedFolder, name)}
                style={{
                  padding: '3px 6px', cursor: 'pointer', borderRadius: 2, fontSize: 11,
                  background: selectedFile === name ? '#0e639c33' : undefined,
                  color: selectedFile === name ? '#9cdcfe' : '#d4d4d4',
                }}
              >
                📄 {name}
                <div style={{ color: '#555', fontSize: 9 }}>{Math.round((info as ResearchFile).size_bytes / 1024)}KB</div>
              </div>
            ))}
          </div>
        )}

        {/* File content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 8, background: '#1e1e1e' }}>
          {loading && <div style={{ color: '#808080' }}>加载中...</div>}
          {!loading && fileContent && (
            <pre style={{ fontSize: 11, color: '#d4d4d4', whiteSpace: 'pre-wrap' }}>{fileContent}</pre>
          )}
          {!loading && !fileContent && (
            <div style={{ color: '#555', fontSize: 11 }}>选择文件查看内容</div>
          )}
        </div>
      </div>
    </div>
  );
}
