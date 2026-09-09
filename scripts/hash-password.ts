/**
 * Generate a password hash for APP_PASSWORD_HASH.
 *
 *   npm run hash-password -- "your password here"
 *
 * The password is taken as an argument or read from stdin. It is never echoed
 * back, never written to a file, and never stored anywhere but the hash you
 * paste into .env yourself.
 */

import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../src/lib/auth/password';

async function main() {
  let password = process.argv.slice(2).join(' ').trim();

  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    password = (await rl.question('Password: ')).trim();
    rl.close();
  }

  if (!password) {
    console.error('No password given.');
    process.exit(1);
  }

  try {
    const hash = await hashPassword(password);
    console.log('\nAdd this to your .env file:\n');
    console.log(`APP_PASSWORD_HASH="${hash}"`);
    console.log('\nIf you have not set AUTH_SECRET yet, run: npm run gen-secret\n');
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

void main();
