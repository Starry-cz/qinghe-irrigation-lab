# 十条待确认需求与当前实现

| 待确认事项 | 第一版采用的理解 | 后续调整入口 |
|---|---|---|
| 分组与操作单位 | 一人一份用户资料，以姓名＋学号登录；教师指定条件，或班级内按前测四人区组随机分配 | 教师“学生与分组”；用户表及分配算法在backend/src/db.js、routes/admin.js |
| 虚拟设备与操作范围 | 花盆、传感器、控制器、水泵、储水箱；连接开关、调节环境、结构化编辑规则 | frontend/src/components/LabScene.jsx、TrialWorkspace.jsx；shared/simulation.js |
| 智能体内容来源 | 已接DeepSeek官方deepseek-flash，支持兼容服务或明确的预设模式 | 服务器.env；backend/src/guidance.js |
| 首次猜想与主动组求助 | 默认独立提交后开放指导，主动组也可求助 | allowHelpBeforeHypothesis、activeCanAsk |
| 主动指导的触发标准 | 关键测试、阶段完成、停留120秒、相同条件重复3次、结构化预测不一致；45秒冷却；每阶段同类一次 | idleSeconds、repeatCount、cooldownSeconds；routes/student.js与guidance.js |
| 两种反馈区别 | 线索1–2句、约80字内；解释约150–250字，均不直接给最终阈值/规则/结论 | backend/src/guidance.js的提示词和预设样例；真实模型输出仍需教学审核 |
| 仿真深度 | 30分钟水量变化、排水、预报和实际降雨分离，固定初始决策执行指定分钟 | 泵流量、土壤容量、面积、蒸散、降雨参数；shared/simulation.js |
| 完整后续流程 | 观察猜想→设计测试→优化规则→验证解释→总结迁移 | 教师高级配置可改阶段文案和最低测试次数；若改变阶段数量/字段则修改shared/definitions.js及前后端表单规则 |
| 湿度和合理灌溉标准 | 读数0–4095，越大越湿；初始阈值2800；参考规则加入天气条件 | sensorMin/Max、higherMeansWetter、initialRule/referenceRule、scenarios |
| 结果评价与过程数据 | 演示前后测、全部阶段提交、测试、规则变更、对话及事件；不自动评阅开放答案 | 教师研究数据导出；测评题在shared/definitions.js |

配置已随学生首次进入保存快照。正式实验前建议复制为新的实验轮次，并确认参数、题目与话术。完成过的阶段保留提交结果，编辑草稿不会覆盖原始提交。
