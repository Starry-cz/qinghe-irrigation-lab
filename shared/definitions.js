// 教学流程和暂定参数集中管理，每名学生首次进入时保存配置快照。
export const CONDITIONS = {
  'active-hint': { label: '主动 · 线索', active: true, detailed: false },
  'active-detailed': { label: '主动 · 详细解释', active: true, detailed: true },
  'responsive-hint': { label: '响应 · 线索', active: false, detailed: false },
  'responsive-detailed': { label: '响应 · 详细解释', active: false, detailed: true },
};
export const STAGES = [
  { id: 0, title: '观察与猜想', short: '提出问题', description: '阅读运行记录，提出你的初步猜想。' },
  { id: 1, title: '设计与测试', short: '寻找证据', description: '改变实验条件，观察系统如何作出决定。' },
  { id: 2, title: '优化灌溉规则', short: '改进方案', description: '根据证据修改规则，并测试你的方案。' },
  { id: 3, title: '验证与解释', short: '验证方案', description: '用不同条件检验方案，解释它的适用范围。' },
  { id: 4, title: '总结与迁移', short: '形成结论', description: '回顾证据和修改过程，完成实验报告。' },
];
export const DEFAULT_CONFIG = {
  title: '物联花盆自动灌溉系统',
  description: '根据土壤湿度与天气数据，发现问题，测试并改进自动灌溉规则。',
  sensorMin: 0, sensorMax: 4095, higherMeansWetter: true,
  initialRule: { threshold: 2800, skipRain: false, minutes: 10 },
  referenceRule: { threshold: 2800, skipRain: true, minutes: 10 },
  pumpMlPerMinute: 35, potAreaM2: 0.05, soilCapacityMm: 60,
  evaporationMmPerHour: 0.3, rainMmPerHour: 6,
  idleSeconds: 120, repeatCount: 3, cooldownSeconds: 45,
  allowHelpBeforeHypothesis: false, activeCanAsk: true,
  minExploreTests: 2, minVerifyTests: 2, assessmentEnabled: true,
  stages: STAGES,
  scenarios: [
    { id: 'A', moisture: 1800, weather: 'sunny', decision: true },
    { id: 'B', moisture: 2500, weather: 'rainy', decision: true },
    { id: 'C', moisture: 3200, weather: 'sunny', decision: false },
  ],
};
export const ASSESSMENT = [
  { id: 'sensor', question: '土壤湿度传感器的主要作用是什么？', choices: ['采集土壤干湿信息', '给水泵供电', '预测所有天气', '直接给植物浇水'], answer: 0 },
  { id: 'control', question: '自动灌溉系统中的控制器主要负责什么？', choices: ['储存灌溉用水', '根据数据和规则作出决策', '改变土壤种类', '保证每次都灌溉'], answer: 1 },
  { id: 'evidence', question: '想了解天气条件是否影响系统决策，怎样比较更有帮助？', choices: ['同时改变所有条件', '只观察一次结果', '保持湿度相同，改变天气条件', '只看水泵颜色'], answer: 2 },
  { id: 'transfer', question: '修改规则后，哪种做法更能支持你的结论？', choices: ['只挑选成功的结果', '不用测试直接提交', '沿用修改前的结论', '用多种条件验证并记录结果'], answer: 3 },
];
export const WEATHER = { sunny: '晴天', cloudy: '多云', rainy: '预报有雨' };
export const jsonClone = value => JSON.parse(JSON.stringify(value));
// 参考规则仅用于教师统计，初始规则在学生进入修改阶段前不下发。
export function publicConfig(config) {
  const { referenceRule, initialRule, ...visible } = config;
  return visible;
}
export function assessmentQuestions() {
  return ASSESSMENT.map(({ answer, ...question }) => question);
}
