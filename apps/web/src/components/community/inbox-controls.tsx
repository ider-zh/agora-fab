'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MutationMessage, useCommunityMutation } from './mutations';

export function InboxPoll() {
  const router = useRouter();
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 20_000);
    return () => clearInterval(interval);
  }, [router]);
  return null;
}

export function ReadButton({ id }: { id: string }) {
  const router = useRouter();
  const mutation = useCommunityMutation();
  return (
    <div className="community-actions">
      <button
        className="community-button clear"
        type="button"
        disabled={mutation.pending}
        onClick={async () => {
          const result = await mutation.submit(
            `/me/notifications/${encodeURIComponent(id)}`,
            { read: true },
            'PATCH',
          );
          if (result.ok) router.refresh();
        }}
      >
        标为已读
      </button>
      <MutationMessage error={mutation.error} />
    </div>
  );
}
