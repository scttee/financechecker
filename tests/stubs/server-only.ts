// Stub for the `server-only` package under test. The real module throws when
// imported outside a server bundle, which is correct in the app and unhelpful
// in a unit test that imports the module directly.
export {};
