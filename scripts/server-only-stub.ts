// Stands in for the `server-only` package when running a CLI script.
//
// The real package throws on import so that a build fails loudly if a
// server-only module is ever pulled into a client bundle. A Node script IS the
// server, so there is nothing to guard against here.
//
// Only tsconfig.scripts.json maps to this file. The application build still
// uses the real package.
export {};
