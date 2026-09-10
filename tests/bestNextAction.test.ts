import { describe, expect, it } from 'vitest';
import { selectBestNextAction } from '@/lib/domain/bestNextAction';

function baseline() {
  return {
    emergencyProgressPct: 100,
    emergencyReached: true,
    futureOptionsProgressPct: 100,
    debtCents: 0,
    protectionRecordedCount: 5,
    recentCyclesWithContribution: 3,
    adminOverdueCount: 0,
  };
}

describe('best next action', () => {
  it('recommends keeping going when nothing else is outstanding', () => {
    const action = selectBestNextAction(baseline());
    expect(action.headline).toBe('Keep going');
  });

  it('debt outranks everything else', () => {
    const action = selectBestNextAction({
      ...baseline(),
      debtCents: 10_000,
      emergencyProgressPct: 20,
      emergencyReached: false,
    });
    expect(action.headline).toBe('Prioritise debt');
  });

  it('builds Emergency before Future Options', () => {
    const action = selectBestNextAction({
      ...baseline(),
      emergencyProgressPct: 40,
      emergencyReached: false,
      futureOptionsProgressPct: 0,
    });
    expect(action.headline).toBe('Build Emergency');
  });

  it('moves on to Future Options only once Emergency is reached', () => {
    const action = selectBestNextAction({
      ...baseline(),
      emergencyProgressPct: 100,
      emergencyReached: true,
      futureOptionsProgressPct: 30,
    });
    expect(action.headline).toBe('Build Future Options');
  });

  it('never returns more than one action', () => {
    const action = selectBestNextAction({
      ...baseline(),
      debtCents: 5_000,
      emergencyProgressPct: 10,
      emergencyReached: false,
      recentCyclesWithContribution: 0,
      protectionRecordedCount: 0,
      adminOverdueCount: 3,
    });
    // Only the type system enforces this, but the intent is explicit: one
    // object, not a list of every true condition.
    expect(typeof action.headline).toBe('string');
    expect(action.headline).toBe('Prioritise debt');
  });

  it('suggests restoring investing only when no recent cycle had a contribution', () => {
    const some = selectBestNextAction({ ...baseline(), recentCyclesWithContribution: 1 });
    const none = selectBestNextAction({ ...baseline(), recentCyclesWithContribution: 0 });
    expect(some.headline).toBe('Keep going');
    expect(none.headline).toBe('Restore the investing habit');
  });

  it('flags protection review when items are unrecorded', () => {
    const action = selectBestNextAction({ ...baseline(), protectionRecordedCount: 2 });
    expect(action.headline).toBe('Review protection');
    expect(action.detail).toContain('3 of 5');
  });

  it('flags overdue admin last, below the other priorities', () => {
    const action = selectBestNextAction({ ...baseline(), adminOverdueCount: 2 });
    expect(action.headline).toBe('Catch up on admin');
  });
});
