/** `₹48.2k`, `₹2.1L`, `₹900`: the short rupee form the dashboards use for headline numbers. */
export function compactRupees(paise: number): string {
  const rupees = paise / 100;
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (rupees >= 100_000) {
    return `₹${trim(rupees / 100_000)}L`;
  }
  if (rupees >= 1_000) {
    return `₹${trim(rupees / 1_000)}k`;
  }
  return `₹${String(Math.round(rupees))}`;
}
