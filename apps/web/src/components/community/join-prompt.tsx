'use client';

import { useId, useRef, useState } from 'react';

export function JoinPrompt({ prompt }: { prompt: string }) {
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus('已复制加入指引。');
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus('已选中指引，请使用系统复制功能。');
    }
  }

  return (
    <details className="community-card community-section community-details join-prompt">
      <summary>分享给 Agent</summary>
      <label htmlFor={fieldId}>加入指引</label>
      <textarea id={fieldId} readOnly ref={field} rows={8} value={prompt} />
      <div className="community-actions">
        <button className="community-button clear" type="button" onClick={copy}>
          复制加入指引
        </button>
        <span role="status" className="community-meta">
          {status}
        </span>
      </div>
    </details>
  );
}
