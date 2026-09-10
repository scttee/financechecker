import Link from 'next/link';
import { prisma } from '@/lib/db';
import { appUrl, configStatus } from '@/lib/env';
import {
  getAllocationPercents,
  getMerchantRules,
  getSalaryRules,
  getSettings,
  strategyStatementOf,
} from '@/lib/services/settings';
import { validateAllocation } from '@/lib/domain/phases';
import { allRoleDefinitions, roleLabel } from '@/lib/domain/roles';
import { SUGGESTED_TAGS } from '@/lib/domain/merchantRules';
import { formatBasisPoints, formatCents } from '@/lib/money';
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Notice,
  Pill,
  Select,
  Textarea,
  Why,
} from '@/components/ui';
import {
  deleteMerchantRuleAction,
  deleteSalaryRuleAction,
  recalculateAction,
  saveAllocationAction,
  saveMerchantRuleAction,
  saveSalaryRuleAction,
  saveSettingsAction,
  saveStrategyStatementAction,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'plan', label: 'The plan' },
  { key: 'allocations', label: 'Percentages' },
  { key: 'salary', label: 'Salary' },
  { key: 'rules', label: 'Merchant rules' },
  { key: 'detection', label: 'Detection' },
  { key: 'shopping', label: 'Waiting periods' },
  { key: 'integrations', label: 'Integrations' },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string; saved?: string; phase?: string }>;
}) {
  const params = await searchParams;
  const tab = TABS.some((t) => t.key === params.tab) ? params.tab! : 'plan';

  const [settings, phase1, phase2, salaryRules, merchantRules, status] = await Promise.all([
    getSettings(),
    getAllocationPercents('PHASE_1'),
    getAllocationPercents('PHASE_2'),
    getSalaryRules(),
    getMerchantRules(),
    Promise.resolve(configStatus()),
  ]);

  const money = (cents: number) => (cents / 100).toFixed(2);

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Every financial assumption this app makes lives here, not in its source code.
        </p>
      </header>

      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
              t.key === tab ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-track hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {params.saved ? <Notice tone="ontrack">Saved.</Notice> : null}
      {params.error ? <Notice tone="attention">{params.error}</Notice> : null}

      {/* --- The plan --- */}
      {tab === 'plan' ? (
        <Card>
          <CardHeader title="The plan" />
          <form action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Rent per pay"
              htmlFor="rentCents"
              hint="Taken off the top of every pay before percentages are applied."
            >
              <Input id="rentCents" name="rentCents" inputMode="decimal" defaultValue={money(settings.rentCents)} />
            </Field>

            <Field label="Salary cadence" htmlFor="salaryCadence">
              <Select id="salaryCadence" name="salaryCadence" defaultValue={settings.salaryCadence}>
                <option value="WEEKLY">Weekly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="MONTHLY">Monthly</option>
              </Select>
            </Field>

            <Field
              label="Emergency target"
              htmlFor="emergencyTargetCents"
              hint="Reaching this moves the plan to Phase 2 and makes this balance a floor."
            >
              <Input
                id="emergencyTargetCents"
                name="emergencyTargetCents"
                inputMode="decimal"
                defaultValue={money(settings.emergencyTargetCents)}
              />
            </Field>

            <Field label="Future Options target" htmlFor="futureOptionsTargetCents">
              <Input
                id="futureOptionsTargetCents"
                name="futureOptionsTargetCents"
                inputMode="decimal"
                defaultValue={money(settings.futureOptionsTargetCents)}
              />
            </Field>

            <Field
              label="Typical salary"
              htmlFor="typicalSalaryCents"
              hint="Only used to project ahead before any real pay has been seen. Actual pays always win."
            >
              <Input
                id="typicalSalaryCents"
                name="typicalSalaryCents"
                inputMode="decimal"
                defaultValue={money(settings.typicalSalaryCents)}
              />
            </Field>

            <Field
              label="Minimum salary credit"
              htmlFor="salaryMinCents"
              hint="Credits below this are never treated as pay, so a reimbursement cannot start a cycle."
            >
              <Input
                id="salaryMinCents"
                name="salaryMinCents"
                inputMode="decimal"
                defaultValue={money(settings.salaryMinCents)}
              />
            </Field>

            <Field label="Timezone" htmlFor="timezone">
              <Input id="timezone" name="timezone" defaultValue={settings.timezone} />
            </Field>

            <Field label="Months of history to import" htmlFor="historicalImportMonths">
              <Input
                id="historicalImportMonths"
                name="historicalImportMonths"
                type="number"
                min={1}
                max={24}
                defaultValue={settings.historicalImportMonths}
              />
            </Field>

            <div className="sm:col-span-2">
              <Button type="submit">Save</Button>
            </div>
          </form>

          <div className="mt-4 border-t border-line pt-3">
            <p className="text-sm text-muted">
              Current phase:{' '}
              <Pill tone={settings.phase === 'PHASE_2' ? 'ontrack' : 'protected'}>
                {settings.phase === 'PHASE_1' ? 'Phase 1' : 'Phase 2'}
              </Pill>
            </p>
            <Why>
              <p>
                Phase 1 runs while Emergency is below{' '}
                {formatCents(settings.emergencyTargetCents, { showCents: false })} and sends 20% of
                post-rent income there.
              </p>
              <p>
                Phase 2 begins once it is reached: Emergency drops to 0%, and that 20% goes to
                Investing, Future Options and Travel.
              </p>
              <p>
                If the balance later dips below the floor the plan stays in Phase 2 and raises a
                notice, rather than quietly reverting and stopping your investing.
              </p>
            </Why>
          </div>
        </Card>
      ) : null}

      {tab === 'plan' ? (
        <Card>
          <CardHeader
            title="Strategy"
            hint="Shown on Health for context. Claude may note when something looks inconsistent with it — it never blocks anything."
          />
          <form action={saveStrategyStatementAction} className="space-y-2">
            <Textarea
              name="strategyStatement"
              rows={8}
              defaultValue={strategyStatementOf(settings)}
              aria-label="Strategy statement"
            />
            <Button type="submit" variant="secondary">
              Save
            </Button>
          </form>
        </Card>
      ) : null}

      {/* --- Percentages --- */}
      {tab === 'allocations' ? (
        <>
          {[
            { phase: 'PHASE_1' as const, rows: phase1, title: 'Phase 1 — while Emergency is building' },
            { phase: 'PHASE_2' as const, rows: phase2, title: 'Phase 2 — once Emergency is funded' },
          ].map(({ phase, rows, title }) => {
            const validation = validateAllocation(rows);
            return (
              <Card key={phase}>
                <CardHeader
                  title={title}
                  hint="Applied to post-rent income."
                  action={
                    <Pill tone={validation.ok ? 'ontrack' : 'attention'}>
                      {(validation.totalBasisPoints / 100).toFixed(2)}%
                    </Pill>
                  }
                />

                <form action={saveAllocationAction}>
                  <input type="hidden" name="phase" value={phase} />
                  <ul className="divide-y divide-line">
                    {rows.map((row) => (
                      <li key={row.role} className="flex items-center justify-between gap-3 py-2">
                        <label htmlFor={`${phase}-${row.role}`} className="text-sm">
                          {roleLabel(row.role)}
                        </label>
                        <div className="flex items-center gap-1.5">
                          <Input
                            id={`${phase}-${row.role}`}
                            name={`pct:${row.role}`}
                            inputMode="decimal"
                            defaultValue={(row.basisPoints / 100).toString()}
                            className="w-20 text-right"
                          />
                          <span className="text-sm text-muted">%</span>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {!validation.ok ? (
                    <div className="mt-3">
                      <Notice tone="attention">{validation.message}</Notice>
                    </div>
                  ) : null}

                  <div className="mt-3">
                    <Button type="submit">Save {phase === 'PHASE_1' ? 'Phase 1' : 'Phase 2'}</Button>
                  </div>
                </form>

                <Why label="Why must this be exactly 100%?">
                  <p>
                    Anything less and part of your pay belongs to no bucket, so safe-to-spend and
                    every category figure would be measured against a plan that does not account
                    for all the money.
                  </p>
                  <p>
                    Percentages are stored as whole basis points, so this check is exact rather
                    than a floating-point approximation.
                  </p>
                </Why>
              </Card>
            );
          })}
        </>
      ) : null}

      {/* --- Salary --- */}
      {tab === 'salary' ? (
        <Card>
          <CardHeader
            title="Salary rules"
            hint="How pay is recognised. Nothing about your employer is hard-coded anywhere."
          />

          <ul className="divide-y divide-line">
            {salaryRules.map((rule) => (
              <li key={rule.id} className="py-3 first:pt-0">
                <form action={saveSalaryRuleAction} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="id" value={rule.id} />
                  <Field label="Label" htmlFor={`label-${rule.id}`}>
                    <Input id={`label-${rule.id}`} name="label" defaultValue={rule.label} />
                  </Field>
                  <Field label="Matches text" htmlFor={`pattern-${rule.id}`}>
                    <Input id={`pattern-${rule.id}`} name="pattern" defaultValue={rule.pattern} />
                  </Field>
                  <Field label="How" htmlFor={`matchType-${rule.id}`}>
                    <Select id={`matchType-${rule.id}`} name="matchType" defaultValue={rule.matchType}>
                      <option value="CONTAINS">Contains</option>
                      <option value="EXACT">Exactly</option>
                      <option value="REGEX">Regex</option>
                    </Select>
                  </Field>
                  <Field label="At least" htmlFor={`minCents-${rule.id}`}>
                    <Input
                      id={`minCents-${rule.id}`}
                      name="minCents"
                      inputMode="decimal"
                      defaultValue={rule.minCents !== null ? money(rule.minCents) : ''}
                    />
                  </Field>
                  <input type="hidden" name="priority" value={rule.priority} />
                  <div className="flex items-center gap-2 sm:col-span-2">
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </div>
                </form>
                <form action={deleteSalaryRuleAction} className="mt-1">
                  <input type="hidden" name="id" value={rule.id} />
                  <button
                    type="submit"
                    className="text-xs font-medium text-muted hover:text-attention hover:underline"
                  >
                    Delete this rule
                  </button>
                </form>
              </li>
            ))}
          </ul>

          <details className="group mt-3 border-t border-line pt-3">
            <summary className="text-sm font-medium text-accent hover:underline">Add a rule</summary>
            <form action={saveSalaryRuleAction} className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Label" htmlFor="add-salary-label">
                <Input id="add-salary-label" name="label" required />
              </Field>
              <Field label="Matches text" htmlFor="add-salary-pattern">
                <Input id="add-salary-pattern" name="pattern" required />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit">Add</Button>
              </div>
            </form>
          </details>
        </Card>
      ) : null}

      {/* --- Merchant rules --- */}
      {tab === 'rules' ? (
        <Card>
          <CardHeader
            title="Merchant rules"
            hint="Which bucket a merchant belongs to, and which tag it should carry. Seeded as suggestions."
          />

          <Notice tone={settings.autoTagMode === 'DRY_RUN' ? 'neutral' : 'notice'}>
            <p>
              Tagging mode is{' '}
              <strong>
                {settings.autoTagMode === 'DRY_RUN'
                  ? 'dry run'
                  : settings.autoTagMode === 'APPLY_LOCAL'
                    ? 'apply locally'
                    : 'write to Up'}
              </strong>
              .{' '}
              {settings.autoTagMode === 'DRY_RUN'
                ? 'Suggestions are shown and nothing is changed in Up.'
                : settings.autoTagMode === 'APPLY_LOCAL'
                  ? 'Tags are applied inside this app only. Up is untouched.'
                  : 'Tags will be written back to your Up transactions.'}
            </p>
            <form action={saveSettingsAction} className="mt-2 flex items-end gap-2">
              <div className="w-48">
                <Field label="Mode" htmlFor="autoTagMode">
                  <Select id="autoTagMode" name="autoTagMode" defaultValue={settings.autoTagMode}>
                    <option value="DRY_RUN">Dry run</option>
                    <option value="APPLY_LOCAL">Apply locally</option>
                    <option value="APPLY_TO_UP">Write to Up</option>
                  </Select>
                </Field>
              </div>
              <Button type="submit" variant="secondary">
                Save
              </Button>
            </form>
          </Notice>

          <ul className="mt-3 divide-y divide-line">
            {merchantRules.map((rule) => (
              <li key={rule.id} className="py-3 first:pt-0">
                <form action={saveMerchantRuleAction} className="grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="id" value={rule.id} />
                  <Field label="Matches" htmlFor={`mr-pattern-${rule.id}`}>
                    <Input id={`mr-pattern-${rule.id}`} name="pattern" defaultValue={rule.pattern} />
                  </Field>
                  <Field label="Bucket" htmlFor={`mr-role-${rule.id}`}>
                    <Select id={`mr-role-${rule.id}`} name="role" defaultValue={rule.role ?? ''}>
                      <option value="">None</option>
                      {allRoleDefinitions().map((def) => (
                        <option key={def.role} value={def.role}>
                          {def.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tag" htmlFor={`mr-tag-${rule.id}`}>
                    <Input
                      id={`mr-tag-${rule.id}`}
                      name="tag"
                      defaultValue={rule.tag ?? ''}
                      list="suggested-tags"
                    />
                  </Field>
                  <div className="flex items-end gap-2">
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                    {rule.isSeed ? <Pill tone="neutral">Suggested</Pill> : null}
                  </div>
                  <input type="hidden" name="matchType" value={rule.matchType} />
                  <input type="hidden" name="priority" value={rule.priority} />
                </form>
                <form action={deleteMerchantRuleAction} className="mt-1">
                  <input type="hidden" name="id" value={rule.id} />
                  <button
                    type="submit"
                    className="text-xs font-medium text-muted hover:text-attention hover:underline"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>

          <datalist id="suggested-tags">
            {SUGGESTED_TAGS.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>

          <details className="group mt-3 border-t border-line pt-3">
            <summary className="text-sm font-medium text-accent hover:underline">Add a rule</summary>
            <form action={saveMerchantRuleAction} className="mt-2 grid gap-3 sm:grid-cols-4">
              <Field label="Matches" htmlFor="add-mr-pattern">
                <Input id="add-mr-pattern" name="pattern" required />
              </Field>
              <Field label="Bucket" htmlFor="add-mr-role">
                <Select id="add-mr-role" name="role" defaultValue="">
                  <option value="">None</option>
                  {allRoleDefinitions().map((def) => (
                    <option key={def.role} value={def.role}>
                      {def.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tag" htmlFor="add-mr-tag">
                <Input id="add-mr-tag" name="tag" list="suggested-tags" />
              </Field>
              <div className="flex items-end">
                <Button type="submit">Add</Button>
              </div>
            </form>
          </details>
        </Card>
      ) : null}

      {/* --- Detection --- */}
      {tab === 'detection' ? (
        <Card>
          <CardHeader title="Detection" hint="How hard the app looks, and how loudly it says anything." />
          <form action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Running hot threshold"
              htmlFor="runningHotDeltaPct"
              hint="Percentage points a bucket must be ahead of the clock before it is called out."
            >
              <Input
                id="runningHotDeltaPct"
                name="runningHotDeltaPct"
                type="number"
                min={1}
                max={100}
                defaultValue={settings.runningHotDeltaPct}
              />
            </Field>

            <Field
              label="Near limit threshold"
              htmlFor="nearLimitRemainingPct"
              hint="Below this share of the allocation remaining, a bucket reads as near limit."
            >
              <Input
                id="nearLimitRemainingPct"
                name="nearLimitRemainingPct"
                type="number"
                min={1}
                max={90}
                defaultValue={settings.nearLimitRemainingPct}
              />
            </Field>

            <Field
              label="Extra room for essentials"
              htmlFor="essentialLeewayPct"
              hint="Groceries and health get this many extra points before anything is said."
            >
              <Input
                id="essentialLeewayPct"
                name="essentialLeewayPct"
                type="number"
                min={0}
                max={100}
                defaultValue={settings.essentialLeewayPct}
              />
            </Field>

            <Field
              label="Leakage window (minutes)"
              htmlFor="leakageWindowMinutes"
              hint="How long after a transfer spending still counts as related."
            >
              <Input
                id="leakageWindowMinutes"
                name="leakageWindowMinutes"
                type="number"
                min={5}
                max={1440}
                defaultValue={settings.leakageWindowMinutes}
              />
            </Field>

            <Field
              label="Leakage amount tolerance (%)"
              htmlFor="leakageTolerancePct"
              hint="How close the amounts must be to count as correlated."
            >
              <Input
                id="leakageTolerancePct"
                name="leakageTolerancePct"
                type="number"
                min={1}
                max={100}
                defaultValue={settings.leakageTolerancePct}
              />
            </Field>

            <Field label="Ignore transfers below" htmlFor="leakageMinCents">
              <Input
                id="leakageMinCents"
                name="leakageMinCents"
                inputMode="decimal"
                defaultValue={money(settings.leakageMinCents)}
              />
            </Field>

            <Field
              label="Recurring: minimum occurrences"
              htmlFor="recurringMinOccurrences"
              hint="Three is the sensible floor. Two charges a month apart is a coincidence."
            >
              <Input
                id="recurringMinOccurrences"
                name="recurringMinOccurrences"
                type="number"
                min={2}
                max={12}
                defaultValue={settings.recurringMinOccurrences}
              />
            </Field>

            <Field label="Recurring: minimum confidence" htmlFor="recurringMinConfidence">
              <Input
                id="recurringMinConfidence"
                name="recurringMinConfidence"
                type="number"
                min={0}
                max={100}
                defaultValue={settings.recurringMinConfidence}
              />
            </Field>

            <div className="sm:col-span-2">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {/* --- Waiting periods --- */}
      {tab === 'shopping' ? (
        <Card>
          <CardHeader title="Waiting periods" hint="The tiers the Buy It engine applies." />
          <form action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Tier 1 upper bound" htmlFor="waitTier1MaxCents" hint="Below this, no wait.">
              <Input
                id="waitTier1MaxCents"
                name="waitTier1MaxCents"
                inputMode="decimal"
                defaultValue={money(settings.waitTier1MaxCents)}
              />
            </Field>
            <Field label="Tier 2 upper bound" htmlFor="waitTier2MaxCents">
              <Input
                id="waitTier2MaxCents"
                name="waitTier2MaxCents"
                inputMode="decimal"
                defaultValue={money(settings.waitTier2MaxCents)}
              />
            </Field>
            <Field label="Tier 2 wait (hours)" htmlFor="waitTier2Hours">
              <Input
                id="waitTier2Hours"
                name="waitTier2Hours"
                type="number"
                min={0}
                defaultValue={settings.waitTier2Hours}
              />
            </Field>
            <Field label="Tier 3 upper bound" htmlFor="waitTier3MaxCents">
              <Input
                id="waitTier3MaxCents"
                name="waitTier3MaxCents"
                inputMode="decimal"
                defaultValue={money(settings.waitTier3MaxCents)}
              />
            </Field>
            <Field label="Tier 3 wait (hours)" htmlFor="waitTier3Hours">
              <Input
                id="waitTier3Hours"
                name="waitTier3Hours"
                type="number"
                min={0}
                defaultValue={settings.waitTier3Hours}
              />
            </Field>
            <Field label="Tier 4 wait (hours)" htmlFor="waitTier4Hours" hint="Anything above tier 3.">
              <Input
                id="waitTier4Hours"
                name="waitTier4Hours"
                type="number"
                min={0}
                defaultValue={settings.waitTier4Hours}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">Save</Button>
            </div>
          </form>

          <Why label="What these rules will never do">
            <p>They will never shorten a wait because something is on sale.</p>
            <p>
              They will never suggest topping up from Emergency, Travel, Future Options or
              Investing to close a shortfall.
            </p>
            <p>
              They are deterministic. The same inputs always give the same verdict, and every check
              behind it is shown.
            </p>
          </Why>
        </Card>
      ) : null}

      {/* --- Integrations --- */}
      {tab === 'integrations' ? (
        <>
          <Card>
            <CardHeader title="What is configured" />
            <ul className="divide-y divide-line">
              {[
                ['Mock mode', status.mockMode],
                ['Up token', status.upTokenConfigured],
                ['Up webhook secret', status.upWebhookSecretConfigured],
                ['Notion', status.notionConfigured],
                ['Login password', status.authConfigured],
                ['Claude API', status.aiConfigured],
              ].map(([label, on]) => (
                <li key={String(label)} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">{String(label)}</span>
                  <Pill tone={on ? 'ontrack' : 'neutral'}>{on ? 'Set' : 'Not set'}</Pill>
                </li>
              ))}
            </ul>
            <Notice tone="neutral">
              Only whether each value is present is shown, never the value itself. Secrets are read
              on the server and never sent to the browser.
            </Notice>
          </Card>

          <Card>
            <CardHeader title="Webhook" hint="For live updates when a transaction lands." />
            <p className="text-sm text-muted">Point the Up webhook at:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-track p-2.5 text-xs text-ink">
              {appUrl()}/api/webhooks/up
            </pre>
            <Why label="How to set it up">
              <p>Create it against the Up API, which returns a secret key exactly once:</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-track p-2.5 text-xs leading-relaxed text-ink">
{`curl -X POST https://api.up.com.au/api/v1/webhooks \\
  -H "Authorization: Bearer $UP_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"data":{"attributes":{"url":"${appUrl()}/api/webhooks/up"}}}'`}
              </pre>
              <p className="mt-2">
                Copy <code>secretKey</code> from the response into <code>UP_WEBHOOK_SECRET</code>.
                It is shown once and never again. Without it, every incoming event is rejected,
                which is the correct behaviour: an unverifiable event should never be trusted.
              </p>
            </Why>
          </Card>

          <Card>
            <CardHeader title="Rebuild" hint="Re-derive everything from the transactions already stored." />
            <form action={recalculateAction}>
              <Button type="submit" variant="secondary">
                Recalculate
              </Button>
            </form>
            <p className="mt-2 text-sm text-muted">
              Re-runs classification, pay cycles and the phase check. Useful after changing rules or
              percentages. Nothing is fetched and nothing is deleted.
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}
