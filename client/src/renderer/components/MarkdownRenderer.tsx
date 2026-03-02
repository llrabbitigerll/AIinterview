/**
 * MarkdownRenderer — Renders Markdown content with syntax-highlighted code blocks.
 * 
 * Used in chat messages to properly display agent responses containing
 * code snippets, lists, tables, etc.
 */
import React, { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const components: Components = {
    // Custom code block renderer with copy button
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !className;

      if (isInline) {
        return (
          <code className="inline-code" {...props}>
            {children}
          </code>
        );
      }

      return (
        <div className="code-block-wrapper">
          <div className="code-block-header">
            <span className="code-block-lang">{match?.[1] || 'code'}</span>
            <CopyButton text={String(children).replace(/\n$/, '')} />
          </div>
          <code className={className} {...props}>
            {children}
          </code>
        </div>
      );
    },
    // Ensure pre wraps our custom code blocks
    pre({ children }) {
      return <pre className="code-block-pre">{children}</pre>;
    },
  };

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

/** Small copy-to-clipboard button for code blocks */
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
    }
  }, [text]);

  return (
    <button className="code-copy-btn" onClick={handleCopy} title="复制代码">
      {copied ? '✓' : '⎘'}
    </button>
  );
};

export default MarkdownRenderer;
