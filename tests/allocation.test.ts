import { describe, expect, it } from 'vitest';
import {
  PHASE_1_DEFAULTS,
  PHASE_2_DEFAULTS,
  determinePhase,
  phaseDiff,
  toBasisPointRows,
  validateAllocation,
} from '@/lib/domain/phases';
import { auditPayday, calculatePaydayAllocation } from '@/lib/domain/allocation';
import type { AccountRole } from '@prisma/client';

const TYPICAL_SALARY = 438_031; // $4,380.31
const RENT = 134_000; // $1,340.00
const POST_RENT = TYPICAL_SALARY - RENT; // $3,040.31

describe('phase percentages', () => {
  it('Phase 1 adds to exactly 100%', () => {
    const rows = toBasisPointRows(PHASE_1_DEFAULTS);
    const result = validateAllocation(rows);
    expect(result.totalBasisPoints).toBe(10_000);
    expect(result.ok).toBe(true);
  });

  it('Phase 2 adds to exactly 100%', () => {
    const rows = toBasisPointRows(PHASE_2_DEFAULTS);
    const result = validateAllocation(rows);
    expect(result.totalBasisPoints).toBe(10_000);
    expect(result.ok).toBe(true);
  });

  it('rejects a set that does not add up, and says by how much', () => {
    const bad = validateAllocation([{ basisPoints: 5000 }, { basisPoints: 4000 }]);
    expect(bad.ok).toBe(false);
    expect(bad.deltaBasisPoints).toBe(-1000);
    expect(bad.message).toContain('Under by 10%');

    const over = validateAllocation([{ basisPoints: 9000 }, { basisPoints: 2000 }]);
    expect(over.ok).toBe(false);
    expect(over.message).toContain('Over by 10%');
  });

  it('holds the Phase 1 figures the system was designed with', () => {
    const byRole = new Map(PHASE_1_DEFAULTS.map((p) => [p.role, p.pct]));
    expect(byRole.get('EMERGENCY')).toBe(20);
    expect(byRole.get('INVESTING')).toBe(8);
    expect(byRole.get('FUTURE_OPTIONS')).toBe(3);
    expect(byRole.get('TRAVEL')).toBe(10);
    expect(byRole.get('GEAR_OBJECTS')).toBe(5);
  });

  it('holds the Phase 2 figures', () => {
    const byRole = new Map(PHASE_2_DEFAULTS.map((p) => [p.role, p.pct]));
    expect(byRole.get('EMERGENCY')).toBe(0);
    expect(byRole.get('INVESTING')).toBe(17);
    expect(byRole.get('FUTURE_OPTIONS')).toBe(12);
    expect(byRole.get('TRAVEL')).toBe(12);
    expect(byRole.get('GEAR_OBJECTS')).toBe(5);
  });

  it('reports what changed between the phases', () => {
    const diff = phaseDiff(toBasisPointRows(PHASE_1_DEFAULTS), toBasisPointRows(PHASE_2_DEFAULTS));
    const byRole = new Map(diff.map((d) => [d.role, d]));

    expect(byRole.get('EMERGENCY')).toEqual({
      role: 'EMERGENCY',
      fromBasisPoints: 2000,
      toBasisPoints: 0,
    });
    expect(byRole.get('INVESTING')?.toBasisPoints).toBe(1700);
    expect(byRole.get('FUTURE_OPTIONS')?.toBasisPoints).toBe(1200);
    expect(byRole.get('TRAVEL')?.toBasisPoints).toBe(1200);
    // Everything else is untouched.
    expect(byRole.has('GROCERIES')).toBe(false);
    expect(byRole.has('GEAR_OBJECTS')).toBe(false);
  });
});

describe('phase transition at $12,000', () => {
  const target = 1_200_000;

  it('stays in Phase 1 below the target', () => {
    const decision = determinePhase({
      emergencyBalanceCents: 1_199_999,
      emergencyTargetCents: target,
      currentPhase: 'PHASE_1',
      hasEverReachedTarget: false,
    });
    expect(decision.phase).toBe('PHASE_1');
    expect(decision.changed).toBe(false);
  });

  it('moves to Phase 2 exactly at the target', () => {
    const decision = determinePhase({
      emergencyBalanceCents: 1_200_000,
      emergencyTargetCents: target,
      currentPhase: 'PHASE_1',
      hasEverReachedTarget: false,
    });
    expect(decision.phase).toBe('PHASE_2');
    expect(decision.changed).toBe(true);
  });

  it('does not fall back to Phase 1 when the balance later dips', () => {
    // A dip below the floor is a thing to look at, not a reason to quietly
    // stop investing and start rebuilding Emergency again.
    const decision = determinePhase({
      emergencyBalanceCents: 1_100_000,
      emergencyTargetCents: target,
      currentPhase: 'PHASE_2',
      hasEverReachedTarget: true,
    });
    expect(decision.phase).toBe('PHASE_2');
    expect(decision.changed).toBe(false);
  });

  it('only reports the change once', () => {
    const first = determinePhase({
      emergencyBalanceCents: 1_250_000,
      emergencyTargetCents: target,
      currentPhase: 'PHASE_1',
      hasEverReachedTarget: false,
    });
    const second = determinePhase({
      emergencyBalanceCents: 1_250_000,
      emergencyTargetCents: target,
      currentPhase: 'PHASE_2',
      hasEverReachedTarget: true,
    });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
  });
});

describe('payday allocation', () => {
  it('takes rent off the top before splitting anything', () => {
    const result = calculatePaydayAllocation({
      incomeCents: TYPICAL_SALARY,
      rentCents: RENT,
      phase: 'PHASE_1',
      percentages: toBasisPointRows(PHASE_1_DEFAULTS),
    });
    expect(result.allocatableCents).toBe(POST_RENT);
    expect(result.allocatableCents).toBe(304_031);
  });

  it('splits Phase 2 to the figures on the payday screen', () => {
    const result = calculatePaydayAllocation({
      incomeCents: TYPICAL_SALARY,
      rentCents: RENT,
      phase: 'PHASE_2',
      percentages: toBasisPointRows(PHASE_2_DEFAULTS),
    });
    const byRole = new Map(result.rows.map((r) => [r.role, r.allocatedCents]));

    // 12% of $3,040.31 = $364.84 (Travel and Future Options)
    expect(byRole.get('TRAVEL')).toBe(36_484);
    expect(byRole.get('FUTURE_OPTIONS')).toBe(36_484);
    // 17% = $516.85
    expect(byRole.get('INVESTING')).toBe(51_685);
    // 5% = $152.02
    expect(byRole.get('GEAR_OBJECTS')).toBe(15_202);
    expect(byRole.get('EMERGENCY')).toBe(0);
  });

  it('allocates every cent of the post-rent amount and no more', () => {
    for (const income of [438_031, 400_000, 450_450, 299_999, 1_000_001]) {
      const result = calculatePaydayAllocation({
        incomeCents: income,
        rentCents: RENT,
        phase: 'PHASE_1',
        percentages: toBasisPointRows(PHASE_1_DEFAULTS),
      });
      expect(result.totalAllocatedCents).toBe(result.allocatableCents);
      expect(result.warnings).toHaveLength(0);
    }
  });

  it('uses the actual salary rather than the typical one', () => {
    const light = calculatePaydayAllocation({
      incomeCents: 300_000,
      rentCents: RENT,
      phase: 'PHASE_1',
      percentages: toBasisPointRows(PHASE_1_DEFAULTS),
    });
    expect(light.allocatableCents).toBe(166_000);
    expect(light.totalAllocatedCents).toBe(166_000);
  });

  it('does not produce negative allocations when rent exceeds the pay', () => {
    const result = calculatePaydayAllocation({
      incomeCents: 100_000,
      rentCents: RENT,
      phase: 'PHASE_1',
      percentages: toBasisPointRows(PHASE_1_DEFAULTS),
    });
    expect(result.allocatableCents).toBe(0);
    expect(result.rows.every((r) => r.allocatedCents === 0)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('warns when the percentages do not add to 100', () => {
    const result = calculatePaydayAllocation({
      incomeCents: TYPICAL_SALARY,
      rentCents: RENT,
      phase: 'PHASE_1',
      percentages: [
        { role: 'BILLS', basisPoints: 5000 },
        { role: 'FUN', basisPoints: 3000 },
      ],
    });
    // 80% is claimed, so 80% is allocated and the other 20% is shown as
    // unclaimed rather than being quietly scaled up to look correct.
    expect(result.totalAllocatedCents).toBeLessThan(result.allocatableCents);
    expect(result.totalAllocatedCents + result.unallocatedCents).toBe(result.allocatableCents);
    expect(result.warnings.some((w) => w.includes('not 100%'))).toBe(true);
  });

  it('scales down and says so when the percentages add to more than 100%', () => {
    const result = calculatePaydayAllocation({
      incomeCents: TYPICAL_SALARY,
      rentCents: RENT,
      phase: 'PHASE_1',
      percentages: [
        { role: 'BILLS', basisPoints: 8000 },
        { role: 'FUN', basisPoints: 6000 },
      ],
    });
    // It cannot allocate more money than exists, so the parts still sum to the
    // pay, but the app does not pretend the configuration is fine.
    expect(result.totalAllocatedCents).toBe(result.allocatableCents);
    expect(result.unallocatedCents).toBe(0);
    expect(result.warnings.some((w) => w.includes('more than the pay'))).toBe(true);
  });
});

describe('payday audit', () => {
  const allocation = calculatePaydayAllocation({
    incomeCents: TYPICAL_SALARY,
    rentCents: RENT,
    phase: 'PHASE_1',
    percentages: toBasisPointRows(PHASE_1_DEFAULTS),
  });

  const tracked = new Set<AccountRole>([
    'BILLS',
    'HEALTH_THERAPY',
    'GROCERIES',
    'DINING_SOCIAL',
    'FUN',
    'TRANSPORT',
    'TRAVEL',
    'GEAR_OBJECTS',
    'EMERGENCY',
    'FUTURE_OPTIONS',
    'BUFFER',
    'INVESTING',
  ]);

  it('calls a split that matches the plan a match', () => {
    const observed = allocation.rows
      .filter((r) => r.basisPoints > 0)
      .map((r) => ({ role: r.role, observedCents: r.allocatedCents }));

    const audit = auditPayday({ allocation, observed, trackedRoles: tracked });
    expect(audit.rows.every((r) => r.status === 'MATCHED')).toBe(true);
  });

  it('notices a split that did not happen', () => {
    const observed = allocation.rows
      .filter((r) => r.basisPoints > 0 && r.role !== 'GEAR_OBJECTS')
      .map((r) => ({ role: r.role, observedCents: r.allocatedCents }));

    const audit = auditPayday({ allocation, observed, trackedRoles: tracked });
    const gear = audit.rows.find((r) => r.role === 'GEAR_OBJECTS');
    expect(gear?.status).toBe('MISSING');
    expect(gear?.explanation).toContain('Nothing moved into');
  });

  it('tolerates the few dollars Up Pay Splitting rounds by', () => {
    const observed = allocation.rows
      .filter((r) => r.basisPoints > 0)
      .map((r) => ({ role: r.role, observedCents: r.allocatedCents + 200 }));

    const audit = auditPayday({ allocation, observed, trackedRoles: tracked });
    expect(audit.rows.every((r) => r.status === 'MATCHED')).toBe(true);
  });

  it('says it cannot check a role with no mapped account', () => {
    const audit = auditPayday({
      allocation,
      observed: [],
      trackedRoles: new Set<AccountRole>(['BILLS']),
    });
    const travel = audit.rows.find((r) => r.role === 'TRAVEL');
    expect(travel?.status).toBe('NOT_TRACKED');
    expect(audit.untrackedRoles).toContain('TRAVEL');
  });
});
