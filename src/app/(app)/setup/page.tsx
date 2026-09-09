import Link from 'next/link';
import { prisma } from '@/lib/db';
import { configStatus } from '@/lib/env';
import { getGateway } from '@/lib/up/gateway';
import { UpApiError } from '@/lib/up/client';
import { getMappedAccounts, getSalaryRules, getSetupState, getSettings } from '@/lib/services/settings';
import { allRoleDefinitions, defaultIsDiscretionary, defaultIsProtected, roleLabel } from '@/lib/domain/roles';
import { formatCents } from '@/lib/money';
import { formatDate } from '@/lib/time';
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Money,
  Notice,
  Pill,
  Select,
  Why,
} from '@/components/ui';
import {
  importHistoryAction,
  saveAccountMappingAction,
  saveSalaryRuleAction,
  syncAction,
  syncNotionAction,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

/**
 * First-run setup.
 *
 * Five steps, each of which can be revisited later. The steps are ordered by
 * dependency rather than by ceremony: nothing downstream is meaningful until
 * the accounts have roles, and nothing at all is meaningful until the
 * connection works.
 */
export default async function SetupPage() {
  const status = configStatus();
  const [state, accounts, settings, salaryRules, salaryCount, txCount] = await Promise.all([
    getSetupState(),
    getMappedAccounts(),
    getSettings(),
    getSalaryRules(),
    prisma.transaction.count({ where: { isSalary: true } }),
    prisma.transaction.count(),
  ]);

  // Step 1: prove the connection works before anything else.
  let ping: { ok: boolean; message: string } = { ok: false, message: '' };
  try {
    const gateway = getGateway();
    const result = await gateway.ping();
    ping = {
      ok: true,
      message: gateway.isMock
        ? 'Mock mode is on. No real bank is connected, and no token is needed.'
        : `Connected. Up answered with ${result.emoji}.`,
    };
  } catch (error) {
    ping = {
      ok: false,
      message:
        error instanceof UpApiError
          ? error.userMessage
          : 'Could not reach Up. Check UP_API_TOKEN, or turn on USE_MOCK_DATA.',
    };
  }

  const roleDefs = allRoleDefinitions();
  const salaryExamples = await prisma.transaction.findMany({
    where: { amountCents: { gt: settings.salaryMinCents }, isInternalTransfer: false, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 6,
    distinct: ['description'],
  });

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
        <p className="mt-1 text-sm text-muted">
          Five steps. Everything here can be changed later in Settings.
        </p>
      </header>

      {/* Step 1 */}
      <Card>
        <CardHeader title="1. Connection" />
        <div className="flex items-start gap-2">
          <Pill tone={ping.ok ? 'ontrack' : 'attention'}>{ping.ok ? 'Connected' : 'Not connected'}</Pill>
        </div>
        <p className="mt-2 text-sm text-muted">{ping.message}</p>

        {!ping.ok ? (
          <Notice tone="notice" title="Getting a token">
            <p>
              Sign in at{' '}
              <a
                href="https://api.up.com.au/getting_started"
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                api.up.com.au/getting_started
              </a>{' '}
              and generate a personal access token. Put it in <code>UP_API_TOKEN</code> in{' '}
              <code>.env</code> and restart.
            </p>
            <p className="mt-2">
              The token stays on the server. It is never sent to the browser, never written to the
              database, and is stripped out of every error message.
            </p>
          </Notice>
        ) : null}
      </Card>

      {/* Step 2 */}
      <Card>
        <CardHeader
          title="2. What each account is for"
          hint="Account names are yours to change, so nothing here reads them. Map each one to a role."
          action={
            <form action={syncAction}>
              <Button type="submit" variant="secondary">
                Load accounts
              </Button>
            </form>
          }
        />

        {accounts.length === 0 ? (
          <p className="text-sm text-muted">
            No accounts loaded yet. Press Load accounts, which runs a sync.
          </p>
        ) : (
          <form action={saveAccountMappingAction} className="space-y-3">
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <li key={account.accountId} className="py-3 first:pt-0">
                  <input type="hidden" name="accountId" value={account.accountId} />

                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{account.displayName}</p>
                      <p className="text-xs text-faint">
                        {account.accountType === 'TRANSACTIONAL' ? 'Transaction account' : 'Saver'}
                      </p>
                    </div>
                    <Money cents={account.balanceCents} className="shrink-0 font-medium" />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Select
                      name={`role:${account.accountId}`}
                      defaultValue={account.role ?? ''}
                      aria-label={`Role for ${account.displayName}`}
                      className="w-52"
                    >
                      <option value="">Not mapped</option>
                      {roleDefs.map((def) => (
                        <option key={def.role} value={def.role}>
                          {def.label}
                        </option>
                      ))}
                    </Select>

                    <label className="flex items-center gap-1.5 text-sm text-muted">
                      <input
                        type="checkbox"
                        name={`protected:${account.accountId}`}
                        defaultChecked={
                          account.role ? account.isProtected || defaultIsProtected(account.role) : false
                        }
                      />
                      Protected
                    </label>

                    <label className="flex items-center gap-1.5 text-sm text-muted">
                      <input
                        type="checkbox"
                        name={`discretionary:${account.accountId}`}
                        defaultChecked={
                          account.role
                            ? account.isDiscretionary || defaultIsDiscretionary(account.role)
                            : false
                        }
                      />
                      Everyday spending
                    </label>
                  </div>
                </li>
              ))}
            </ul>

            <Button type="submit">Save mapping</Button>

            <Why label="What do protected and everyday spending mean?">
              <p>
                <span className="font-medium text-ink">Protected.</span> The balance never counts as
                money available to spend, and any transfer out raises something to look at. Emergency
                and Future Options should both be protected.
              </p>
              <p>
                <span className="font-medium text-ink">Everyday spending.</span> Counts toward safe
                to spend. Dining, Fun, Gear and Buffer by default. Travel deliberately does not,
                because Travel is for travel.
              </p>
            </Why>
          </form>
        )}
      </Card>

      {/* Step 3 */}
      <Card>
        <CardHeader
          title="3. Which payment is your salary"
          hint="Pay cycles are worked out from this, so it matters more than anything else here."
        />

        <div className="flex items-center gap-2">
          <Pill tone={salaryCount > 0 ? 'ontrack' : 'notice'}>
            {salaryCount > 0 ? `${salaryCount} found` : 'None found yet'}
          </Pill>
        </div>

        <ul className="mt-3 divide-y divide-line">
          {salaryRules.map((rule) => (
            <li key={rule.id} className="py-2 first:pt-0">
              <form action={saveSalaryRuleAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={rule.id} />
                <div className="min-w-[10rem] flex-1">
                  <Field label="Matches text" htmlFor={`pattern-${rule.id}`}>
                    <Input id={`pattern-${rule.id}`} name="pattern" defaultValue={rule.pattern} />
                  </Field>
                </div>
                <div className="w-32">
                  <Field label="How" htmlFor={`match-${rule.id}`}>
                    <Select id={`match-${rule.id}`} name="matchType" defaultValue={rule.matchType}>
                      <option value="CONTAINS">Contains</option>
                      <option value="EXACT">Exactly</option>
                      <option value="REGEX">Regex</option>
                    </Select>
                  </Field>
                </div>
                <div className="w-28">
                  <Field label="At least" htmlFor={`min-${rule.id}`}>
                    <Input
                      id={`min-${rule.id}`}
                      name="minCents"
                      inputMode="decimal"
                      defaultValue={rule.minCents !== null ? (rule.minCents / 100).toFixed(2) : ''}
                    />
                  </Field>
                </div>
                <input type="hidden" name="label" value={rule.label} />
                <input type="hidden" name="priority" value={rule.priority} />
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </form>
            </li>
          ))}
        </ul>

        <details className="group mt-3 border-t border-line pt-3">
          <summary className="text-sm font-medium text-accent hover:underline">Add a rule</summary>
          <form action={saveSalaryRuleAction} className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[10rem] flex-1">
              <Field label="Label" htmlFor="new-salary-label">
                <Input id="new-salary-label" name="label" placeholder="e.g. New employer" required />
              </Field>
            </div>
            <div className="min-w-[10rem] flex-1">
              <Field label="Matches text" htmlFor="new-salary-pattern">
                <Input id="new-salary-pattern" name="pattern" required />
              </Field>
            </div>
            <div className="w-32">
              <Field label="How" htmlFor="new-salary-match">
                <Select id="new-salary-match" name="matchType" defaultValue="CONTAINS">
                  <option value="CONTAINS">Contains</option>
                  <option value="EXACT">Exactly</option>
                  <option value="REGEX">Regex</option>
                </Select>
              </Field>
            </div>
            <Button type="submit">Add</Button>
          </form>
        </details>

        {salaryExamples.length > 0 ? (
          <Why label="Large credits in your history">
            <p>Anything here that is your pay should be matched by a rule above.</p>
            <ul className="mt-1 space-y-1">
              {salaryExamples.map((tx) => (
                <li key={tx.id} className="flex justify-between gap-3">
                  <span>{tx.description}</span>
                  <span className="tabular">{formatCents(tx.amountCents)}</span>
                </li>
              ))}
            </ul>
          </Why>
        ) : null}
      </Card>

      {/* Step 4 */}
      <Card>
        <CardHeader
          title="4. Import history"
          hint="Six months gives the detectors enough to work with. Longer is fine."
        />

        <div className="flex items-center gap-2">
          <Pill tone={txCount > 0 ? 'ontrack' : 'neutral'}>
            {txCount > 0 ? `${txCount} transactions` : 'Nothing imported'}
          </Pill>
        </div>

        <form action={importHistoryAction} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-32">
            <Field label="Months" htmlFor="months">
              <Input
                id="months"
                name="months"
                type="number"
                min={1}
                max={24}
                defaultValue={settings.historicalImportMonths}
              />
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            Import
          </Button>
        </form>

        <p className="mt-2 text-sm text-muted">
          Safe to run more than once. Transactions are keyed by their Up id, so re-importing
          updates rather than duplicates.
        </p>
      </Card>

      {/* Step 5 */}
      <Card>
        <CardHeader
          title="5. Notion (optional)"
          hint="Your wishlist page. Read-only, and the app works without it."
        />

        <div className="flex items-center gap-2">
          <Pill tone={status.notionConfigured ? 'ontrack' : 'neutral'}>
            {status.notionConfigured ? 'Connected' : 'Not connected'}
          </Pill>
          {settings.notionLastSyncAt ? (
            <span className="text-xs text-faint">
              Last synced {formatDate(settings.notionLastSyncAt, settings.timezone)}
            </span>
          ) : null}
        </div>

        {status.notionConfigured ? (
          <form action={syncNotionAction} className="mt-3">
            <Button type="submit" variant="secondary">
              Sync Notion now
            </Button>
          </form>
        ) : (
          <Notice tone="neutral">
            <p>
              Create an internal integration at{' '}
              <a
                href="https://www.notion.so/my-integrations"
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                notion.so/my-integrations
              </a>
              , share your wishlist page with it, then set <code>NOTION_TOKEN</code> and{' '}
              <code>NOTION_PAGE_ID</code>.
            </p>
            <p className="mt-2">
              Until then the Shopping screen uses a local list, which behaves identically.
            </p>
          </Notice>
        )}
      </Card>

      {/* Where we are. */}
      <Card>
        <CardHeader title="Status" />
        {state.complete ? (
          <Notice tone="ontrack" title="Setup is finished">
            <p>
              Everything is mapped and a salary has been found.{' '}
              <Link href="/today" className="font-medium text-accent hover:underline">
                Go to Today
              </Link>
              .
            </p>
          </Notice>
        ) : (
          <ul className="space-y-1.5 text-sm text-muted">
            {state.missing.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
