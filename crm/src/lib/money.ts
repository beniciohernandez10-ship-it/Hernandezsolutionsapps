import { CLOSED_STAGES, DEFAULT_PRICE_PER_USER, STAGE_PROBABILITY, type StageKey } from "./constants";

type Num = number | string | { toString(): string } | null | undefined;

export function num(value: Num): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(n) ? n : null;
}

export interface DealInput {
  managedUsers?: number | null;
  pricePerUser?: Num;
  monthlyValueOverride?: Num;
  implementationFee?: Num;
  closeProbability?: number | null;
  stage: string;
}

/** Monthly estimate = managed users × price per user ($65 default), unless a custom monthly value is set. */
export function monthlyValue(deal: DealInput, defaultPrice = DEFAULT_PRICE_PER_USER): number {
  const override = num(deal.monthlyValueOverride);
  if (override !== null) return override;
  const users = deal.managedUsers ?? 0;
  const price = num(deal.pricePerUser) ?? defaultPrice;
  return round2(users * price);
}

export function annualValue(deal: DealInput, defaultPrice = DEFAULT_PRICE_PER_USER): number {
  return round2(monthlyValue(deal, defaultPrice) * 12);
}

export function probability(deal: DealInput): number {
  if (deal.closeProbability !== null && deal.closeProbability !== undefined) return Math.max(0, Math.min(100, deal.closeProbability));
  return STAGE_PROBABILITY[deal.stage as StageKey] ?? 0;
}

/** First-year expected value: (annual recurring + implementation fee) × close probability. */
export function weightedValue(deal: DealInput, defaultPrice = DEFAULT_PRICE_PER_USER): number {
  const total = annualValue(deal, defaultPrice) + (num(deal.implementationFee) ?? 0);
  return round2((total * probability(deal)) / 100);
}

export function isOpen(stage: string): boolean {
  return !CLOSED_STAGES.includes(stage as StageKey);
}

export interface PipelineTotals {
  potentialMrr: number;
  potentialArr: number;
  implementation: number;
  weighted: number;
  openDeals: number;
}

/** Totals over open (not won, lost or not interested) deals. Estimates only — never revenue. */
export function pipelineTotals(deals: DealInput[], defaultPrice = DEFAULT_PRICE_PER_USER): PipelineTotals {
  const totals: PipelineTotals = { potentialMrr: 0, potentialArr: 0, implementation: 0, weighted: 0, openDeals: 0 };
  for (const d of deals) {
    if (!isOpen(d.stage)) continue;
    totals.openDeals += 1;
    totals.potentialMrr += monthlyValue(d, defaultPrice);
    totals.implementation += num(d.implementationFee) ?? 0;
    totals.weighted += weightedValue(d, defaultPrice);
  }
  totals.potentialMrr = round2(totals.potentialMrr);
  totals.potentialArr = round2(totals.potentialMrr * 12);
  totals.implementation = round2(totals.implementation);
  totals.weighted = round2(totals.weighted);
  return totals;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function usd(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: opts.cents ? 2 : 0, minimumFractionDigits: opts.cents ? 2 : 0,
  }).format(n);
}
