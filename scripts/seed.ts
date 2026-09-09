/**
 * Seed the database and run a first sync.
 *
 *   npm run db:seed
 *
 * In mock mode this produces a complete, believable six months: pay cycles,
 * a leakage case, subscriptions, and an Emergency balance just short of its
 * target so the milestone can be triggered from the Pay Cycle screen.
 *
 * Safe to run more than once. Everything it does is an upsert.
 */

import './load-env';

import { prisma } from '../src/lib/db';
import { seedDefaults } from '../src/lib/services/settings';
import { seedWishlistIfEmpty } from '../src/lib/services/wishlist';
import { runSync } from '../src/lib/services/sync';
import { useMockData } from '../src/lib/env';
import { MOCK_ACCOUNTS } from '../src/lib/up/mock';
import { defaultIsDiscretionary, defaultIsProtected } from '../src/lib/domain/roles';

async function main() {
  console.log('Seeding settings, rules and goals...');
  await seedDefaults();
  await seedWishlistIfEmpty();

  console.log('Running first sync...');
  const result = await runSync({ kind: 'HISTORICAL_IMPORT', months: 6 });

  if (!result.ok) {
    console.error(`\nSync did not finish: ${result.userMessage ?? result.error}\n`);
    if (!useMockData()) {
      console.error('Set USE_MOCK_DATA=true to work without a real Up token.\n');
    }
    process.exit(1);
  }

  console.log(
    `  ${result.accountsSynced} accounts, ${result.transactionsCreated} transactions imported.`,
  );

  // In mock mode, map the accounts automatically. The mapping step is worth
  // doing by hand against a real bank, but a demo that requires thirteen
  // dropdowns before it shows anything is not a demo.
  if (useMockData()) {
    console.log('Mapping mock accounts to roles...');
    for (const account of MOCK_ACCOUNTS) {
      const exists = await prisma.account.findUnique({ where: { id: account.id } });
      if (!exists) continue;
      await prisma.accountRoleMapping.upsert({
        where: { accountId: account.id },
        create: {
          accountId: account.id,
          role: account.role,
          isProtected: defaultIsProtected(account.role),
          isDiscretionary: defaultIsDiscretionary(account.role),
        },
        update: {
          role: account.role,
          isProtected: defaultIsProtected(account.role),
          isDiscretionary: defaultIsDiscretionary(account.role),
        },
      });
    }

    console.log('Re-running sync so everything is classified against the mapping...');
    const second = await runSync({ kind: 'HISTORICAL_IMPORT', months: 6 });
    console.log(
      `  ${second.payCycles} pay cycles, ${second.leakageFound} leakage findings, ${second.recurringFound} recurring merchants.`,
    );
  }

  await prisma.settings.updateMany({ data: { setupCompletedAt: new Date() } });

  console.log('\nDone. Start the app with: npm run dev\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
