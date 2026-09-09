/**
 * The wishlist and the Buy It decisions.
 *
 * Notion is canonical when it is connected. When it is not, the local list is
 * canonical, and the app is fully usable either way — a missing Notion token
 * is a reduced feature, never a broken screen.
 *
 * The seeds below are what is on the horizon today. They are written to the
 * database once, then belong to the database. Nothing in the decision engine
 * knows any of these names.
 */

import 'server-only';

import type { Priority, WishlistItem, WishlistStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { NotionError, fetchNotionWishlist, notionConfigured } from '@/lib/notion/client';
import { decideBuyIt, type BuyItDecision, type OutstandingItem } from '@/lib/domain/buyIt';
import { getBalancesByRole, getSettings, waitTiersFrom } from './settings';
import { raiseReviewItem } from './reviewItems';

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

interface SeedItem {
  name: string;
  priceCents: number | null;
  priority: Priority;
  status: WishlistStatus;
  daysAgo: number;
  notes?: string;
}

/**
 * A believable starting list, so the Shopping screen and the decision engine
 * are usable on first run with no Notion connection. Every one of these is an
 * ordinary database row that can be edited or deleted.
 */
const SEED_ITEMS: readonly SeedItem[] = [
  { name: 'Cargo bibs', priceCents: 15_000, priority: 'REPLACEMENT', status: 'CONSIDERING', daysAgo: 41, notes: 'Current pair is going at the seams.' },
  { name: 'Sea to Summit Aeros Down pillow', priceCents: 12_900, priority: 'WANT', status: 'CONSIDERING', daysAgo: 30 },
  { name: 'Sunglasses', priceCents: 18_000, priority: 'REPLACEMENT', status: 'CONSIDERING', daysAgo: 12 },
  { name: '5-inch shorts', priceCents: 7_900, priority: 'WANT', status: 'CONSIDERING', daysAgo: 6 },
  { name: 'Waratah Quilt', priceCents: 54_900, priority: 'USEFUL_UPGRADE', status: 'CONSIDERING', daysAgo: 22 },
  { name: 'Durston tent', priceCents: null, priority: 'FUTURE_DECISION', status: 'CONSIDERING', daysAgo: 60, notes: 'Decision TBC. Price depends on which model.' },
  { name: 'Sea to Summit spork', priceCents: 1_600, priority: 'WANT', status: 'CONSIDERING', daysAgo: 3 },
  { name: 'Sea to Summit collapsible cup', priceCents: 2_400, priority: 'WANT', status: 'CONSIDERING', daysAgo: 3 },
  { name: 'Black Diamond Sprint headlamp', priceCents: 11_900, priority: 'NEED', status: 'ORDERED', daysAgo: 9, notes: 'Already ordered.' },
  { name: 'Car', priceCents: null, priority: 'FUTURE_DECISION', status: 'PARKED', daysAgo: 120, notes: 'A whole separate decision, not a Gear purchase.' },
];

export async function seedWishlistIfEmpty(): Promise<void> {
  const count = await prisma.wishlistItem.count();
  if (count > 0) return;

  const now = Date.now();
  await prisma.wishlistItem.createMany({
    data: SEED_ITEMS.map((item) => ({
      name: item.name,
      priceCents: item.priceCents,
      priority: item.priority,
      status: item.status,
      role: 'GEAR_OBJECTS' as const,
      source: 'LOCAL' as const,
      notes: item.notes ?? null,
      addedAt: new Date(now - item.daysAgo * 86_400_000),
    })),
  });
}

// ---------------------------------------------------------------------------
// Notion sync
// ---------------------------------------------------------------------------

export interface NotionSyncResult {
  ok: boolean;
  imported: number;
  updated: number;
  openReviews: string[];
  pageTitle: string | null;
  sectionFound: boolean;
  message: string;
}

/**
 * Pull the wishlist from Notion.
 *
 * Matching is by Notion block id, so re-running is idempotent. An item's
 * `addedAt` is set once and never moved by a later sync: the waiting period
 * counts from when the item entered consideration, and re-syncing must not
 * restart that clock.
 */
export async function syncNotionWishlist(): Promise<NotionSyncResult> {
  if (!notionConfigured()) {
    return {
      ok: false,
      imported: 0,
      updated: 0,
      openReviews: [],
      pageTitle: null,
      sectionFound: false,
      message:
        'Notion is not connected. Add NOTION_TOKEN and NOTION_PAGE_ID to .env, or carry on with the local list.',
    };
  }

  try {
    const result = await fetchNotionWishlist();
    let imported = 0;
    let updated = 0;

    for (const item of result.items) {
      const existing = await prisma.wishlistItem.findUnique({
        where: { externalId: item.externalId },
      });

      if (existing) {
        await prisma.wishlistItem.update({
          where: { id: existing.id },
          data: {
            name: item.name,
            priceCents: item.priceCents,
            rawPrice: item.rawPrice,
            status: item.status,
            notes: item.notes,
            url: item.url,
            lastSyncedAt: new Date(),
            archived: false,
            // Priority is not overwritten: if I set it here, Notion prose
            // should not undo that on the next sync.
          },
        });
        updated += 1;
      } else {
        await prisma.wishlistItem.create({
          data: {
            source: 'NOTION',
            externalId: item.externalId,
            name: item.name,
            priceCents: item.priceCents,
            rawPrice: item.rawPrice,
            priority: item.priority,
            status: item.status,
            role: 'GEAR_OBJECTS',
            notes: item.notes,
            url: item.url,
            addedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        });
        imported += 1;
      }
    }

    await prisma.settings.updateMany({ data: { notionLastSyncAt: new Date() } });

    return {
      ok: true,
      imported,
      updated,
      openReviews: result.openReviews,
      pageTitle: result.pageTitle,
      sectionFound: result.sectionFound,
      message: result.sectionFound
        ? `Read ${result.items.length} ${result.items.length === 1 ? 'item' : 'items'} from Notion. ${imported} new, ${updated} updated.`
        : `Could not find an "On the horizon" heading, so every table on the page was read instead. ${imported} new, ${updated} updated.`,
    };
  } catch (error) {
    const message =
      error instanceof NotionError
        ? error.userMessage
        : 'Notion could not be reached. The local wishlist is unaffected.';

    return {
      ok: false,
      imported: 0,
      updated: 0,
      openReviews: [],
      pageTitle: null,
      sectionFound: false,
      message,
    };
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface WishlistWithDecision {
  item: WishlistItem;
  decision: BuyItDecision;
}

/** Items still under consideration, newest decision attached to each. */
export async function getWishlistWithDecisions(
  now: Date = new Date(),
): Promise<WishlistWithDecision[]> {
  await seedWishlistIfEmpty();

  const [items, settings, balances] = await Promise.all([
    prisma.wishlistItem.findMany({
      where: { archived: false },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { addedAt: 'asc' }],
    }),
    getSettings(),
    getBalancesByRole(),
  ]);

  const tiers = waitTiersFrom(settings);

  const outstanding: OutstandingItem[] = items
    .filter((i) => i.status === 'CONSIDERING')
    .map((i) => ({
      id: i.id,
      name: i.name,
      priceCents: i.priceCents,
      priority: i.priority,
      role: i.role,
    }));

  return items.map((item) => ({
    item,
    decision: decideBuyIt({
      item: {
        id: item.id,
        name: item.name,
        priceCents: item.priceCents,
        priority: item.priority,
        role: item.role,
        addedAt: item.addedAt,
      },
      saverBalanceCents: balances.get(item.role) ?? 0,
      outstanding,
      now,
      tiers,
    }),
  }));
}

export async function getWishlistItemWithDecision(
  id: string,
  now: Date = new Date(),
): Promise<WishlistWithDecision | null> {
  const all = await getWishlistWithDecisions(now);
  return all.find((row) => row.item.id === id) ?? null;
}

/**
 * Record a decision, so I can see later what the answer was and why at the
 * time. Only stores a snapshot when the verdict has changed, to avoid a row
 * per page view.
 */
export async function recordDecision(row: WishlistWithDecision): Promise<void> {
  const last = await prisma.purchaseDecision.findFirst({
    where: { wishlistItemId: row.item.id },
    orderBy: { decidedAt: 'desc' },
  });
  if (last?.verdict === row.decision.verdict) return;

  await prisma.purchaseDecision.create({
    data: {
      wishlistItemId: row.item.id,
      verdict: row.decision.verdict,
      saverBalanceCents: row.decision.saverBalanceCents,
      priceCents: row.item.priceCents,
      checks: row.decision.checks.map((c) => ({
        key: c.key,
        question: c.question,
        answer: c.answer,
        outcome: c.outcome,
        detail: c.detail,
      })),
    },
  });
}

/** Raise a calm notice when something on the list becomes buyable. */
export async function notifyNewlyFundedItems(now: Date = new Date()): Promise<void> {
  const rows = await getWishlistWithDecisions(now);
  for (const row of rows) {
    if (row.item.status !== 'CONSIDERING') continue;
    if (row.decision.verdict !== 'BUY') continue;

    await raiseReviewItem({
      kind: 'WISHLIST_ITEM_FUNDED',
      severity: 'INFO',
      title: `${row.item.name} is now fully funded`,
      body: row.decision.summary,
      dedupeKey: `wishlist:funded:${row.item.id}`,
      data: { priceCents: row.item.priceCents ?? 0 },
    });
  }
}
