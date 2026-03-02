/**
 * InterviewPage — Main interview interface.
 *
 * Layout (3-column):
 * - Left  (260px): Interviewer avatar, status, session controls
 * - Middle (flex): Conversation history + input area
 * - Right (380px): Code editor panel (shown when coding challenge active)
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button, Input, Tag, Tooltip } from 'antd';
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SendOutlined,
  UserOutlined,
  RobotOutlined,
  CodeOutlined,
  AudioOutlined,
  AudioMutedOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  SoundFilled,
} from '@ant-design/icons';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { motion, AnimatePresence } from 'framer-motion';
import { useInterviewStore } from '../stores/interviewStore';
import { getInterviewService } from '../services/InterviewService';
import WaveformVisualizer from '../components/WaveformVisualizer';
import MarkdownRenderer from '../components/MarkdownRenderer';
import CodeEditorPanel from '../components/CodeEditorPanel';
import type { ChatMessage } from '../types';

const InterviewPage: React.FC = () => {
  // Fine-grained selectors — each only re-renders when its own slice changes.
  // Do NOT subscribe to the whole store: audio.currentVolume fires ~60fps and
  // would cause "Maximum update depth exceeded".
  const phase            = useInterviewStore((s) => s.phase);
  const messages         = useInterviewStore((s) => s.messages);
  const streamingMessage = useInterviewStore((s) => s.streamingMessage);
  const codeEditorActive = useInterviewStore((s) => s.codeEditorActive);
  const codeChallenge    = useInterviewStore((s) => s.codeChallenge);
  const isQASession      = useInterviewStore((s) => s.isQASession);
  const blackboardMode   = useInterviewStore((s) => s.blackboard?.currentMode);

  // Agent display names & active state — only re-render when agents change
  const agentBActive      = useInterviewStore((s) => s.agents.agentB.isActive);
  const agentCActive      = useInterviewStore((s) => s.agents.agentC.isActive);
  const agentBDisplayName = useInterviewStore((s) => s.agents.agentB.displayName);
  const agentCDisplayName = useInterviewStore((s) => s.agents.agentC.displayName);

  // Audio — split into individual primitives so volume updates don't touch unrelated state
  const isRecording        = useInterviewStore((s) => s.audio.isRecording);
  const isSpeaking         = useInterviewStore((s) => s.audio.isSpeaking);
  const currentVolume      = useInterviewStore((s) => s.audio.currentVolume);
  const currentTranscription = useInterviewStore((s) => s.audio.currentTranscription);
  const wordGapAlert       = useInterviewStore((s) => s.audio.wordGapAlert);
  const pendingVoiceText   = useInterviewStore((s) => s.audio.pendingVoiceText);
  const isAnswerLocked     = useInterviewStore((s) => s.audio.isAnswerLocked);
  const isTtsPlaying       = useInterviewStore((s) => s.audio.isTtsPlaying);

  const [textInput, setTextInput] = useState('');
  const [isVoiceInput, setIsVoiceInput] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showExpandBtn, setShowExpandBtn] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const avatarSceneRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<TextAreaRef>(null);
  const service = getInterviewService();

  // Show expand button when textarea content overflows maxRows (5 lines)
  useEffect(() => {
    const ta = textAreaRef.current?.resizableTextArea?.textArea;
    if (!ta) return;
    // Allow the DOM to update before measuring
    const id = requestAnimationFrame(() => {
      if (isExpanded) return; // Don't collapse button while expanded
      const overflows = ta.scrollHeight > ta.clientHeight + 2;
      setShowExpandBtn(overflows);
      // Only call setIsExpanded when it needs to change, to avoid triggering
      // the effect again via the isExpanded dep
      if (!overflows && isExpanded) setIsExpanded(false);
    });
    return () => cancelAnimationFrame(id);
  }, [textInput, isExpanded]);

  // Auto-fill input box when voice transcription is finalized
  useEffect(() => {
    if (pendingVoiceText) {
      setTextInput((prev) => {
        if (prev.trim()) return prev + ' ' + pendingVoiceText;
        return pendingVoiceText;
      });
      setIsVoiceInput(true);
      useInterviewStore.getState().updateAudio({
        pendingVoiceText: '',
        hadVoiceInput: false,
        currentTranscription: '',
      });
    }
  }, [pendingVoiceText]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  // Send text message (voice or keyboard)
  const handleSendText = useCallback(() => {
    if (textInput.trim()) {
      if (isVoiceInput) {
        service.sendVoiceMessage(textInput.trim());
      } else {
        service.sendTextInput(textInput.trim());
      }
      setTextInput('');
      setIsVoiceInput(false);
      // Resume mic for the next answer after user confirms send
      service.unlockAnswer();
    }
  }, [textInput, isVoiceInput, service]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendText();
      }
    },
    [handleSendText]
  );

  // Submit code from editor
  const handleCodeSubmit = useCallback((code: string, language: string) => {
    service.sendCodeSubmit(code, language);
  }, [service]);

  // Close code editor panel
  const handleCodeEditorClose = useCallback(() => {
    useInterviewStore.getState().setCodeEditor(false);
  }, []);

  // Get agent display info
  const getAgentInfo = (role: string) => {
    if (role === 'agent_b') {
      return {
        name: agentBDisplayName,
        tag: '技术面试官',
        tagColor: 'blue',
        borderColor: 'var(--agent-b-color)',
      };
    }
    if (role === 'agent_c') {
      return {
        name: agentCDisplayName,
        tag: '业务面试官',
        tagColor: 'purple',
        borderColor: 'var(--agent-c-color)',
      };
    }
    return null;
  };

  // Render a chat message bubble
  const renderMessage = (msg: ChatMessage) => {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';
    const isAgent = msg.role === 'agent_b' || msg.role === 'agent_c';
    const agentInfo = isAgent ? getAgentInfo(msg.role) : null;

    const bubbleClass = isUser
      ? 'user'
      : msg.role === 'agent_b'
      ? 'agent_b'
      : msg.role === 'agent_c'
      ? 'agent_c'
      : 'system';

    return (
      <motion.div
        key={msg.id}
        className={`message-bubble ${bubbleClass}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* User message header */}
        {isUser && (
          <div className="message-header message-header-user">
            <span className="message-sender-name">我</span>
            <UserOutlined style={{ fontSize: 12 }} />
          </div>
        )}

        {/* Agent message header */}
        {isAgent && agentInfo && (
          <div className="message-header">
            <RobotOutlined style={{ fontSize: 12, color: agentInfo.borderColor }} />
            <span className="message-sender-name" style={{ color: agentInfo.borderColor }}>
              {agentInfo.name}
            </span>
            <Tag color={agentInfo.tagColor} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
              {agentInfo.tag}
            </Tag>
          </div>
        )}

        {/* System message */}
        {isSystem && <div className="system-message-text">{msg.content}</div>}

        {/* User message: plain text */}
        {isUser && <div className="message-content">{msg.content}</div>}

        {/* Agent message: Markdown rendered */}
        {isAgent && (
          <div className="message-content">
            <MarkdownRenderer content={msg.content} />
          </div>
        )}

        {/* Streaming indicator */}
        {msg.isStreaming && (
          <div className="streaming-dots">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        )}
      </motion.div>
    );
  };

  const layoutClass = codeEditorActive
    ? 'interview-layout interview-layout-with-code'
    : 'interview-layout';

  // Derive mic status label & color
  const micStatus = isRecording
    ? isSpeaking
      ? { dot: 'dot-recording', label: '正在聆听' }
      : { dot: 'dot-ready', label: '麦克风就绪' }
    : { dot: 'dot-off', label: '麦克风未启动' };

  // Derive interviewer dialog content:
  // - Show streaming content while AI is typing
  // - Keep showing last agent message until user sends a reply
  // - Hide once user message is the last entry in messages[]
  const stripMarkdown = (text: string) =>
    text
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .replace(/\*(.+?)\*/gs, '$1')
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/^>\s/gm, '')
      .trim();

  const lastMessage = messages[messages.length - 1];
  const lastIsUser = lastMessage?.role === 'user';
  const dialogContent: string | null = (() => {
    if (streamingMessage) return stripMarkdown(streamingMessage.content);
    if (!lastIsUser && lastMessage && lastMessage.role !== 'system') return stripMarkdown(lastMessage.content);
    return null;
  })();
  const showDialog = phase === 'interviewing' && !!dialogContent;

  return (
    <div className={layoutClass}>

      {/* ══════════════════════════════════════════════
          LEFT PANEL — Immersive Scene + Input
          ══════════════════════════════════════════════ */}
      <div className="left-panel">

        {/* ── Scene Image Area (dominant / immersive) ── */}
        <div className="avatar-scene" ref={avatarSceneRef}>

          {/* Floating session status badge */}
          <div className="lp-header">
            <span className={`session-dot${phase === 'paused' ? ' session-dot--paused' : ' session-dot--live'}`} />
            <span className="session-label">
              {phase === 'paused' ? '已暂停' : phase === 'completed' ? '已结束' : '面试进行中'}
            </span>
          </div>

          {/* Code panel toggle floating top-right */}
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
            <Tooltip title={codeEditorActive ? '收起代码面板' : '展开代码面板'}>
              <Button
                type={codeEditorActive ? 'primary' : 'default'}
                size="small"
                icon={<CodeOutlined />}
                onClick={() => useInterviewStore.getState().setCodeEditor(!codeEditorActive)}
                style={{
                  borderRadius: 20,
                  background: codeEditorActive ? undefined : 'rgba(255,255,255,0.85)',
                  backdropFilter: 'blur(6px)',
                  border: 'none',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                }}
              />
            </Tooltip>
          </div>

          {/* Scene illustration placeholder — replace src with real image path */}
          <div className="scene-placeholder">
            <svg
              className="scene-illustration"
              viewBox="0 0 560 400"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Background wall */}
              <rect width="560" height="400" fill="#1e2d4a" />
              {/* Window */}
              <rect x="60" y="40" width="120" height="160" rx="6" fill="#2a4a7a" opacity="0.7" />
              <line x1="120" y1="40" x2="120" y2="200" stroke="#3a6aaa" strokeWidth="2" />
              <line x1="60" y1="120" x2="180" y2="120" stroke="#3a6aaa" strokeWidth="2" />
              {/* Bookshelf right wall */}
              <rect x="430" y="20" width="100" height="220" rx="4" fill="#162035" />
              <rect x="438" y="30" width="84" height="18" rx="2" fill="#2a5a9a" opacity="0.8" />
              <rect x="438" y="54" width="84" height="18" rx="2" fill="#3a4a6a" opacity="0.8" />
              <rect x="438" y="78" width="84" height="18" rx="2" fill="#4a3a7a" opacity="0.7" />
              <rect x="438" y="102" width="84" height="18" rx="2" fill="#2a4a5a" opacity="0.8" />
              <rect x="438" y="126" width="84" height="18" rx="2" fill="#5a3a4a" opacity="0.7" />
              {/* Desk */}
              <rect x="40" y="260" width="480" height="18" rx="6" fill="#2d1e10" />
              <rect x="60" y="278" width="16" height="100" rx="4" fill="#261a0d" />
              <rect x="484" y="278" width="16" height="100" rx="4" fill="#261a0d" />
              {/* Laptop on desk */}
              <rect x="210" y="220" width="140" height="90" rx="5" fill="#1a1a2e" />
              <rect x="215" y="225" width="130" height="80" rx="3" fill="#0d1b2a" />
              {/* Laptop screen glow */}
              <rect x="218" y="228" width="124" height="74" rx="2" fill="#1a3a6a" opacity="0.6" />
              <rect x="160" y="310" width="240" height="8" rx="4" fill="#1a1a2e" />
              {/* Coffee mug */}
              <rect x="395" y="238" width="28" height="32" rx="4" fill="#4a3728" />
              <path d="M423 245 Q440 252 423 262" stroke="#6a5748" strokeWidth="3" fill="none" strokeLinecap="round" />
              {/* Interviewer silhouette */}
              {/* Body */}
              <ellipse cx="280" cy="195" rx="54" ry="62" fill="#243050" />
              {/* Head */}
              <circle cx="280" cy="112" r="38" fill="#3d2b1f" />
              {/* Collar / shirt */}
              <path d="M248 190 Q280 200 312 190 L320 260 L240 260 Z" fill="#1a2545" />
              {/* Tie */}
              <path d="M275 192 L280 205 L285 192 L282 250 L278 250 Z" fill="#8b1a1a" />
              {/* Face highlight */}
              <ellipse cx="280" cy="105" rx="24" ry="26" fill="#4a3322" opacity="0.9" />
              {/* Hair */}
              <ellipse cx="280" cy="78" rx="36" ry="18" fill="#1a1008" />
              {/* Shoulders highlight */}
              <ellipse cx="280" cy="192" rx="60" ry="14" fill="#2d3d60" opacity="0.7" />
            </svg>
          </div>

          {/* ── Interviewer Dialog Box (RPG-style speech bubble) ── */}
          <AnimatePresence>
            {showDialog && (
              <motion.div
                className="interviewer-dialog"
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              >
                <div className="interviewer-dialog__header">
                  <span className="interviewer-dialog__icon">▶</span>
                  <span className="interviewer-dialog__name">
                    {agentBActive ? agentBDisplayName : agentCActive ? agentCDisplayName : 'AI 面试官'}
                  </span>
                  {isTtsPlaying ? (
                    <span className="interviewer-dialog__speaking" title="面试官说话中">
                      <SoundFilled style={{ fontSize: 13, color: 'var(--accent, #2563eb)', marginRight: 3 }} />
                      <span style={{ fontSize: 11, color: 'var(--accent, #2563eb)', opacity: 0.85 }}>说话中…</span>
                    </span>
                  ) : streamingMessage ? (
                    <span className="interviewer-dialog__typing">
                      <span /><span /><span />
                    </span>
                  ) : null}
                </div>
                <div className="interviewer-dialog__body">
                  {dialogContent}
                </div>
                <span className="interviewer-dialog__corner interviewer-dialog__corner--tl" />
                <span className="interviewer-dialog__corner interviewer-dialog__corner--tr" />
                <span className="interviewer-dialog__corner interviewer-dialog__corner--bl" />
                <span className="interviewer-dialog__corner interviewer-dialog__corner--br" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom overlay: agent nameplate + waveform */}
          <div className="scene-overlay">
            <div className="scene-waveform">
              <WaveformVisualizer volume={currentVolume} isSpeaking={isSpeaking} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                <span className={`mic-dot ${micStatus.dot}`} />
                <span className="mic-label" style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
                  {micStatus.label}
                </span>
              </div>
            </div>
            <div className="agent-nameplate">
              <h2 className="agent-name">
                {agentBActive ? agentBDisplayName : agentCActive ? agentCDisplayName : 'AI 面试官'}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag
                  color={agentCActive ? 'purple' : 'blue'}
                  style={{ borderRadius: 20, fontSize: 12, padding: '1px 10px', margin: 0 }}
                >
                  {agentBActive ? '技术面试官' : agentCActive ? '业务面试官' : '等待中'}
                </Tag>
                <div className="agent-state-hint" style={{ margin: 0 }}>
                  {(agentBActive || agentCActive)
                    ? <><span className="hint-dot hint-dot--active" />正在提问</>
                    : <><span className="hint-dot" />等待中</>}
                </div>
              </div>
            </div>
          </div>

        </div>{/* /avatar-scene */}

        {/* ── Input Area ── */}
        <div className="input-panel">

          {/* Transcription / status bar */}
          <div className="transcription-bar">
            <div className="transcription-status">
              <span className={`mic-dot ${micStatus.dot}`} />
              <span className="mic-label">{micStatus.label}</span>
            </div>
            {currentTranscription ? (
              <div className="transcription-live">
                <span className="transcription-text">{currentTranscription}</span>
                {wordGapAlert && (
                  <Tag color="orange" style={{ marginLeft: 6, fontSize: 11, verticalAlign: 'middle' }}>
                    思考中…
                  </Tag>
                )}
              </div>
            ) : isSpeaking ? (
              <span className="transcription-hint">正在识别语音…</span>
            ) : null}
          </div>

          {/* Textarea */}
          <div className="textarea-wrapper">
            <AnimatePresence>
              {(showExpandBtn || isExpanded) && (
                <motion.button
                  className="textarea-expand-btn"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => {
                    setIsExpanded((prev) => {
                      const next = !prev;
                      if (!next) setShowExpandBtn(false);
                      return next;
                    });
                  }}
                  title={isExpanded ? '收起输入框' : '展开输入框'}
                >
                  {isExpanded ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                </motion.button>
              )}
            </AnimatePresence>
            <Input.TextArea
              ref={textAreaRef}
              placeholder={
                isQASession
                  ? '请输入您的提问，或使用语音输入…'
                  : '请输入您的回答，或使用语音输入…'
              }
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoSize={isExpanded ? false : { minRows: 2, maxRows: 5 }}
              style={{
                borderRadius: 10,
                fontSize: 14,
                padding: '10px 14px',
                resize: 'none',
                background: '#f8f9fc',
                border: isVoiceInput
                  ? '1.5px solid var(--accent)'
                  : '1.5px solid rgba(0,0,0,0.08)',
                boxShadow: isVoiceInput ? '0 0 0 3px rgba(37,99,235,0.08)' : 'none',
                transition: 'height 0.3s cubic-bezier(0.4,0,0.2,1), border-color 0.2s, box-shadow 0.2s',
                ...(isExpanded && {
                  height: Math.floor((avatarSceneRef.current?.offsetHeight ?? 320) / 2),
                  overflowY: 'auto',
                }),
              }}
            />
          </div>

          {/* Action row */}
          <div className="input-actions">
            {/* Left: answer-end + session controls */}
            <div className="input-actions__left">
              {phase === 'interviewing' && (
                isAnswerLocked ? (
                  <button
                    className="answer-end-pill answer-end-pill--locked"
                    onClick={() => service.unlockAnswer()}
                    disabled={isTtsPlaying}
                  >
                    <AudioMutedOutlined style={{ marginRight: 5 }} />
                    已停止录音 · 重录
                  </button>
                ) : (
                  <button
                    className={`answer-end-pill${(!isRecording || isTtsPlaying) ? ' answer-end-pill--disabled' : ''}`}
                    onClick={() => (isRecording && !isTtsPlaying) && service.lockAnswer()}
                    disabled={!isRecording || isTtsPlaying}
                  >
                    <AudioOutlined style={{ marginRight: 5 }} />
                    {isTtsPlaying ? '面试官说话中…' : '回答结束'}
                  </button>
                )
              )}
              <div className="lp-controls">
                {phase === 'interviewing' && (
                  <Tooltip title="暂停面试">
                    <button className="ctrl-btn ctrl-btn--ghost" onClick={() => service.pauseInterview()}>
                      <PauseCircleOutlined />
                    </button>
                  </Tooltip>
                )}
                {phase === 'paused' && (
                  <Tooltip title="继续面试">
                    <button className="ctrl-btn ctrl-btn--primary" onClick={() => service.resumeInterview()}>
                      <PlayCircleOutlined />
                    </button>
                  </Tooltip>
                )}
                <Tooltip title="结束面试">
                  <button className="ctrl-btn ctrl-btn--danger" onClick={() => service.endInterview()}>
                    <StopOutlined />
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Right: send */}
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSendText}
              disabled={!textInput.trim() || isTtsPlaying}
              style={{ borderRadius: 20, padding: '0 22px', fontWeight: 500 }}
            >
              发送
            </Button>
          </div>

        </div>{/* /input-panel */}

      </div>{/* /left-panel */}


      {/* ══════════════════════════════════════════════
          MIDDLE PANEL — Compact Conversation Log
          ══════════════════════════════════════════════ */}
      <div className="middle-panel">

        {/* ── Chat Header ── */}
        <div className="chat-header">
          <div className="chat-header__left">
            <span className="chat-header__title">对话记录</span>
            <Tag
              color={
                blackboardMode === 'project' ? 'blue'
                  : blackboardMode === 'qa_session' ? 'gold'
                  : 'green'
              }
              style={{ borderRadius: 20, fontSize: 11, padding: '1px 8px', margin: 0 }}
            >
              {blackboardMode === 'project' ? '项目深挖'
                : blackboardMode === 'qa_session' ? '反问环节'
                : '常规技术'}
            </Tag>
          </div>
        </div>

        {/* ── Message List (reference only, no input) ── */}
        <div className="message-list">
          <div className="message-bubble system">
            <div className="system-message-text">面试开始</div>
          </div>

          {isQASession && (
            <div className="message-bubble system">
              <div className="system-message-text system-qa-notice">
                已进入反问环节 — 你可以向面试官提问
              </div>
            </div>
          )}

          <AnimatePresence>
            {messages.map(renderMessage)}
            {streamingMessage && renderMessage(streamingMessage)}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

      </div>{/* /middle-panel */}


      {/* ══════════════════════════════════════════════
          RIGHT PANEL — Code Editor
          ══════════════════════════════════════════════ */}
      <div className="right-panel">
        <AnimatePresence>
          {codeEditorActive && (
            <CodeEditorPanel
              challenge={codeChallenge}
              onSubmit={handleCodeSubmit}
              onClose={handleCodeEditorClose}
            />
          )}
        </AnimatePresence>
      </div>

    </div>
  );
};

export default InterviewPage;
