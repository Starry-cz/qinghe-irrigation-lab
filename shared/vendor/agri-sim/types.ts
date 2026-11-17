// Shared contract for the simulation engine, controllers, worker and UI.
// Units are in names: Mm = millimetres of water depth, L = litres, M3 = cubic metres,
// Lph = litres per hour, Lpm = litres per minute, Kwh, Lkr = Sri Lankan rupees, G = grams.
// The engine advances in fixed 1-hour steps. `hour` counts from 0 at scenario start (00:00 local).
// "K" nutrient amounts are K2O-equivalent grams (as fertilizer labels state them).

export type CropKind = 'coconut' | 'papaya';
export const CROP_INDEX: Record<CropKind, number> = { coconut: 0, papaya: 1 };
export const CROPS: readonly CropKind[] = ['coconut', 'papaya'];

export type ClimateZone = 'dry' | 'intermediate' | 'wet';
export type SoilType = 'reddish_brown_earth' | 'sandy_regosol' | 'red_yellow_podzolic';
export type ControllerKind = 'none' | 'timer' | 'threshold' | 'mpc';
export const CONTROLLER_KINDS: readonly ControllerKind[] = ['none', 'timer', 'threshold', 'mpc'];

// ---- Wildlife vocabulary (M2) ----
export type Species = 'wild_boar' | 'porcupine' | 'macaque' | 'giant_squirrel' | 'peafowl' | 'cattle';
export const SPECIES: readonly Species[] = ['wild_boar', 'porcupine', 'macaque', 'giant_squirrel', 'peafowl', 'cattle'];
export type DetectorKind = 'pir' | 'camera_ai' | 'thermal_ai';
export const DETECTOR_KINDS: readonly DetectorKind[] = ['pir', 'camera_ai', 'thermal_ai'];
/** Active, humane deterrents fired on detection. Nothing here harms animals. */
export type DeterrentKind = 'strobe_light' | 'predator_sound' | 'water_jet';
export const DETERRENT_KINDS: readonly DeterrentKind[] = ['strobe_light', 'predator_sound', 'water_jet'];
/** Passive barriers. `energizer_fence` is a legal pulsed low-energy fence — never mains-connected. */
export type BarrierKind = 'energizer_fence' | 'trunk_bands' | 'netting';
export type IncursionOutcome = 'fenced' | 'repelled' | 'blocked' | 'damage';

export interface CropBlock {
  crop: CropKind;
  count: number;          // number of trees
  spacingM: number;       // square-grid spacing between trees
  ageYears: number;       // drives Kc stage for papaya (<0.25 ini, <0.5 dev, else mid)
  emittersPerTree: number;
  emitterLph: number;     // drip emitter flow at design pressure
}

export interface PumpSpec {
  flowLpm: number;        // max pump flow
  headM: number;          // total dynamic head (well lift + friction + emitter pressure)
  efficiency: number;     // wire-to-water, 0..1
  // Time-of-use tariff (CEB style): peak 18:00-22:00, off-peak 22:00-05:00, day otherwise.
  tariffLkrPerKwh: number;        // day rate
  peakTariffLkrPerKwh: number;
  offPeakTariffLkrPerKwh: number;
}

export interface ControllerParams {
  kind: ControllerKind;
  // timer
  timerStartHour: number;      // 0..23 local hour
  timerMinutes: number;        // run time per watering
  timerEveryDays: number;      // 1 = daily
  // threshold (sensor-driven, with hysteresis)
  thresholdDepletionFrac: number; // open valve when zone Dr/TAW >= this (e.g. 0.5)
  refillDepletionFrac: number;    // close valve when zone Dr/TAW <= this (e.g. 0.1)
  skipIfRainMm24h: number;        // threshold controller skips opening if rain in last 24h >= this
  // mpc (model predictive control: plans ahead with the weather forecast and tariff)
  mpcHorizonHours: number;        // e.g. 48
  mpcMaxRunHours: number;         // longest single watering it may plan, e.g. 6
  mpcTargetFrac: number;          // keep Dr/TAW below targetFrac * p (e.g. 0.8)
  mpcStressWeightLkr: number;     // penalty per zone-hour per unit of Dr/TAW above target
  mpcDrainPenaltyLkrPerM3: number; // value of water+nutrients lost to deep drainage
}

export interface FertigationParams {
  enabled: boolean;               // false = no fertilizer at all (to see deficiency)
  method: 'fertigation' | 'broadcast'; // injected through the drip line vs spread by hand
  coconut: { nGPerYear: number; kGPerYear: number; splitsPerYear: number };
  papaya: { nGPerYear: number; kGPerYear: number; splitsPerYear: number };
  injectorEfficiency: number;     // 0..1 of injected dose reaching the root zone (venturi ~0.9)
  fertilizerLkrPerKgN: number;
  fertilizerLkrPerKgK: number;
}

export interface SensorParams {
  /** Soil-moisture probes per zone. 0 = ideal perfect sensing (the M1 behaviour). */
  perZone: number;
  noiseSd: number;            // std-dev of reading noise, in Dr/TAW units (e.g. 0.04)
  driftPerDay: number;        // bias growth per day, Dr/TAW units (e.g. 0.002)
  failureRatePerYear: number; // chance per probe per year of failing stuck at its last value
}

export interface WildlifeParams {
  enabled: boolean;
  visitsPerWeek: Record<Species, number>;   // base pressure before season/hour shaping
  detectors: Record<DetectorKind, number>;  // device counts
  deterrents: Record<DeterrentKind, number>; // device counts
  perimeterFence: boolean;                  // legal energizer (pulsed, low-energy) fence
  trunkBandsFrac: number;                   // 0..1 of coconut palms with metal trunk bands
  nettingFrac: number;                      // 0..1 of papaya with fruit nets/bags
}

export interface Scenario {
  schemaVersion: 2;
  name: string;
  seed: number;            // uint32; same scenario + seed => identical run
  startDate: string;       // 'YYYY-MM-DD'
  days: number;
  climate: ClimateZone;
  latitudeDeg: number;     // Sri Lanka ~6..10 N
  soil: SoilType;
  soilVariability: number; // 0..0.5, per-tree random multiplier spread on TAW (0.15 = +/-15%)
  forecastSkill: number;   // 0..1: how well the rain forecast matches reality (MPC input)
  blocks: CropBlock[];
  pump: PumpSpec;
  controller: ControllerParams;
  fertigation: FertigationParams;
  sensors: SensorParams;
  wildlife: WildlifeParams;
  prices: { coconutLkrPerNut: number; papayaLkrPerKg: number };
}

/** One day of weather, produced by the weather generator. */
export interface WeatherDay {
  dayIndex: number;   // 0-based from scenario start
  doy: number;        // day of year 1..366
  month: number;      // 1..12
  tmaxC: number;
  tminC: number;
  rainMm: number;     // daily total
  rainHourly: number[]; // length 24, sums to rainMm
  raMm: number;       // extraterrestrial radiation, mm/day equivalent
  et0Mm: number;      // Hargreaves reference ET, mm/day
}

/** Struct-of-arrays tree state. Index i is the same tree across all arrays. */
export interface TreeArrays {
  n: number;
  crop: Uint8Array;        // CROP_INDEX value
  zone: Uint8Array;        // irrigation zone index
  x: Float32Array;         // metres, farm-local, origin at farm centre
  z: Float32Array;
  rootAreaM2: Float32Array; // wetted/root area the bucket spans; L = mm * m2
  tawMm: Float32Array;     // total available water
  rawMm: Float32Array;     // readily available water = p * TAW
  drMm: Float32Array;      // root-zone depletion, 0..TAW (0 = field capacity)
  ks: Float32Array;        // last-hour water stress coefficient 0..1
  etcCumMm: Float64Array;  // cumulative potential crop ET
  etaCumMm: Float64Array;  // cumulative actual ET
  irrCumL: Float64Array;   // cumulative irrigation received
  ageYears: Float32Array;  // age at scenario start (from its block)
  ksDaySum: Float32Array;  // sum of hourly ks within the current day (engine-internal)
  stressDays: Float32Array; // days whose mean ks < 0.8
  // M2 — nutrients
  nPoolG: Float32Array;    // plant-available N in the root zone
  kPoolG: Float32Array;    // plant-available K2O-eq in the root zone
  niN: Float32Array;       // smoothed N sufficiency index 0..1 (1 = fully supplied)
  niK: Float32Array;
  nutFactorSum: Float64Array; // sum over hours of min(f(niN), f(niK)) — mean gives yield factor
  // M2 — wildlife
  fruitLoss: Float32Array;   // coconut: nuts lost; papaya: kg lost
  plantDamage: Float32Array; // 0..1 fraction of this tree's yield potential destroyed
}

export interface ZoneState {
  crop: CropKind;
  treeIdx: number[];      // tree indices in this zone
  designFlowLph: number;  // sum of emitters in zone at design pressure
  valveOpen: boolean;     // state during the last step
  pendingNGPerTree: number; // fertigation dose waiting for the next irrigation
  pendingKGPerTree: number;
}

export interface Totals {
  rainMm: number;           // farm-mean rainfall
  irrigationM3: number;
  drainageM3: number;       // deep percolation below root zone
  runoffM3: number;
  etaM3: number;
  pumpHours: number;
  energyKwh: number;
  energyCostLkr: number;
  // M2
  fertilizerNKg: number;    // bought on each split day (fertigation doses reach roots only when the zone runs)
  fertilizerKKg: number;
  fertilizerCostLkr: number;
  leachedNKg: number;
  leachedKKg: number;
  wildlifeLossLkr: number;
}

export interface DailyRecord {
  day: number;
  date: string;             // YYYY-MM-DD
  rainMm: number;
  et0Mm: number;
  irrigationM3: number;
  energyKwh: number;
  meanDepletionFrac: [number, number]; // per crop [coconut, papaya], Dr/TAW mean at end of day
  meanKs: [number, number];            // per crop, mean over the day
  // M2
  energyCostLkr: number;
  nutrientIndex: [number, number];     // per crop mean of min(niN, niK) at end of day
  leachedNKg: number;
  incursions: number;                  // animal groups that entered this day
  wildlifeLossLkr: number;
  sensedDepletionFrac: number[];       // per zone, what the controller saw at 23:00
}

// ---- Sensors (M2) ----
export interface Probe {
  zone: number;
  tree: number;          // tree index the probe sits under
  bias: number;          // current drift bias, Dr/TAW units
  failed: boolean;       // stuck at stuckValue
  stuckValue: number;
  lastReading: number;
}
export interface SensorState { probes: Probe[] }

// ---- Wildlife (M2) ----
export interface Incursion {
  id: number;
  hour: number;
  species: Species;
  groupSize: number;
  fromX: number; fromZ: number;   // entry point on the farm edge
  toX: number; toZ: number;       // target tree position
  targetTree: number;
  detectedBy: DetectorKind | null;
  deterredBy: DeterrentKind | BarrierKind | null;
  outcome: IncursionOutcome;
  lossLkr: number;
}
export interface WildlifeStats {
  incursions: Record<Species, number>;   // groups arrived
  damage: Record<Species, number>;       // groups that caused damage
  fenced: number;
  repelled: number;
  blocked: number;
  detections: number;
  falseAlarms: number;
  deterrentActivations: number;
  deterrentWaterM3: number;
  deterrentEnergyKwh: number;
  lossLkr: number;
  fruitLossNuts: number;
  fruitLossKg: number;
}
export interface WildlifeState {
  /** Habituation multiplier on each deterrent's efficacy per species, 1 = fresh, falls with exposure. */
  hab: Record<DeterrentKind, Record<Species, number>>;
  fenceHab: Record<Species, number>;
  nextId: number;
  stats: WildlifeStats;
  recent: Incursion[];    // last <= 500 incursions, oldest first
}

export interface SimState {
  hour: number;
  scenario: Scenario;
  weather: WeatherDay[];    // pre-generated for all days
  trees: TreeArrays;
  zones: ZoneState[];
  ctrl: ControllerMemory;
  totals: Totals;
  daily: DailyRecord[];
  rain24h: number[];        // last 24 hourly rain values (farm-wide), oldest first
  dayAcc: { irrigationM3: number; energyKwh: number; ksSum: [number, number]; energyCostLkr: number; leachedNKg: number; incursions: number; wildlifeLossLkr: number };
  // M2
  sensors: SensorState;
  wildlife: WildlifeState;
  lastSensed: number[];     // per zone, the depletion the controller saw last hour
  lastIncursions: Incursion[]; // incursions of the hour just simulated
  lastDeterrentsFired: DeterrentKind[];
  farmWidthM: number;
  farmDepthM: number;
  banded: Uint8Array;       // 1 where a coconut has trunk bands
  netted: Uint8Array;       // 1 where a papaya is netted
  rngs: { sensors: RngLike; wildlife: RngLike }; // separate seeded streams per subsystem
}

/** Structural twin of rng.ts Rng, so types.ts stays dependency-free. */
export interface RngLike { next(): number; int(maxExclusive: number): number; normal(): number }

/** Opaque per-zone memory the controller keeps between steps. */
export interface ControllerMemory {
  zoneOn: boolean[];        // threshold controller hysteresis latch per zone
}

/** Static per-zone facts a model-based controller needs. */
export interface ZoneModel {
  tawMm: number;          // zone-mean TAW
  pFrac: number;          // FAO-56 p for the crop
  kc: number;             // current crop coefficient
  irrMmPerHour: number;   // depth added per hour of watering (at design flow, pump-capped)
  energyKwhPerHour: number; // pump energy per hour watering this zone alone
  rootAreaM2: number;     // total root-zone area of the zone (for m3 conversions)
}

/** What the controller can observe each hour (what real sensors and services would report). */
export interface Observation {
  hour: number;             // absolute hour index
  hourOfDay: number;        // 0..23
  dayIndex: number;
  zoneDepletionFrac: number[]; // per zone Dr/TAW as SENSED (noise, drift, failures)
  rainLast24hMm: number;
  // M2 — forecast and model inputs (length = controller.mpcHorizonHours, starting this hour)
  forecastRainMm: number[];
  forecastEt0Mm: number[];     // hourly reference ET
  tariffLkrPerKwh: number[];
  zoneModel: ZoneModel[];
}

/** Per-zone fraction of the coming hour the valve is open, 0..1. */
export interface Action {
  valveOpenFrac: number[];
}

export interface CapexItem { label: string; qty: number; unitLkr: number; totalLkr: number }

export interface Kpis {
  days: number;
  waterM3: number;
  energyKwh: number;
  energyCostLkr: number;
  rainMm: number;
  drainageM3: number;
  runoffM3: number;
  stressDays: [number, number];     // per crop: mean over trees of days with daily mean Ks < 0.8
  relYield: [number, number];       // per crop 0..1, combined water x nutrient x damage factor
  waterYieldFactor: [number, number];    // FAO-33 water part only
  nutrientYieldFactor: [number, number]; // mean nutrient factor
  yieldUnits: [number, number];     // coconut nuts, papaya kg (scaled to scenario length, after losses)
  revenueLkr: number;
  netLkr: number;                   // revenue - energy - fertilizer (operating margin; capex excluded)
  waterProductivityLkrPerM3: number; // revenue / (irrigation m3), 0 if no irrigation
  // M2
  fertilizerCostLkr: number;
  leachedNKg: number;
  leachedKKg: number;
  wildlife: WildlifeStats;
  sensorFailures: number;
  capexLkr: number;
  capex: CapexItem[];
}

/** Everything the 3D scene needs for one frame. Arrays are copies (transferable). */
export interface Snapshot {
  hour: number;
  date: string;
  hourOfDay: number;
  weather: { rainMmThisHour: number; tmaxC: number; tminC: number; et0Mm: number };
  depletionFrac: Float32Array;  // per tree Dr/TAW
  ks: Float32Array;             // per tree
  valveOpen: boolean[];         // per zone
  totals: Totals;
  // M2
  nutrientIndex: Float32Array;  // per tree min(niN, niK)
  plantDamage: Float32Array;    // per tree
  probes: { tree: number; reading: number; failed: boolean }[];
  sensedDepletionFrac: number[]; // per zone
  incursions: Incursion[];      // incursions of the hour just simulated
  deterrentsFired: DeterrentKind[];
  tariffLkrPerKwh: number;      // tariff of the hour just simulated
}

export interface Device {
  kind: DetectorKind | DeterrentKind;
  x: number;
  z: number;
  rangeM: number;
}

/** Static data the scene needs once per scenario. */
export interface Layout {
  n: number;
  crop: Uint8Array;
  zone: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  farmWidthM: number;   // extent along x
  farmDepthM: number;   // extent along z
  zones: { crop: CropKind; treeCount: number }[];
  // M2
  devices: Device[];            // detectors and active deterrents, evenly placed
  probeTrees: number[];         // tree index of each soil probe
  perimeterFence: boolean;
  bandedTrees: Uint8Array;      // 1 where a coconut has trunk bands
  nettedTrees: Uint8Array;      // 1 where a papaya is netted
}

/** API the Web Worker exposes via comlink. The UI only talks to this. */
export interface SimApi {
  init(s: Scenario): Promise<Layout>;
  /** Advance `hours` steps (clamped at scenario end). advance(0) returns the current snapshot. */
  advance(hours: number): Promise<Snapshot>;
  daily(): Promise<DailyRecord[]>;
  kpis(): Promise<Kpis>;
  /** Recent animal incursions (most recent last), at most `limit`. */
  events(limit: number): Promise<Incursion[]>;
  /** Run a whole scenario headless (for comparing strategies). Does not touch the live sim. */
  runHeadless(s: Scenario): Promise<{ kpis: Kpis; daily: DailyRecord[] }>;
}
