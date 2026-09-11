import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), upsert: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireSession: mocks.requireSession }));
vi.mock('@/lib/db', () => ({ prisma: { careerBreakPlan: { upsert: mocks.upsert } } }));
vi.mock('@/lib/services/settings', () => ({ getSettings: async () => ({ timezone: 'Australia/Sydney' }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { saveCareerBreakPlan } from '../src/app/(app)/plan/actions';
const valid = { startDate: '2030-01-01', durationMonths: 6, monthlyCostCents: 300_000, perCycleCents: 50_000, upfrontCents: 0, bufferMonths: 2 };
beforeEach(() => { vi.resetAllMocks(); });
describe('saved career-break plans', () => {
  it('requires authentication before touching a plan', async () => {
    mocks.requireSession.mockRejectedValue(new Error('Not signed in'));
    await expect(saveCareerBreakPlan(valid)).rejects.toThrow('Not signed in');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('rejects invalid or past assumptions without a database write', async () => {
    expect((await saveCareerBreakPlan({ ...valid, monthlyCostCents: -1 })).ok).toBe(false);
    expect((await saveCareerBreakPlan({ ...valid, startDate: '2020-01-01' })).ok).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('saves only validated scenario fields and refreshes the planner', async () => {
    expect((await saveCareerBreakPlan({ ...valid, unexpectedBankSetting: true })).ok).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledWith({ where: { id: 'personal' }, create: { id: 'personal', ...valid }, update: valid });
    expect(mocks.revalidate).toHaveBeenCalledWith('/plan');
  });
  it('returns a recoverable error without exposing database details', async () => {
    mocks.upsert.mockRejectedValue(new Error('private database details'));
    const response = await saveCareerBreakPlan(valid);
    expect(response.ok).toBe(false);
    expect(response.message).not.toContain('private');
  });
});
