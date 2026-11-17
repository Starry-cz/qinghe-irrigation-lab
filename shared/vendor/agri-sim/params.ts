// Parameter tables. Values marked EST are engineering estimates to be retuned from field data.
// Sources: FAO-56 (https://www.fao.org/4/x0490e/x0490e00.htm) tables 12 and 22;
// UF/IFAS AE540 (papaya Kc); FAO-33 / FAO i2800e (Ky); CRISL fertilizer guidance;
// PMC11816148 (toque macaque crop raiding); Mongabay 2023 (Sri Lankan crop-raiding species).
import type { ClimateZone, CropKind, DetectorKind, DeterrentKind, PumpSpec, Scenario, SoilType, Species } from './types';

export interface CropParams {
  kcIni: number;
  kcDev: number;
  kcMid: number;
  rootDepthM: number;
  p: number;              // FAO-56 depletion fraction before stress
  ky: number;             // FAO-33 yield response factor
  rootAreaM2: number;     // wetted/root area per tree (EST: coconut r~1.5 m, papaya r~1.1 m)
  potentialYieldPerYear: number; // coconut: nuts/palm/yr; papaya: kg/plant/yr (EST)
  nDemandGPerYear: number;  // crop N uptake need (EST; below recommended rates, which include losses)
  kDemandGPerYear: number;  // crop K2O-eq uptake need (EST)
  nutrientTauDays: number;  // how slowly nutrient status responds (coconut has a ~12-month yield lag)
}

export const CROP_PARAMS: Record<CropKind, CropParams> = {
  // FAO-56 Table 12 "palm trees" Kc 0.95/1.00/1.00; Table 22 Zr 0.7-1.1, p 0.65.
  coconut: { kcIni: 0.95, kcDev: 1.0, kcMid: 1.0, rootDepthM: 1.0, p: 0.65, ky: 0.9, rootAreaM2: 7.0, potentialYieldPerYear: 60, nDemandGPerYear: 300, kDemandGPerYear: 800, nutrientTauDays: 120 },
  // UF/IFAS AE540 gives 1.0/1.2/1.5; mid capped at 1.2 (EST, 1.5 is high vs FAO norms). Ky 1.2 banana-like (EST).
  papaya: { kcIni: 1.0, kcDev: 1.1, kcMid: 1.2, rootDepthM: 0.6, p: 0.5, ky: 1.2, rootAreaM2: 4.0, potentialYieldPerYear: 50, nDemandGPerYear: 200, kDemandGPerYear: 400, nutrientTauDays: 21 },
};

export interface SoilParams {
  label: string;
  thetaFc: number;          // m3/m3
  thetaWp: number;          // m3/m3
  infiltrationMmPerHour: number; // rain above this per hour becomes runoff
}

export const SOIL_PARAMS: Record<SoilType, SoilParams> = {
  reddish_brown_earth: { label: 'Reddish Brown Earth (sandy clay loam)', thetaFc: 0.26, thetaWp: 0.12, infiltrationMmPerHour: 20 },
  sandy_regosol: { label: 'Sandy regosol (coastal sand)', thetaFc: 0.1, thetaWp: 0.04, infiltrationMmPerHour: 100 },
  red_yellow_podzolic: { label: 'Red-Yellow Podzolic (wet-zone loam)', thetaFc: 0.3, thetaWp: 0.15, infiltrationMmPerHour: 15 },
};

export interface ClimateParams {
  label: string;
  // Index 0 = January. Monthly totals (mm) and mean daily max/min temperature (C). EST climatologies:
  // dry ~ Anuradhapura, intermediate ~ Kurunegala, wet ~ Colombo.
  rainMm: number[];
  wetDaysPerMonth: number[];
  tmaxC: number[];
  tminC: number[];
}

export const CLIMATE_PARAMS: Record<ClimateZone, ClimateParams> = {
  dry: {
    label: 'Dry zone (<1750 mm)',
    rainMm: [90, 45, 70, 180, 60, 15, 25, 35, 70, 250, 280, 220],
    wetDaysPerMonth: [7, 4, 6, 12, 5, 2, 3, 4, 7, 16, 17, 13],
    tmaxC: [30, 32, 34, 34, 34, 33, 33, 33, 33, 32, 30, 29],
    tminC: [21, 21, 22, 24, 25, 25, 24, 24, 24, 23, 22, 21],
  },
  intermediate: {
    label: 'Intermediate zone (1750-2500 mm)',
    rainMm: [75, 60, 110, 250, 150, 90, 70, 60, 110, 330, 270, 150],
    wetDaysPerMonth: [6, 5, 8, 16, 12, 9, 7, 6, 9, 19, 17, 11],
    tmaxC: [30, 32, 33, 33, 32, 31, 31, 31, 31, 31, 30, 29],
    tminC: [21, 21, 22, 23, 24, 24, 23, 23, 23, 22, 22, 21],
  },
  wet: {
    label: 'Wet zone (>2500 mm)',
    rainMm: [60, 70, 120, 250, 350, 200, 130, 110, 250, 350, 300, 150],
    wetDaysPerMonth: [6, 6, 10, 17, 20, 18, 13, 12, 16, 20, 18, 11],
    tmaxC: [30, 31, 31, 31, 30, 29, 29, 29, 29, 29, 29, 29],
    tminC: [22, 22, 23, 24, 25, 25, 25, 25, 24, 23, 23, 22],
  },
};

// ---- Nutrients (M2). EST model constants; see nutrients.ts ----
export const NUTRIENTS = {
  initialPoolFracOfDemand: 0.25, // starting root-zone pool as a fraction of annual demand
  mobilityN: 1.0,                // nitrate moves with drainage water
  mobilityK: 0.25,               // potassium is held by soil clays
  broadcastEfficiency: 0.7,      // share of hand-spread fertilizer reaching roots (volatilisation, runoff)
  mitscherlichC: 3,              // curvature of the nutrient-to-yield response
};

// ---- Time-of-use tariff ----
export const PEAK_HOURS = { start: 18, end: 22 };    // [18, 22)
export const OFFPEAK_HOURS = { start: 22, end: 5 };  // [22, 24) and [0, 5)
export function tariffAt(pump: PumpSpec, hourOfDay: number): number {
  if (hourOfDay >= PEAK_HOURS.start && hourOfDay < PEAK_HOURS.end) return pump.peakTariffLkrPerKwh;
  if (hourOfDay >= OFFPEAK_HOURS.start || hourOfDay < OFFPEAK_HOURS.end) return pump.offPeakTariffLkrPerKwh;
  return pump.tariffLkrPerKwh;
}

// ---- Wildlife (M2). Behaviour from Sri Lankan field literature; efficacies are EST for study. ----
export type Activity = 'nocturnal' | 'diurnal' | 'crepuscular';
export interface SpeciesParams {
  label: string;
  protectedSpecies: boolean;   // FFPO-protected: humane, non-harmful deterrence only
  activity: Activity;
  seasonMult: number[];        // 12 months, idx0 = Jan
  groupMin: number;
  groupMax: number;
  climbs: boolean;             // stopped by trunk bands
  targets: CropKind[];
  fruitLossPerAnimal: { coconut: number; papaya: number };  // nuts / kg per animal per damaging visit
  plantDamagePerVisit: { coconut: number; papaya: number }; // fraction of the target tree's potential lost
  youngOnlyPlantDamage: boolean; // plant damage only on young trees (coconut < 4 y, papaya < 1.5 y)
}
export const YOUNG_TREE_YEARS: Record<CropKind, number> = { coconut: 4, papaya: 1.5 };

export const SPECIES_PARAMS: Record<Species, SpeciesParams> = {
  wild_boar: { label: 'Wild boar', protectedSpecies: false, activity: 'nocturnal', seasonMult: [1, 1, 1, 1, 1, 1.2, 1.2, 1.2, 1.2, 1, 1, 1], groupMin: 1, groupMax: 6, climbs: false, targets: ['papaya', 'coconut'], fruitLossPerAnimal: { coconut: 0, papaya: 0.5 }, plantDamagePerVisit: { coconut: 0.05, papaya: 0.04 }, youngOnlyPlantDamage: false },
  porcupine: { label: 'Porcupine', protectedSpecies: false, activity: 'nocturnal', seasonMult: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], groupMin: 1, groupMax: 2, climbs: false, targets: ['papaya', 'coconut'], fruitLossPerAnimal: { coconut: 0, papaya: 0 }, plantDamagePerVisit: { coconut: 0.04, papaya: 0.03 }, youngOnlyPlantDamage: true },
  macaque: { label: 'Toque macaque', protectedSpecies: false, activity: 'diurnal', seasonMult: [0.8, 0.8, 0.9, 0.9, 1, 1.2, 1.6, 1.6, 1.6, 1, 0.8, 0.8], groupMin: 5, groupMax: 30, climbs: true, targets: ['papaya', 'coconut'], fruitLossPerAnimal: { coconut: 1.5, papaya: 0.8 }, plantDamagePerVisit: { coconut: 0, papaya: 0 }, youngOnlyPlantDamage: false },
  giant_squirrel: { label: 'Giant squirrel', protectedSpecies: true, activity: 'diurnal', seasonMult: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], groupMin: 1, groupMax: 2, climbs: true, targets: ['coconut'], fruitLossPerAnimal: { coconut: 1, papaya: 0 }, plantDamagePerVisit: { coconut: 0, papaya: 0 }, youngOnlyPlantDamage: false },
  peafowl: { label: 'Peafowl', protectedSpecies: true, activity: 'crepuscular', seasonMult: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], groupMin: 1, groupMax: 5, climbs: false, targets: ['papaya'], fruitLossPerAnimal: { coconut: 0, papaya: 0.4 }, plantDamagePerVisit: { coconut: 0, papaya: 0 }, youngOnlyPlantDamage: false },
  cattle: { label: 'Stray cattle', protectedSpecies: false, activity: 'diurnal', seasonMult: [1, 1, 1.2, 1.2, 1, 1, 1, 1, 1, 1, 1, 1], groupMin: 1, groupMax: 4, climbs: false, targets: ['papaya'], fruitLossPerAnimal: { coconut: 0, papaya: 0.3 }, plantDamagePerVisit: { coconut: 0.02, papaya: 0.03 }, youngOnlyPlantDamage: true },
};

/** Relative arrival weight per hour of day (0..23) for each activity pattern. */
export const ACTIVITY_HOURS: Record<Activity, number[]> = {
  nocturnal:   [1, 1, 1, 1, 1, 0.3, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.3, 1, 1, 1, 1, 1],
  diurnal:     [0, 0, 0, 0, 0, 0.1, 1, 1, 1, 1, 1, 0.4, 0.3, 0.4, 1, 1, 1, 1, 0.3, 0, 0, 0, 0, 0],
  crepuscular: [0, 0, 0, 0, 0.3, 1, 1, 0.5, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.3, 1, 1, 0.3, 0, 0, 0, 0],
};

export interface DetectorParams { label: string; rangeM: number; recall: Record<Species, number>; falseAlarmsPerDay: number; unitLkr: number }
export const DETECTOR_PARAMS: Record<DetectorKind, DetectorParams> = {
  pir: { label: 'PIR motion sensor', rangeM: 12, recall: { wild_boar: 0.8, porcupine: 0.6, macaque: 0.6, giant_squirrel: 0.2, peafowl: 0.5, cattle: 0.9 }, falseAlarmsPerDay: 3, unitLkr: 2500 },
  camera_ai: { label: 'AI camera (Pi + IR cam)', rangeM: 25, recall: { wild_boar: 0.85, porcupine: 0.7, macaque: 0.9, giant_squirrel: 0.6, peafowl: 0.9, cattle: 0.95 }, falseAlarmsPerDay: 0.3, unitLkr: 45000 },
  thermal_ai: { label: 'AI thermal camera', rangeM: 30, recall: { wild_boar: 0.95, porcupine: 0.85, macaque: 0.85, giant_squirrel: 0.5, peafowl: 0.8, cattle: 0.97 }, falseAlarmsPerDay: 0.2, unitLkr: 60000 },
};

export interface DeterrentParams { label: string; rangeM: number; efficacy: Record<Species, number>; habituationPerExposure: number; recoveryDays: number; waterLPerActivation: number; energyKwhPerActivation: number; unitLkr: number }
export const DETERRENT_PARAMS: Record<DeterrentKind, DeterrentParams> = {
  strobe_light: { label: 'Strobe light', rangeM: 20, efficacy: { wild_boar: 0.6, porcupine: 0.5, macaque: 0.2, giant_squirrel: 0.1, peafowl: 0.4, cattle: 0.3 }, habituationPerExposure: 0.08, recoveryDays: 14, waterLPerActivation: 0, energyKwhPerActivation: 0.005, unitLkr: 8000 },
  predator_sound: { label: 'Predator / alarm sound', rangeM: 30, efficacy: { wild_boar: 0.5, porcupine: 0.4, macaque: 0.6, giant_squirrel: 0.3, peafowl: 0.5, cattle: 0.4 }, habituationPerExposure: 0.06, recoveryDays: 14, waterLPerActivation: 0, energyKwhPerActivation: 0.01, unitLkr: 12000 },
  water_jet: { label: 'Motion water jet', rangeM: 12, efficacy: { wild_boar: 0.7, porcupine: 0.6, macaque: 0.5, giant_squirrel: 0.4, peafowl: 0.7, cattle: 0.8 }, habituationPerExposure: 0.04, recoveryDays: 10, waterLPerActivation: 30, energyKwhPerActivation: 0.01, unitLkr: 10000 },
};

/** Passive barriers: probability the barrier stops that species. The fence habituates slowly. */
export const BARRIER_PARAMS = {
  energizer_fence: { efficacy: { wild_boar: 0.85, porcupine: 0.6, macaque: 0, giant_squirrel: 0, peafowl: 0.1, cattle: 0.95 } as Record<Species, number>, habituationPerExposure: 0.01, recoveryDays: 30, lkrPerMetre: 400 },
  trunk_bands: { efficacy: { wild_boar: 0, porcupine: 0, macaque: 0.6, giant_squirrel: 0.9, peafowl: 0, cattle: 0 } as Record<Species, number>, unitLkr: 1500 },
  netting: { efficacy: { wild_boar: 0, porcupine: 0, macaque: 0.5, giant_squirrel: 0.8, peafowl: 0.9, cattle: 0 } as Record<Species, number>, unitLkr: 300 },
};

/** Other capital items (EST, 2026 LKR). */
export const CAPEX_UNIT_LKR = {
  soilProbe: 3500,            // capacitive probe + node share
  fertigationInjector: 15000, // venturi kit
  controllerHub: 25000,       // Raspberry Pi controller + enclosure + valve share
};

/** Default: the owner's farm — 5 acres, intermediate zone, well + grid pump. */
export const DEFAULT_SCENARIO: Scenario = {
  schemaVersion: 2,
  name: 'My farm (default)',
  seed: 42,
  startDate: '2026-01-01',
  days: 365,
  climate: 'intermediate',
  latitudeDeg: 7.5,
  soil: 'reddish_brown_earth',
  soilVariability: 0.15,
  forecastSkill: 0.7,
  blocks: [
    { crop: 'coconut', count: 130, spacingM: 8, ageYears: 15, emittersPerTree: 4, emitterLph: 8 },
    { crop: 'papaya', count: 150, spacingM: 2.4, ageYears: 1, emittersPerTree: 2, emitterLph: 4 },
  ],
  // TOU rates EST (CEB-style): day 30, peak 18-22h 55, off-peak 22-05h 20 LKR/kWh.
  pump: { flowLpm: 100, headM: 30, efficiency: 0.45, tariffLkrPerKwh: 30, peakTariffLkrPerKwh: 55, offPeakTariffLkrPerKwh: 20 },
  controller: {
    kind: 'threshold',
    timerStartHour: 6,
    timerMinutes: 120,
    timerEveryDays: 1,
    thresholdDepletionFrac: 0.5,
    refillDepletionFrac: 0.1,
    skipIfRainMm24h: 10,
    mpcHorizonHours: 48,
    mpcMaxRunHours: 6,
    mpcTargetFrac: 0.8,
    mpcStressWeightLkr: 200,
    mpcDrainPenaltyLkrPerM3: 20,
  },
  // CRISL adult-palm straights: urea 800 g (368 g N) + MOP 1600 g (960 g K2O) per palm/yr.
  // Papaya 240:240:480 g N:P2O5:K2O per plant/yr (extension guidance). P is not modelled.
  fertigation: {
    enabled: true,
    method: 'fertigation',
    coconut: { nGPerYear: 368, kGPerYear: 960, splitsPerYear: 12 },
    papaya: { nGPerYear: 240, kGPerYear: 480, splitsPerYear: 12 },
    injectorEfficiency: 0.9,
    fertilizerLkrPerKgN: 450,
    fertilizerLkrPerKgK: 420,
  },
  // A maintained probe: ~0.06 Dr/TAW of bias per zone over a year. Raise drift to see an uncalibrated one over-water.
  sensors: { perZone: 3, noiseSd: 0.04, driftPerDay: 0.0005, failureRatePerYear: 0.1 },
  wildlife: {
    enabled: true,
    visitsPerWeek: { wild_boar: 1.5, porcupine: 1, macaque: 2, giant_squirrel: 3, peafowl: 2, cattle: 0.5 },
    detectors: { pir: 0, camera_ai: 4, thermal_ai: 0 },
    deterrents: { strobe_light: 4, predator_sound: 2, water_jet: 0 },
    perimeterFence: false,
    trunkBandsFrac: 0,
    nettingFrac: 0,
  },
  // APP_BLUEPRINT.md: farmgate nut Rs 110-155 (2025). Papaya price EST.
  prices: { coconutLkrPerNut: 120, papayaLkrPerKg: 100 },
};
