import { z } from 'zod';
import { CONDITIONS } from '../../shared/definitions.js';

export const text = z.string().trim().min(1, '请填写必要内容').max(5000);
export const conditionSchema = z.enum(Object.keys(CONDITIONS));
export const ruleSchema = z.object({ threshold: z.number().int(), skipRain: z.boolean(), minutes: z.number().int().min(1).max(30) });
export const trialSchema = z.object({
  moisture: z.number().int(), weather: z.enum(['sunny', 'cloudy', 'rainy']), actualRain: z.boolean(),
  sensorConnected: z.boolean(), pumpConnected: z.boolean(),
  prediction: z.enum(['irrigate', 'wait', 'unsure']), question: z.string().max(1000).default(''),
});
export const stageSchemas = [
  z.object({ problem: text, variable: z.enum(['moisture', 'weather', 'both', 'unsure']), reason: text }),
  z.object({ plan: text, evidence: text }),
  z.object({ reason: text }),
  z.object({ analysis: text, limitation: text }),
  z.object({ conclusion: text, transfer: text }),
];
export const configSchema = z.object({
  title: z.string().trim().min(1).max(100), description: z.string().max(1000),
  sensorMin: z.number().int().min(0).max(100000), sensorMax: z.number().int().min(1).max(100000),
  higherMeansWetter: z.boolean(), initialRule: ruleSchema, referenceRule: ruleSchema,
  pumpMlPerMinute: z.number().positive().max(1000), potAreaM2: z.number().min(0.01).max(10),
  soilCapacityMm: z.number().min(1).max(1000), evaporationMmPerHour: z.number().min(0).max(100),
  rainMmPerHour: z.number().min(0).max(100),
  idleSeconds: z.number().int().min(10).max(3600), repeatCount: z.number().int().min(2).max(20),
  cooldownSeconds: z.number().int().min(0).max(3600),
  allowHelpBeforeHypothesis: z.boolean(), activeCanAsk: z.boolean(), assessmentEnabled: z.boolean(),
  minExploreTests: z.number().int().min(1).max(20), minVerifyTests: z.number().int().min(1).max(20),
  stages: z.array(z.object({ id: z.number().int(), title: text, short: text, description: text })).length(5),
  scenarios: z.array(z.object({ id: text, moisture: z.number().int(), weather: z.enum(['sunny','cloudy','rainy']), decision: z.boolean() })).min(1).max(20),
}).superRefine((c, ctx) => {
  if (c.sensorMax <= c.sensorMin) ctx.addIssue({ code: 'custom', message: '传感器最大值必须大于最小值' });
  for (const r of [c.initialRule, c.referenceRule]) {
    if (r.threshold < c.sensorMin || r.threshold > c.sensorMax) ctx.addIssue({ code: 'custom', message: '规则阈值必须处于传感器范围内' });
  }
  if (c.scenarios.some(s => s.moisture < c.sensorMin || s.moisture > c.sensorMax)) ctx.addIssue({ code: 'custom', message: '初始记录的读数必须处于传感器范围内' });
  if (c.stages.some((s, i) => s.id !== i)) ctx.addIssue({ code: 'custom', message: '阶段编号必须依次为0至4' });
});
