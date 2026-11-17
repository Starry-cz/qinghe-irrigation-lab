import { stepBucket } from './vendor/agri-sim/soil.ts';

export function moistureFraction(reading, config) {
  const fraction = (reading - config.sensorMin) / (config.sensorMax - config.sensorMin);
  return config.higherMeansWetter ? fraction : 1 - fraction;
}
export function sensorReading(fraction, config) {
  const value = config.higherMeansWetter ? fraction : 1 - fraction;
  return Math.round(config.sensorMin + value * (config.sensorMax - config.sensorMin));
}
export function decideIrrigation(reading, weather, rule, config) {
  const dry = config.higherMeansWetter ? reading < rule.threshold : reading > rule.threshold;
  return dry && !(rule.skipRain && weather === 'rainy');
}
export function simulate(input, rule, config) {
  // 复用agri-sim水量平衡，将果园小时尺度换算为单花盆的分钟步长。
  const capacity = config.soilCapacityMm;
  const state = {
    tawMm: [capacity], rawMm: [capacity * 0.5],
    drMm: [(1 - moistureFraction(input.moisture, config)) * capacity],
    ks: [1], etcCumMm: [0], etaCumMm: [0],
  };
  const connected = input.sensorConnected && input.pumpConnected;
  const decision = connected && decideIrrigation(input.moisture, input.weather, rule, config);
  let totalMl = 0;
  let drainageMl = 0;
  const series = [{ minute: 0, reading: input.moisture, waterMl: 0, pumpOn: decision }];
  for (let minute = 1; minute <= 30; minute++) {
    const on = decision && minute <= rule.minutes;
    const waterMl = on ? config.pumpMlPerMinute : 0;
    totalMl += waterMl;
    const rain = input.actualRain ? config.rainMmPerHour / 60 : 0;
    const flux = stepBucket(state, 0, rain, waterMl / 1000 / config.potAreaM2,
      config.evaporationMmPerHour / 60, 20 / 60);
    drainageMl += flux.drainageMm * config.potAreaM2 * 1000;
    series.push({ minute, reading: sensorReading(1 - state.drMm[0] / capacity, config), waterMl: totalMl, pumpOn: on });
  }
  return { decision, connected, waterMl: totalMl, drainageMl: Math.round(drainageMl),
    finalMoisture: series.at(-1).reading, series, rule: { ...rule }, input: { ...input } };
}
