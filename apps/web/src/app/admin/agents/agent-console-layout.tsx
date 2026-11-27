'use client';

import { type ReactNode, useEffect, useRef } from 'react';

export function AgentConsoleLayout({
  selected,
  children,
}: {
  selected?: string;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const lastSelection = useRef<{ reference: string; rowId?: string }>(
    undefined,
  );

  useEffect(() => {
    if (selected === lastSelection.current?.reference) return;

    const layout = container.current;
    if (selected) {
      lastSelection.current = {
        reference: selected,
        rowId: layout?.querySelector('.agent-table a[aria-current]')?.id,
      };
      const detail = layout?.querySelector<HTMLElement>(
        '#agent-console-detail',
      );
      detail?.focus({ preventScroll: true });
      detail?.scrollIntoView({
        block: window.matchMedia('(max-width: 840px)').matches
          ? 'start'
          : 'nearest',
      });
    } else {
      const rowId = lastSelection.current?.rowId;
      lastSelection.current = undefined;
      const entry =
        (rowId && document.getElementById(rowId)) ||
        layout?.querySelector<HTMLElement>('#agents-heading');
      entry?.focus({ preventScroll: true });
      entry?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  return (
    <div
      className={
        selected ? 'agent-console-layout has-selection' : 'agent-console-layout'
      }
      ref={container}
    >
      {children}
    </div>
  );
}
