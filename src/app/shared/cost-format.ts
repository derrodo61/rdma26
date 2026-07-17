export function formatCost(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      currency,
      maximumFractionDigits: 3,
      minimumFractionDigits: 0,
      style: 'currency',
    }).format(amount);
  } catch {
    return `${amount.toFixed(3)} ${currency}`;
  }
}
