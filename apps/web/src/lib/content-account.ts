import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAccount, sessionCookies } from './account';

export async function requireContentAccount() {
  const cookies = sessionCookies((await headers()).get('cookie'));
  if (!cookies) redirect('/account');
  const account = await getAccount(cookies);
  if (account.status !== 'signed-in') redirect('/account');
  return { cookies, profile: account.profile };
}
