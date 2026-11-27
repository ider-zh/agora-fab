'use client';

import { type ReactNode, useEffect, useRef } from 'react';

export function DiscussionIndexDisclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (
      ref.current &&
      (window.matchMedia('(min-width: 900px)').matches ||
        window.location.hash === '#discussion-index')
    ) {
      ref.current.open = true;
    }
  }, []);
  return (
    <details id="discussion-index" ref={ref}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
