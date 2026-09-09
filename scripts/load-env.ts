/**
 * Load .env for CLI scripts.
 *
 * Next.js loads .env itself, so this is only needed by the scripts in this
 * directory. Written by hand rather than pulling in a dependency: it is
 * twenty lines, and a package that reads the file holding the bank token is a
 * package worth not having.
 *
 * Import this first, before anything that reads process.env.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function load(file: string): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue; // a real env var always wins

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

load('.env.local');
load('.env');
