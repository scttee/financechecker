import { prisma } from '@/lib/db';
import { getBalancesByRole, getSettings } from '@/lib/services/settings';
import { getGoalPlans } from '@/lib/services/planning';
import { getPlanningAiInsight } from '@/lib/services/aiInsight';
import { configStatus } from '@/lib/env';
import { formatCents } from '@/lib/money';
import { formatDate, toDateInputValue } from '@/lib/time';
import {
  Button,
  Card,
  CardHeader,
  Field,
  Figure,
  Input,
  Money,
  Notice,
  Pill,
  Progress,
  Why,
} from '@/components/ui';
import { addAssetSnapshotAction, addExternalAssetAction, regeneratePlanningInsightAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ aiError?: string }>;
}) {
  const params = await searchParams;
  const [settings, goals, balances, assets, plans, planningInsight] = await Promise.all([
    getSettings(),
    prisma.financialGoal.findMany({ orderBy: { sortOrder: 'asc' } }),
    getBalancesByRole(),
    prisma.externalAsset.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { snapshots: { orderBy: { takenAt: 'desc' }, take: 12 } },
    }),
    getGoalPlans(),
    getPlanningAiInsight(),
  ]);
  const status = configStatus();
  const plansByKey = new Map(plans.map((p) => [p.key, p]));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [investedThisMonth, investedThisYear, travelIn, gearIn] = await Promise.all([
    investedSince(monthStart),
    investedSince(yearStart),
    contributionsSince('TRAVEL', monthStart),
    contributionsSince('GEAR_OBJECTS', monthStart),
  ]);

  return (
    <div className="space-y-3">
      {params.aiError ? (
        <Notice tone="notice" title="Claude did not answer">
          <p>{params.aiError}</p>
        </Notice>
      ) : null}

      {/* Planning. When each goal is funded at the plan's current rate —
          the forward-looking question the rest of this page doesn't answer,
          because everywhere else is deliberately about right now. */}
      {status.aiConfigured || planningInsight ? (
        <Card>
          <CardHeader title="Planning" hint="When each goal is funded at the plan's current rate." />
          {planningInsight ? (
            <>
              <p className="text-sm leading-relaxed">{planningInsight.narrative}</p>
              <p className="mt-3 text-xs text-faint">
                Generated {formatDate(planningInsight.generatedAt, settings.timezone)} · {planningInsight.model} ·
                about {planningInsight.costCents < 1 ? '<1¢' : `${Math.round(planningInsight.costCents)}¢`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">Not generated yet.</p>
          )}
          {status.aiConfigured ? (
            <form action={regeneratePlanningInsightAction} className="mt-3">
              <Button type="submit" variant="secondary">
                {planningInsight ? 'Regenerate' : 'Ask Claude'}
              </Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      {goals.map((goal) => {
        const balance = balances.get(goal.role) ?? 0;
        const pct = goal.targetCents > 0 ? Math.min(100, Math.round((balance / goal.targetCents) * 100)) : 0;
        const remaining = Math.max(0, goal.targetCents - balance);
        const plan = plansByKey.get(goal.key);

        return (
          <Card key={goal.id}>
            <CardHeader
              title={goal.name}
              action={goal.reachedAt ? <Pill tone="ontrack">Reached</Pill> : <Pill tone="protected">Protected</Pill>}
            />
            <p className="tabular text-figure">
              {formatCents(balance, { showCents: false })}
              <span className="ml-2 text-lg font-normal text-muted">
                / {formatCents(goal.targetCents, { showCents: false })}
              </span>
            </p>
            <Progress
              className="mt-3"
              value={pct}
              tone={goal.reachedAt ? 'ontrack' : 'protected'}
              label={`${goal.name} progress`}
            />
            <p className="mt-2 text-sm text-muted">
              {goal.reachedAt
                ? `Reached ${formatDate(goal.reachedAt, settings.timezone)}. This is now a floor, not a target.`
                : `${pct}% there. ${formatCents(remaining)} to go.`}
            </p>

            {!goal.reachedAt && plan ? (
              <p className="mt-1 text-sm text-muted">
                {plan.projection.projectedDate
                  ? `At the current rate (${formatCents(plan.projection.perCycleCents)} a cycle), around ${formatDate(plan.projection.projectedDate, settings.timezone)}.`
                  : 'The current phase sends nothing here, so there is no projected date.'}
              </p>
            ) : null}

            <Why>
              {goal.key === 'emergency' ? (
                <>
                  <p>
                    Emergency is defensive. It is not for gear, not for travel, not for routine
                    bills, and not for covering an overspend.
                  </p>
                  <p>
                    While it is below {formatCents(goal.targetCents, { showCents: false })}, the
                    plan runs Phase 1 and sends 20% of post-rent income here. Once it is reached,
                    that 20% moves to Investing and Future Options, and this balance becomes a hard
                    floor.
                  </p>
                  {goal.reachedAt && balance < goal.targetCents ? (
                    <p className="text-attention">
                      It is currently below the floor. The plan stays in Phase 2 rather than
                      quietly reverting, because that is a thing to look at rather than to work
                      around.
                    </p>
                  ) : null}
                </>
              ) : (
                <p>
                  Future Options is the price of being able to say no. Career change, study,
                  relocation, moving, a break. It is not for ordinary shopping.
                </p>
              )}
            </Why>
          </Card>
        );
      })}

      {/* Purpose-built Savers. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader title="Travel" hint="Travel only. Never gear, never everyday life." />
          <Figure cents={balances.get('TRAVEL') ?? 0} size="md" />
          <p className="mt-2 text-sm text-muted">
            <Money cents={travelIn} showSign className="text-ink" /> in this month.
          </p>
        </Card>

        <Card>
          <CardHeader title="Gear & Objects" hint="5% of post-rent income. Nothing borrowed." />
          <Figure cents={balances.get('GEAR_OBJECTS') ?? 0} size="md" />
          <p className="mt-2 text-sm text-muted">
            <Money cents={gearIn} showSign className="text-ink" /> in this month.
          </p>
          <Why>
            <p>
              Gear never borrows from Travel, Emergency or Future Options. If there is not enough
              in here for something, the answer is not yet rather than no.
            </p>
          </Why>
        </Card>
      </div>

      {/* Investing. */}
      <Card>
        <CardHeader
          title="Long-term investing"
          hint="Contributions only. This app does not know market values and will not pretend to."
        />
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <p className="text-sm text-muted">Contributed this month</p>
            <p className="tabular text-figure-sm">{formatCents(investedThisMonth)}</p>
          </div>
          <div>
            <p className="text-sm text-muted">Contributed this year</p>
            <p className="tabular text-figure-sm">{formatCents(investedThisYear)}</p>
          </div>
        </div>
        <Why>
          <p>
            Counted from transactions resolved to the Investing bucket, which is normally a
            merchant rule matching your broker. Adjust the rule in Settings if something is being
            missed.
          </p>
          <p>
            No holdings, no unit prices, no performance figures. Up does not know them, so neither
            does this.
          </p>
        </Why>
      </Card>

      {/* External assets. */}
      <Card>
        <CardHeader
          title="External balances"
          hint="Super and brokerage, entered by hand. For trend, not for minute-by-minute accuracy."
        />

        {assets.length === 0 ? (
          <p className="text-sm text-muted">Nothing tracked yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {assets.map((asset) => {
              const latest = asset.snapshots[0];
              const previous = asset.snapshots[1];
              const change = latest && previous ? latest.balanceCents - previous.balanceCents : null;

              return (
                <li key={asset.id} className="py-3 first:pt-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{asset.name}</p>
                      {asset.provider ? (
                        <p className="text-xs text-faint">{asset.provider}</p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="tabular font-semibold">
                        {latest ? formatCents(latest.balanceCents, { showCents: false }) : '—'}
                      </p>
                      {latest ? (
                        <p className="text-xs text-faint">
                          {formatDate(latest.takenAt, settings.timezone)}
                          {change !== null ? (
                            <>
                              {' · '}
                              <span className={change >= 0 ? 'text-ontrack' : 'text-notice'}>
                                {formatCents(change, { showSign: true, showCents: false })}
                              </span>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <details className="group mt-2">
                    <summary className="text-sm font-medium text-accent hover:underline">
                      Add a snapshot
                    </summary>
                    <form action={addAssetSnapshotAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="assetId" value={asset.id} />
                      <div className="w-32">
                        <Field label="Balance" htmlFor={`balance-${asset.id}`}>
                          <Input
                            id={`balance-${asset.id}`}
                            name="balance"
                            inputMode="decimal"
                            placeholder="0.00"
                            required
                          />
                        </Field>
                      </div>
                      <div className="w-40">
                        <Field label="Date" htmlFor={`date-${asset.id}`}>
                          <Input
                            id={`date-${asset.id}`}
                            name="takenAt"
                            type="date"
                            defaultValue={toDateInputValue(now, settings.timezone)}
                          />
                        </Field>
                      </div>
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        <details className="group mt-4 border-t border-line pt-3">
          <summary className="text-sm font-medium text-accent hover:underline">
            Track something else
          </summary>
          <form action={addExternalAssetAction} className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <Field label="Name" htmlFor="asset-name">
                <Input id="asset-name" name="name" placeholder="e.g. Vanguard" required />
              </Field>
            </div>
            <div className="min-w-[10rem] flex-1">
              <Field label="Provider" htmlFor="asset-provider">
                <Input id="asset-provider" name="provider" placeholder="Optional" />
              </Field>
            </div>
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        </details>

        <Notice tone="neutral">
          These are typed in by hand and are only as current as the last time you updated them. The
          point is the shape of the trend, not the decimal place.
        </Notice>
      </Card>
    </div>
  );
}

async function investedSince(since: Date): Promise<number> {
  const result = await prisma.transaction.aggregate({
    where: {
      createdAt: { gte: since },
      role: 'INVESTING',
      amountCents: { lt: 0 },
      isInternalTransfer: false,
      deletedAt: null,
    },
    _sum: { amountCents: true },
  });
  return Math.abs(result._sum.amountCents ?? 0);
}

async function contributionsSince(
  role: 'TRAVEL' | 'GEAR_OBJECTS',
  since: Date,
): Promise<number> {
  const mapping = await prisma.accountRoleMapping.findFirst({ where: { role } });
  if (!mapping) return 0;

  const result = await prisma.transaction.aggregate({
    where: {
      createdAt: { gte: since },
      accountId: mapping.accountId,
      isInternalTransfer: true,
      amountCents: { gt: 0 },
      deletedAt: null,
    },
    _sum: { amountCents: true },
  });
  return result._sum.amountCents ?? 0;
}
