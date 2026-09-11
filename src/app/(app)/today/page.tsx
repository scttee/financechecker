import { getTodayView } from '@/lib/services/overview';
import { getSetupState } from '@/lib/services/settings';
import { getSavingsProjection } from '@/lib/services/savingsProjection';
import { Empty, LinkButton } from '@/components/ui';
import { TodayDashboard } from '@/components/TodayDashboard';

export const dynamic = 'force-dynamic';
export default async function TodayPage() {
  const setup = await getSetupState();
  if (!setup.hasAccounts) return <Empty title="Let’s get your picture ready" body="Connect your accounts and map them to your plan." action={<LinkButton href="/setup" variant="primary">Start setup</LinkButton>} />;
  const [view, savings] = await Promise.all([getTodayView(), getSavingsProjection()]);
  return <TodayDashboard view={view} savings={savings} setupComplete={setup.complete} />;
}
