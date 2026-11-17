import type { CropKind, TreeArrays } from './types';
import type { SoilParams } from './params';
// 适配修改：保留上游土壤计算，补全Node.js原生TypeScript加载所需的扩展名。
import { CROP_PARAMS } from './params.ts';

export function tawMm(soil: SoilParams, rootDepthM: number): number {
  return 1000 * (soil.thetaFc - soil.thetaWp) * rootDepthM;
}

export function kcFor(crop: CropKind, ageYears: number): number {
  const p = CROP_PARAMS[crop];
  if (crop === 'coconut') return p.kcMid;
  if (ageYears < 0.25) return p.kcIni;
  if (ageYears < 0.5) return p.kcDev;
  return p.kcMid;
}

const DIURNAL_ET_FRACTION: readonly number[] = (() => {
  const raw = new Array<number>(24);
  let norm = 0;
  for (let h = 0; h < 24; h++) {
    const v = h >= 6 && h <= 17 ? Math.sin((Math.PI * (h + 0.5 - 6)) / 12) : 0;
    raw[h] = v;
    norm += v;
  }
  for (let h = 0; h < 24; h++) raw[h] /= norm;
  return raw;
})();

export function diurnalEtFraction(hourOfDay: number): number {
  const h = Math.min(23, Math.max(0, Math.floor(hourOfDay)));
  return DIURNAL_ET_FRACTION[h];
}

export interface HourFlux {
  etcMm: number;
  etaMm: number;
  drainageMm: number;
  runoffMm: number;
  ks: number;
}

export function stepBucket(
  t: TreeArrays,
  i: number,
  rainMm: number,
  irrigationMm: number,
  etcMm: number,
  infiltrationMmPerHour: number,
): HourFlux {
  const runoffMm = Math.max(0, rainMm - infiltrationMmPerHour);
  const infiltrated = rainMm - runoffMm;

  const taw = t.tawMm[i];
  const raw = t.rawMm[i];

  let dr = t.drMm[i] - infiltrated - irrigationMm;
  let drainageMm = 0;
  if (dr < 0) {
    drainageMm = -dr;
    dr = 0;
  }

  let ks: number;
  if (dr <= raw) {
    ks = 1;
  } else if (taw === raw) {
    ks = 0;
  } else {
    ks = Math.max(0, (taw - dr) / (taw - raw));
  }

  const etaMm = ks * etcMm;
  dr = Math.min(taw, dr + etaMm);

  t.drMm[i] = dr;
  t.ks[i] = ks;
  t.etcCumMm[i] += etcMm;
  t.etaCumMm[i] += etaMm;

  return { etcMm, etaMm, drainageMm, runoffMm, ks };
}
