import { addMonths } from './deposits.js';
import { addDays } from '../lib/dates.js';

/**
 * Every Sovereign Gold Bond series by its NSE symbol: the issue date and the issue price (₹ a
 * gram, before the online discount). The RBI's tranche list (67 series, 2015-I to 2023-24 IV),
 * joined to NSE's symbols by ISIN. No series has been issued since February 2024.
 */
const SERIES: Record<string, [issued: string, price: number]> = {
  SGBNOV23: ['2015-11-30', 2684],
  SGBFEB24: ['2016-02-08', 2600],
  SGBMAR24: ['2016-03-29', 2916],
  SGBAUG24: ['2016-08-05', 3119],
  SGBSEP24: ['2016-09-30', 3150],
  SGBNOV24: ['2016-11-17', 3007],
  SGBMAR25: ['2017-03-17', 2943],
  SGBMAY25: ['2017-05-12', 2951],
  SGBJUL25: ['2017-07-28', 2830],
  SGBOCT25: ['2017-10-16', 2956],
  SGBOCT25IV: ['2017-10-23', 2987],
  SGBOCT25V: ['2017-10-30', 2971],
  SGBNOV25VI: ['2017-11-06', 2945],
  SGBNOV25: ['2017-11-13', 2934],
  SGBNOV258: ['2017-11-20', 2961],
  SGBNOV25IX: ['2017-11-27', 2964],
  SGBDEC25: ['2017-12-04', 2961],
  SGBDEC25XI: ['2017-12-11', 2952],
  SGBDEC2512: ['2017-12-18', 2890],
  SGBDEC2513: ['2017-12-26', 2866],
  SGBJAN26: ['2018-01-01', 2881],
  SGBMAY26: ['2018-05-04', 3114],
  SGBOCT26: ['2018-10-23', 3146],
  SGBNOV26: ['2018-11-13', 3183],
  SGBDEC26: ['2019-01-01', 3119],
  SGBJAN27: ['2019-01-22', 3214],
  SGBFEB27: ['2019-02-12', 3326],
  SGBJUN27: ['2019-06-11', 3196],
  SGBJUL27: ['2019-07-16', 3443],
  SGBAUG27: ['2019-08-14', 3499],
  SGBSEP27: ['2019-09-17', 3890],
  SGBOCT27: ['2019-10-15', 3788],
  SGBOCT27VI: ['2019-10-30', 3835],
  SGBDC27VII: ['2019-12-10', 3795],
  SGBJ28VIII: ['2020-01-21', 4016],
  SGBFEB28IX: ['2020-02-11', 4070],
  SGBMAR28X: ['2020-03-11', 4260],
  SGBAPR28I: ['2020-04-28', 4639],
  SGBMAY28: ['2020-05-19', 4590],
  SGBJUN28: ['2020-06-16', 4677],
  SGBJUL28IV: ['2020-07-14', 4852],
  SGBAUG28V: ['2020-08-11', 5334],
  SGBSEP28VI: ['2020-09-08', 5117],
  SGBOC28VII: ['2020-10-20', 5051],
  SGBN28VIII: ['2020-11-18', 5177],
  SGBJAN29IX: ['2021-01-05', 5000],
  SGBJAN29X: ['2021-01-19', 5104],
  SGBFEB29XI: ['2021-02-09', 4912],
  SGBMR29XII: ['2021-03-09', 4662],
  SGBMAY29I: ['2021-05-25', 4777],
  SGBJUN29II: ['2021-06-01', 4842],
  SGBJU29III: ['2021-06-08', 4889],
  SGBJUL29IV: ['2021-07-20', 4807],
  SGBAUG29V: ['2021-08-17', 4790],
  SGBSEP29VI: ['2021-09-07', 4732],
  SGBNV29VII: ['2021-11-02', 4761],
  SGBD29VIII: ['2021-12-07', 4791],
  SGBJAN30IX: ['2022-01-18', 4786],
  SGBMAR30X: ['2022-03-08', 5109],
  SGBJUN30: ['2022-06-28', 5091],
  SGBAUG30: ['2022-08-30', 5197],
  SGBDE30III: ['2022-12-27', 5409],
  SGBMAR31IV: ['2023-03-14', 5611],
  SGBJUN31I: ['2023-06-27', 5926],
  SGBSEP31II: ['2023-09-20', 5923],
  SGBDE31III: ['2023-12-28', 6199],
  SGBFEB32IV: ['2024-02-21', 6263],
};

/** Every series' issue price (rupees a gram), dated by its issue: RBI's IBJA averages. */
export function goldBondIssues(): { date: string; price: number }[] {
  return Object.values(SERIES)
    .map(([issued, price]) => ({ date: issued, price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A series' issue date and issue price (rupees), or null for anything else. */
export function goldBond(symbol: string): { issued: string; price: number } | null {
  const s = SERIES[symbol];
  return s ? { issued: s[0], price: s[1] } : null;
}

/**
 * The interest a bond earned between `from` and `to` (ISO days, both included): 2.5% a year of the
 * issue price, paid every six months from the issue until it matures eight years on, and dated
 * like a broker's report — the record date, 15 days before the payment. `perUnit` is micros.
 */
export function goldBondInterest(
  symbol: string,
  from: string,
  to: string,
): { exDate: string; perUnit: number }[] {
  const bond = goldBond(symbol);
  if (!bond) return [];
  const perUnit = bond.price * 12_500; // × 1.25% × 10^6
  const out: { exDate: string; perUnit: number }[] = [];
  for (let k = 1; k <= 16; k++) {
    const exDate = addDays(addMonths(bond.issued, 6 * k), -15);
    if (exDate > to) break;
    if (exDate >= from) out.push({ exDate, perUnit });
  }
  return out;
}

/** Paise for `units` (micro-units) at `perUnit` (micros), rounded down as RBI pays. */
export function interestPaise(units: number, perUnit: number): number {
  return Math.floor((units / 1_000_000) * (perUnit / 10_000) + 1e-9);
}
