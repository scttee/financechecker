import { getWishlistWithDecisions } from '@/lib/services/wishlist';
import { getCurrentCycleView } from '@/lib/services/overview';
import { getBalancesByRole, getSettings } from '@/lib/services/settings';
import { notionConfigured } from '@/lib/notion/client';
import { PRIORITY_LABEL, describeWait } from '@/lib/domain/buyIt';
import { roleLabel } from '@/lib/domain/roles';
import { formatCents } from '@/lib/money';
import { formatDate } from '@/lib/time';
import {
  Button,
  Card,
  CardHeader,
  PageTitle,
  Field,
  Input,
  Money,
  Notice,
  Pill,
  Select,
  Why,
  type PillTone,
} from '@/components/ui';
import {
  archiveWishlistItemAction,
  recordPurchaseDecisionAction,
  saveWishlistItemAction,
  syncNotionAction,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

const VERDICT_TONE: Record<string, PillTone> = {
  BUY: 'ontrack',
  WAIT: 'notice',
  NOT_FUNDED: 'attention',
  NEEDS_INFORMATION: 'neutral',
};

export default async function ShoppingPage() {
  const [rows, balances, settings, cycle] = await Promise.all([
    getWishlistWithDecisions(),
    getBalancesByRole(),
    getSettings(),
    getCurrentCycleView(),
  ]);

  const gearBalance = balances.get('GEAR_OBJECTS') ?? 0;
  const gearLine = cycle?.categories.find((c) => c.role === 'GEAR_OBJECTS') ?? null;
  const considering = rows.filter((r) => r.item.status === 'CONSIDERING');
  const elsewhere = rows.filter((r) => r.item.status !== 'CONSIDERING');
  const notion = notionConfigured();

  return (
    <div className="space-y-5">
      <PageTitle sub="A place for things you want, with room to decide when they fit.">Considered purchases</PageTitle>
      <Card>
        <CardHeader
          title="Gear & Objects"
          hint="The only Saver that funds things. Nothing here borrows from anywhere else."
          action={
            notion ? (
              <form action={syncNotionAction}>
                <Button type="submit" variant="secondary">
                  Sync Notion
                </Button>
              </form>
            ) : null
          }
        />
        <p className="tabular text-figure">{formatCents(gearBalance)}</p>
        <p className="mt-1 text-sm text-muted">
          {considering.length} {considering.length === 1 ? 'item' : 'items'} under consideration.
        </p>

        {gearLine ? (
          <Why label="This differs from the Pay Cycle figure. Why?">
            <p>
              Two different things are being measured, and both are true.
            </p>
            <p>
              <span className="font-medium text-ink">{formatCents(gearBalance)}</span> is what the
              Gear Saver actually holds. It carries over from one fortnight to the next, which is
              how a $500 purchase ever becomes possible on a $152 fortnightly allocation.
            </p>
            <p>
              <span className="font-medium text-ink">
                {formatCents(gearLine.spentCents)} of {formatCents(gearLine.allocatedCents)}
              </span>{' '}
              is what has gone through Gear in this pay cycle. Pay Cycle reads
              {gearLine.remainingCents < 0
                ? ` ${formatCents(Math.abs(gearLine.remainingCents))} past the allocation`
                : ` ${formatCents(gearLine.remainingCents)} left`}
              , which is about pace rather than about what you can afford.
            </p>
            <p>
              Purchases are decided on the balance, because that is the money that exists. Pace is
              worth knowing, but it does not make a funded purchase unaffordable.
            </p>
          </Why>
        ) : null}

        {!notion ? (
          <Notice tone="neutral" title="Notion is not connected">
            Add NOTION_TOKEN and NOTION_PAGE_ID to connect your wishlist page. Until then this list
            is local, and works exactly the same way.
          </Notice>
        ) : settings.notionLastSyncAt ? (
          <p className="mt-3 text-xs text-faint">
            Last synced from Notion {formatDate(settings.notionLastSyncAt, settings.timezone)}.
            Notion stays the canonical list; this app only ever reads it.
          </p>
        ) : (
          <p className="mt-3 text-xs text-faint">
            Not synced from Notion yet. Press Sync Notion to read the wishlist page.
          </p>
        )}
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
      {considering.map(({ item, decision }) => (
        <Card key={item.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-medium leading-snug">{item.name}</h3>
              <p className="mt-0.5 text-sm text-muted">
                {item.priceCents !== null ? (
                  <Money cents={item.priceCents} className="font-medium text-ink" />
                ) : (
                  <span className="text-faint">{item.rawPrice ?? 'No price yet'}</span>
                )}
                {' · '}
                {PRIORITY_LABEL[item.priority]}
                {item.source === 'NOTION' ? ' · from Notion' : ''}
              </p>
            </div>
            <Pill tone={VERDICT_TONE[decision.verdict] ?? 'neutral'}>{decision.headline}</Pill>
          </div>

          <p className="mt-2.5 text-sm leading-relaxed">{decision.summary}</p>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-faint">{roleLabel(item.role)} balance</dt>
              <dd className="tabular font-medium">{formatCents(decision.saverBalanceCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Added</dt>
              <dd className="font-medium">{formatDate(item.addedAt, settings.timezone)}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Waiting period</dt>
              <dd className="font-medium">
                {decision.waitRequiredHours === 0 ? 'None' : describeWait(decision.waitRequiredHours)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Wait passed</dt>
              <dd className="font-medium">
                {decision.waitRequiredHours === 0 ||
                decision.waitElapsedHours >= decision.waitRequiredHours
                  ? 'Yes'
                  : 'No'}
              </dd>
            </div>
          </dl>

          <Why label="Why this answer?">
            <ol className="space-y-2">
              {decision.checks.map((check) => (
                <li key={check.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ink">{check.question}</span>
                    <span
                      className={
                        check.outcome === 'FAIL'
                          ? 'shrink-0 font-medium text-attention'
                          : check.outcome === 'PASS'
                            ? 'shrink-0 font-medium text-ontrack'
                            : 'shrink-0 font-medium text-muted'
                      }
                    >
                      {check.answer}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-faint">{check.detail}</p>
                </li>
              ))}
            </ol>
            <p className="mt-2 border-t border-line pt-2 text-xs leading-relaxed">
              These rules are fixed and inspectable. No model decides this, and the same inputs
              always give the same answer. Change the tiers in Settings if they are wrong for you.
            </p>
          </Why>

          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <form action={recordPurchaseDecisionAction} className="contents">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="status" value="ORDERED" />
              <Button type="submit" variant="secondary">
                Mark as ordered
              </Button>
            </form>
            <form action={archiveWishlistItemAction} className="contents">
              <input type="hidden" name="id" value={item.id} />
              <Button type="submit" variant="ghost">
                Remove
              </Button>
            </form>
          </div>

          <details className="group mt-2">
            <summary className="text-sm font-medium text-accent hover:underline">Edit</summary>
            <form action={saveWishlistItemAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={item.id} />
              <Field label="Name" htmlFor={`name-${item.id}`}>
                <Input id={`name-${item.id}`} name="name" defaultValue={item.name} required />
              </Field>
              <Field
                label="Price"
                htmlFor={`price-${item.id}`}
                hint="Leave blank if it is genuinely unknown. The answer becomes Needs information."
              >
                <Input
                  id={`price-${item.id}`}
                  name="price"
                  inputMode="decimal"
                  defaultValue={item.priceCents !== null ? (item.priceCents / 100).toFixed(2) : ''}
                />
              </Field>
              <Field label="Priority" htmlFor={`priority-${item.id}`}>
                <Select id={`priority-${item.id}`} name="priority" defaultValue={item.priority}>
                  {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Funded from" htmlFor={`role-${item.id}`}>
                <Select id={`role-${item.id}`} name="role" defaultValue={item.role}>
                  <option value="GEAR_OBJECTS">Gear & Objects</option>
                  <option value="FUN">Fun</option>
                  <option value="TRAVEL">Travel</option>
                  <option value="TRANSPORT">Transport</option>
                  <option value="HEALTH_THERAPY">Health & Therapy</option>
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes" htmlFor={`notes-${item.id}`}>
                  <Input id={`notes-${item.id}`} name="notes" defaultValue={item.notes ?? ''} />
                </Field>
              </div>
              <input type="hidden" name="status" value={item.status} />
              <div className="sm:col-span-2">
                <Button type="submit">Save</Button>
              </div>
            </form>
          </details>
        </Card>
      ))}

      </div>
      {considering.length === 0 ? <Card><CardHeader title="Room to consider something new" hint="Add an item below when something catches your eye. Your waiting period and funding checks will appear here." /></Card> : null}
      {elsewhere.length > 0 ? (
        <Card>
          <CardHeader title="Not under consideration" />
          <ul className="divide-y divide-line">
            {elsewhere.map(({ item }) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-sm">{item.name}</span>
                <Pill tone="neutral">{item.status.toLowerCase().replace(/_/g, ' ')}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Add something" hint="The waiting period starts from now." />
        <form action={saveWishlistItemAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="new-name">
            <Input id="new-name" name="name" placeholder="What is it?" required />
          </Field>
          <Field label="Price" htmlFor="new-price">
            <Input id="new-price" name="price" inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Priority" htmlFor="new-priority">
            <Select id="new-priority" name="priority" defaultValue="WANT">
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Funded from" htmlFor="new-role">
            <Select id="new-role" name="role" defaultValue="GEAR_OBJECTS">
              <option value="GEAR_OBJECTS">Gear & Objects</option>
              <option value="FUN">Fun</option>
              <option value="TRAVEL">Travel</option>
              <option value="TRANSPORT">Transport</option>
              <option value="HEALTH_THERAPY">Health & Therapy</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit">Add to the list</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="The rules" hint="Fixed, inspectable, and editable in Settings." />
        <ul className="space-y-1.5 text-sm text-muted">
          <li>
            Under {formatCents(settings.waitTier1MaxCents, { showCents: false })}: buy immediately
            if the correct Saver covers it.
          </li>
          <li>
            {formatCents(settings.waitTier1MaxCents, { showCents: false })} to{' '}
            {formatCents(settings.waitTier2MaxCents, { showCents: false })}:{' '}
            {describeWait(settings.waitTier2Hours)} wait.
          </li>
          <li>
            {formatCents(settings.waitTier2MaxCents, { showCents: false })} to{' '}
            {formatCents(settings.waitTier3MaxCents, { showCents: false })}:{' '}
            {describeWait(settings.waitTier3Hours)} wait.
          </li>
          <li>
            Over {formatCents(settings.waitTier3MaxCents, { showCents: false })}:{' '}
            {describeWait(settings.waitTier4Hours)} wait.
          </li>
          <li>A sale never shortens a waiting period.</li>
          <li>The correct Saver must cover 100% of the cost.</li>
          <li>Emergency, Travel and Future Options are never used to close a gap.</li>
        </ul>
      </Card>
    </div>
  );
}
