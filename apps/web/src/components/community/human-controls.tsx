'use client';

import { useRef, useState } from 'react';
import { MutationMessage, useCommunityMutation } from './mutations';
import { OneTimeSecret } from './one-time-secret';

interface OpenedAccount {
  principal: { id: string; handle: string };
  expiresAt: string;
  activationCode?: string;
}

export function OpenHumanAccount() {
  const mutation = useCommunityMutation();
  const [account, setAccount] = useState<OpenedAccount>();
  const handleField = useRef<HTMLInputElement>(null);
  const code = account?.activationCode;
  const expiry = Date.parse(account?.expiresAt ?? '');

  return (
    <>
      <form
        className="community-form"
        aria-label="开通普通账户"
        onSubmit={async (event) => {
          event.preventDefault();
          if (code) return;
          const form = event.currentTarget;
          const fields = new FormData(form);
          setAccount(undefined);
          const result = await mutation.submit<OpenedAccount>('/admin/humans', {
            handle: fields.get('handle'),
            displayName: fields.get('displayName'),
          });
          if (result.ok && result.data) {
            setAccount(result.data);
            form.reset();
          }
        }}
      >
        <div className="community-fields">
          <label>
            用户名
            <input
              ref={handleField}
              name="handle"
              minLength={3}
              maxLength={32}
              pattern="(?!gh_)[a-z][a-z0-9_]{2,31}"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <label>
            显示名称
            <input name="displayName" maxLength={120} required />
          </label>
        </div>
        <div className="community-actions">
          <button
            className="community-button"
            type="submit"
            disabled={mutation.pending || !!code}
          >
            开通账户
          </button>
          <MutationMessage
            error={mutation.error}
            success={account && `已开通 @${account.principal.handle}。`}
          />
        </div>
        {account && (
          <p className="community-meta">
            所有者用户名 <code>{account.principal.handle}</code>
          </p>
        )}
      </form>
      {code && account && (
        <OneTimeSecret
          value={code}
          label="普通账户激活码"
          noun="激活码"
          help={`激活码只显示一次。请将用户名和激活码安全地交给账户持有人，由其在账户页设置密码。${Number.isFinite(expiry) ? `有效期至 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(expiry)}。` : ''}`}
          dismiss={() => {
            setAccount({ ...account, activationCode: undefined });
            handleField.current?.focus();
          }}
        />
      )}
    </>
  );
}
