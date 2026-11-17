import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../shared/definitions.js';
import { simulate, decideIrrigation, moistureFraction } from '../shared/simulation.js';
import { stepBucket } from '../shared/vendor/agri-sim/soil.ts';

const input = { moisture:1800,weather:'sunny',actualRain:false,sensorConnected:true,pumpConnected:true,prediction:'irrigate',question:'' };
test('初始规则复现原方案三条运行记录',()=>{
  for(const record of DEFAULT_CONFIG.scenarios) assert.equal(decideIrrigation(record.moisture,record.weather,DEFAULT_CONFIG.initialRule,DEFAULT_CONFIG),record.decision);
});
test('天气条件、连接状态和时长确实改变仿真结果',()=>{
  const wetWeather={...input,weather:'rainy'};
  const first=simulate(wetWeather,DEFAULT_CONFIG.initialRule,DEFAULT_CONFIG);
  const revised=simulate(wetWeather,DEFAULT_CONFIG.referenceRule,DEFAULT_CONFIG);
  assert.equal(first.waterMl,350);assert.equal(revised.waterMl,0);
  assert.ok(first.finalMoisture>revised.finalMoisture);
  const disconnected=simulate({...input,pumpConnected:false},DEFAULT_CONFIG.initialRule,DEFAULT_CONFIG);
  assert.equal(disconnected.decision,false);assert.equal(disconnected.connected,false);
  const shorter=simulate(input,{...DEFAULT_CONFIG.initialRule,minutes:5},DEFAULT_CONFIG);
  assert.equal(shorter.waterMl,175);
});
test('预报与实际降雨分离，降雨能改变土壤读数',()=>{
  const dry=simulate({...input,weather:'rainy'},DEFAULT_CONFIG.referenceRule,DEFAULT_CONFIG);
  const rainy=simulate({...input,weather:'rainy',actualRain:true},DEFAULT_CONFIG.referenceRule,DEFAULT_CONFIG);
  assert.equal(rainy.decision,false);assert.ok(rainy.finalMoisture>dry.finalMoisture);
  assert.deepEqual(rainy,simulate({...input,weather:'rainy',actualRain:true},DEFAULT_CONFIG.referenceRule,DEFAULT_CONFIG));
});
test('反向传感器标定与阈值边界',()=>{
  const config={...DEFAULT_CONFIG,higherMeansWetter:false};
  assert.equal(moistureFraction(0,config),1);
  assert.equal(decideIrrigation(3000,'sunny',config.initialRule,config),true);
  assert.equal(decideIrrigation(2800,'sunny',config.initialRule,config),false);
});
test('沿用上游水量平衡：多余灌溉排出，入渗上限产生径流',()=>{
  const state={tawMm:[140],rawMm:[91],drMm:[10],ks:[1],etcCumMm:[0],etaCumMm:[0]};
  const flux=stepBucket(state,0,50,30,0,20);
  assert.equal(flux.runoffMm,30);assert.equal(flux.drainageMm,40);assert.equal(state.drMm[0],0);
});
