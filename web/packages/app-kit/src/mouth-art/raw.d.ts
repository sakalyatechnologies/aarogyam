// Vite's `?raw` imports (used by tests to read seeded Rust enums as text).
declare module "*?raw" {
  const text: string;
  // eslint-disable-next-line no-restricted-syntax -- Vite's ?raw modules have a default export
  export default text;
}
