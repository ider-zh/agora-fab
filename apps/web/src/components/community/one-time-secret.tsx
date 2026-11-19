'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function OneTimeSecret({
  value,
  label,
  noun,
  help,
  rows = 2,
  dismiss,
}: {
  value: string;
  label: string;
  noun: string;
  help: string;
  rows?: number;
  dismiss: () => void;
}) {
  const labelId = useId();
  const helpId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    field.current?.focus();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${noun}已复制。`);
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus(`已选中${noun}，请使用系统复制功能。`);
    }
  }

  return (
    <div className="community-card one-time-credential">
      <label htmlFor={labelId}>{label}</label>
      <p id={helpId}>{help}</p>
      <textarea
        id={labelId}
        ref={field}
        value={value}
        rows={rows}
        readOnly
        autoComplete="off"
        spellCheck={false}
        aria-describedby={helpId}
      />
      <div className="community-actions">
        <button className="community-button" type="button" onClick={copy}>
          复制{noun}
        </button>
        <button
          className="community-button clear"
          type="button"
          onClick={dismiss}
        >
          关闭{noun}显示
        </button>
        <span className="community-meta" role="status">
          {status}
        </span>
      </div>
    </div>
  );
}
