import { redirect } from 'next/navigation';

export default async function AgentAdmin({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect('/admin/agents?agent=' + encodeURIComponent(id));
}
