/**
 * CodeEditorPanel — "手撕代码" code editor for interview coding challenges.
 *
 * Features:
 * - CodeMirror 6 with syntax highlighting & line numbers
 * - Language selection (JavaScript, Python, Java, C++, Go)
 * - Dark theme matching app style
 * - Submit button sends code to server
 */
import React, { useCallback, useState } from 'react';
import { Button, Select, Tag } from 'antd';
import { SendOutlined, ClearOutlined, CodeOutlined } from '@ant-design/icons';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { motion } from 'framer-motion';
import type { CodeChallenge } from '../types';

interface CodeEditorPanelProps {
  challenge: CodeChallenge | null;
  onSubmit: (code: string, language: string) => void;
  onClose: () => void;
}

const LANGUAGE_OPTIONS = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'golang', label: 'Golang' },
  { value: 'rust', label: 'Rust' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'swift', label: 'Swift' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'scala', label: 'Scala' },
  { value: 'haskell', label: 'Haskell' },
  { value: 'perl', label: 'Perl' },
  { value: 'objc', label: 'Objective-C' },
  { value: 'dart', label: 'Dart' },
  { value: 'lua', label: 'Lua' },
  { value: 'elixir', label: 'Elixir' },
  { value: 'erlang', label: 'Erlang' },
  { value: 'r', label: 'R' },
  { value: 'matlab', label: 'MATLAB' },
  { value: 'shell', label: 'Shell (bash)' },
  { value: 'sql', label: 'SQL' },
  { value: 'assembly', label: 'Assembly' },
];

const LANGUAGE_EXTENSIONS: Record<string, ReturnType<typeof javascript>> = {
  javascript: javascript({ jsx: false }),
  python: python(),
  java: java(),
  cpp: cpp(),
  go: cpp(), // Go syntax is close enough to C/C++ for basic highlighting
};

const LANGUAGE_TEMPLATES: Record<string, string> = {
  javascript: '// 在此编写你的代码\nfunction solution() {\n  \n}\n',
  python: '# 在此编写你的代码\ndef solution():\n    pass\n',
  java: '// 在此编写你的代码\nclass Solution {\n    public void solve() {\n        \n    }\n}\n',
  cpp: '// 在此编写你的代码\n#include <vector>\nusing namespace std;\n\nclass Solution {\npublic:\n    void solve() {\n        \n    }\n};\n',
  go: '// 在此编写你的代码\npackage main\n\nfunc solution() {\n    \n}\n',
};

const CodeEditorPanel: React.FC<CodeEditorPanelProps> = ({ challenge, onSubmit, onClose }) => {
  const defaultLang = challenge?.language || 'javascript';
  const [language, setLanguage] = useState(defaultLang);
  const [code, setCode] = useState(LANGUAGE_TEMPLATES[defaultLang] || '');

  const handleLanguageChange = useCallback((lang: string) => {
    setLanguage(lang);
    // Only reset to template if code is empty or is still the old template
    const oldTemplate = LANGUAGE_TEMPLATES[language] || '';
    if (!code.trim() || code === oldTemplate) {
      setCode(LANGUAGE_TEMPLATES[lang] || '');
    }
  }, [code, language]);

  const handleReset = useCallback(() => {
    setCode(LANGUAGE_TEMPLATES[language] || '');
  }, [language]);

  const handleSubmit = useCallback(() => {
    if (code.trim()) {
      onSubmit(code, language);
    }
  }, [code, language, onSubmit]);

  return (
    <motion.div
      className="code-editor-panel"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 50 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="code-editor-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CodeOutlined style={{ color: 'var(--accent)' }} />
          <span className="code-editor-title">
            {challenge?.title || '手撕代码'}
          </span>
          <Tag color="blue">编码</Tag>
        </div>
        <Button size="small" type="text" onClick={onClose} style={{ color: 'var(--text-secondary)' }}>
          收起
        </Button>
      </div>

      {/* Challenge description */}
      {challenge?.description && (
        <div className="code-challenge-desc">
          {challenge.description}
        </div>
      )}

      {/* Toolbar */}
      <div className="code-editor-toolbar">
        <Select
          value={language}
          onChange={handleLanguageChange}
          options={LANGUAGE_OPTIONS}
          size="small"
          style={{ width: 140 }}
          popupMatchSelectWidth={false}
        />
        <Button
          size="small"
          icon={<ClearOutlined />}
          onClick={handleReset}
        >
          重置
        </Button>
      </div>

      {/* Editor */}
      <div className="code-editor-body">
        <CodeMirror
          value={code}
          onChange={setCode}
          theme={vscodeLight}
          extensions={[LANGUAGE_EXTENSIONS[language] || javascript()]}
          height="100%"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            indentOnInput: true,
            tabSize: 4,
          }}
        />
      </div>

      {/* Submit */}
      <div className="code-editor-footer">
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSubmit}
          disabled={!code.trim()}
        >
          提交代码
        </Button>
      </div>
    </motion.div>
  );
};

export default CodeEditorPanel;
