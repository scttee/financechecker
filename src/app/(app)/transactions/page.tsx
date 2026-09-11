import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/services/settings';
import { allRoleDefinitions, roleLabel } from '@/lib/domain/roles';
import { formatCents } from '@/lib/money';
import { formatDateTime } from '@/lib/time';
import {
  Button,
  Card,
  CardHeader,
  Empty,
  Field,
  Input,
  Money,
  Pill,
  PageTitle,
  Select,
  Why,
} from '@/components/ui';
import { setTransactionRoleAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const ROLE_SOURCE_TEXT: Record<string, string> = {
  UNRESOLVED: 'Not assigned to a bucket yet.',
  ACCOUNT: 'Assigned from the account the money came out of.',
  MERCHANT_RULE: 'Assigned by one of your merchant rules.',
  UP_CATEGORY: "Assigned from Up's own category.",
  TAG: 'Assigned from a tag on the transaction.',
  MANUAL: 'Assigned by you. Syncs will not change it.',
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const settings = await getSettings();

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const search = (params.q ?? '').trim();

  const where: Prisma.TransactionWhereInput = { deletedAt: null };

  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { rawText: { contains: search, mode: 'insensitive' } },
      { message: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (params.account) where.accountId = params.account;
  if (params.role) where.role = params.role as never;
  if (params.cycle) where.payCycleId = params.cycle;
  if (params.tag) where.tags = { some: { tag: params.tag } };
  if (params.needsReview === '1') where.needsReview = true;
  if (params.transfers === '1') where.isInternalTransfer = true;
  if (params.transfers === '0') where.isInternalTransfer = false;
  if (params.min) where.amountCents = { lte: -Math.round(Number(params.min) * 100) };
  if (params.from || params.to) {
    where.createdAt = {
      ...(params.from ? { gte: new Date(`${params.from}T00:00:00`) } : {}),
      ...(params.to ? { lte: new Date(`${params.to}T23:59:59`) } : {}),
    };
  }

  // Leakage is a property of a finding rather than of a transaction, so the
  // filter resolves ids first.
  if (params.leakage === '1') {
    const events = await prisma.leakageEvent.findMany({
      select: { transferTransactionId: true, spendTransactionIds: true },
    });
    const ids = events.flatMap((e) => [e.transferTransactionId, ...e.spendTransactionIds]);
    where.id = { in: ids.length > 0 ? ids : ['none'] };
  }
  if (params.recurring === '1') {
    const merchants = await prisma.recurringMerchant.findMany({ select: { displayName: true } });
    where.description = { in: merchants.map((m) => m.displayName) };
  }

  const [rows, total, accounts, cycles, tags] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { account: { include: { mapping: true } }, tags: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.transaction.count({ where }),
    prisma.account.findMany({ include: { mapping: true }, orderBy: { displayName: 'asc' } }),
    prisma.payCycle.findMany({ orderBy: { startAt: 'desc' }, take: 12 }),
    prisma.transactionTag.findMany({ distinct: ['tag'], select: { tag: true }, orderBy: { tag: 'asc' } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <PageTitle sub="Find a payment, understand its bucket, or review an assignment.">Transactions</PageTitle>
      <Card>
        <CardHeader title="Filters" hint={`${total} ${total === 1 ? 'transaction' : 'transactions'}`} />

        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Search" htmlFor="q">
              <Input id="q" name="q" defaultValue={search} placeholder="Merchant or description" />
            </Field>
          </div>

          <Field label="Pay cycle" htmlFor="cycle">
            <Select id="cycle" name="cycle" defaultValue={params.cycle ?? ''}>
              <option value="">Any</option>
              {cycles.map((cycle, index) => (
                <option key={cycle.id} value={cycle.id}>
                  {index === 0 ? 'This cycle' : formatDateTime(cycle.startAt, settings.timezone)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Account" htmlFor="account">
            <Select id="account" name="account" defaultValue={params.account ?? ''}>
              <option value="">Any</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.mapping?.displayName ?? account.displayName}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Bucket" htmlFor="role">
            <Select id="role" name="role" defaultValue={params.role ?? ''}>
              <option value="">Any</option>
              {allRoleDefinitions().map((def) => (
                <option key={def.role} value={def.role}>
                  {def.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tag" htmlFor="tag">
            <Select id="tag" name="tag" defaultValue={params.tag ?? ''}>
              <option value="">Any</option>
              {tags.map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={params.from ?? ''} />
          </Field>

          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={params.to ?? ''} />
          </Field>

          <Field label="At least ($ spent)" htmlFor="min">
            <Input id="min" name="min" inputMode="decimal" defaultValue={params.min ?? ''} />
          </Field>

          <Field label="Kind" htmlFor="transfers">
            <Select id="transfers" name="transfers" defaultValue={params.transfers ?? ''}>
              <option value="">Everything</option>
              <option value="0">Spending only</option>
              <option value="1">Internal transfers only</option>
            </Select>
          </Field>

          <Field label="Show" htmlFor="special">
            <div className="flex flex-wrap gap-3 pt-1.5 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="needsReview"
                  value="1"
                  defaultChecked={params.needsReview === '1'}
                />
                Needs review
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="leakage"
                  value="1"
                  defaultChecked={params.leakage === '1'}
                />
                Leakage
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="recurring"
                  value="1"
                  defaultChecked={params.recurring === '1'}
                />
                Recurring
              </label>
            </div>
          </Field>

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit">Apply</Button>
            <Link
              href="/transactions"
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted hover:bg-track hover:text-ink"
            >
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Empty title="Nothing matches" body="Try widening the filters, or clear them and start again." />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((tx) => (
              <li key={tx.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{tx.description}</p>
                    <p className="mt-0.5 text-xs text-faint">
                      {formatDateTime(tx.createdAt, settings.timezone)} ·{' '}
                      {tx.account.mapping?.displayName ?? tx.account.displayName}
                      {tx.status === 'HELD' ? ' · held' : ''}
                    </p>
                  </div>
                  <Money
                    cents={tx.amountCents}
                    showSign
                    className={
                      tx.amountCents > 0 ? 'shrink-0 font-medium text-ontrack' : 'shrink-0 font-medium'
                    }
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {tx.isSalary ? <Pill tone="ontrack">Salary</Pill> : null}
                  {tx.isInternalTransfer ? <Pill tone="protected">Transfer</Pill> : null}
                  {tx.role ? <Pill tone="neutral">{roleLabel(tx.role)}</Pill> : null}
                  {tx.needsReview ? <Pill tone="notice">Needs review</Pill> : null}
                  {tx.tags.map((tag) => (
                    <Pill key={tag.id} tone="neutral" className="normal-case tracking-normal">
                      {tag.tag}
                    </Pill>
                  ))}
                </div>

                <Why label="Details">
                  <p>{ROLE_SOURCE_TEXT[tx.roleSource] ?? ''}</p>
                  {tx.heldAmountCents !== null && tx.heldAmountCents !== tx.amountCents ? (
                    <p>
                      Held at {formatCents(Math.abs(tx.heldAmountCents))}, settled at{' '}
                      {formatCents(Math.abs(tx.amountCents))}.
                    </p>
                  ) : null}
                  {tx.transferAccountId ? (
                    <p>
                      Moved{' '}
                      {tx.amountCents < 0
                        ? `out of ${tx.account.mapping?.displayName ?? tx.account.displayName}`
                        : `into ${tx.account.mapping?.displayName ?? tx.account.displayName}`}
                      .
                    </p>
                  ) : null}
                  {tx.message ? <p>Message: {tx.message}</p> : null}

                  <form action={setTransactionRoleAction} className="mt-2 flex items-end gap-2">
                    <input type="hidden" name="transactionId" value={tx.id} />
                    <div className="w-48">
                      <Field label="Bucket" htmlFor={`role-${tx.id}`}>
                        <Select id={`role-${tx.id}`} name="role" defaultValue={tx.role ?? ''}>
                          <option value="">Unassigned</option>
                          {allRoleDefinitions().map((def) => (
                            <option key={def.role} value={def.role}>
                              {def.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Button type="submit" variant="secondary">
                      Set
                    </Button>
                  </form>
                </Why>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <PageLink params={params} page={page - 1} disabled={page <= 1}>
                Previous
              </PageLink>
              <span className="tabular text-sm text-muted">
                Page {page} of {pages}
              </span>
              <PageLink params={params} page={page + 1} disabled={page >= pages}>
                Next
              </PageLink>
            </nav>
          ) : null}
        </Card>
      )}
    </div>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: Record<string, string | undefined>;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-sm text-faint">{children}</span>;
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'page') query.set(key, value);
  }
  query.set('page', String(page));
  return (
    <Link href={`/transactions?${query.toString()}`} className="text-sm font-medium text-accent hover:underline">
      {children}
    </Link>
  );
}
