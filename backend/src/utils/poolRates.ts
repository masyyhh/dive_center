export const isPercentagePool = (poolType: string) => poolType === 'COURSE_POOL' || poolType === 'DIVE_POOL';

export const validPoolRate = (poolType: string, rate: number) =>
  Number.isFinite(rate) && rate >= 0 && (!isPercentagePool(poolType) || rate <= 100);

export function poolContributionAmount(poolType: string, rate: number, quantity: number, lineTotal: number): number {
  if (!validPoolRate(poolType, rate)) return 0;
  if (isPercentagePool(poolType)) return Math.max(0, lineTotal) * rate / 100;
  return poolType === 'CERTIFICATION_POOL' ? rate * quantity : 0;
}
