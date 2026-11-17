# 开源代码复用记录

2026-10-28 先检索 GitHub，再下载公开源代码并改编。没有找到可直接满足“八年级花盆仿真＋主动/响应×线索/解释＋研究数据采集”全部条件的现成平台，因此复用基础工程和水分仿真模块，新增教学与研究业务。

| 来源 | 许可证 | 实际采用部分 | 修改 |
|---|---|---|---|
| [Rediwed/react-express-template](https://github.com/Rediwed/react-express-template) | MIT | 整个 app 初始目录、npm workspaces、Vite代理、React入口与路由、API请求封装、Express及SQLite结构、CSS变量体系 | 学生和教师业务替换示例页面；SQLite改为Node内置驱动；新增会话、实验流程和部署 |
| [NDilanka/agri-sim](https://github.com/NDilanka/agri-sim) | Apache-2.0 | `sim/src/core/soil.ts`、`params.ts`、`types.ts` 复制到 `shared/vendor/agri-sim/` | soil.ts的运行时导入补上.ts扩展名；核心stepBucket算法原样保留；`shared/simulation.js`新增单花盆、分钟尺度适配 |

许可证全文分别保存在 `licenses/react-express-template-MIT.txt` 与 `licenses/agri-sim-Apache-2.0.txt`，分发时请一并保留。上游原始存档保留在工作区 `.analysis/agri-source/` 和 `.analysis/starter-source/` 中，未放入部署包。

`stepBucket` 处理降雨入渗、径流、灌溉补水、排水及蒸散；当前花盆容量、泵流量、传感器换算是可配置的教学近似，未经过实物标定。不能把果园模型直接等同于教材花盆的实测数据。

其他直接使用的开源依赖包括 React、React Router、Vite、Express、Zod、Lucide、dotenv 与 concurrently，确切安装版本保存在 package-lock.json。

账号升级使用[dcodeIO/bcrypt.js](https://github.com/dcodeIO/bcrypt.js)提供的`bcryptjs`依赖处理教师密码（BSD-3-Clause），沿用其异步hash/compare接口；未自行实现密码算法。许可证保存在`licenses/bcryptjs-BSD-3-Clause.txt`。密码哈希用途已获得用户单独授权，未添加文件哈希校验。

DeepSeek接口依据：[官方接入说明](https://api-docs.deepseek.com/quick_start/agent_integrations/)及[Chat Completions文档](https://api-docs.deepseek.com/api/create-chat-completion/)。2026-10-28实际查询/models后采用deepseek-flash，并以非思考模式验证调用。

个人模型功能复用 [whitequark/ipaddr.js](https://github.com/whitequark/ipaddr.js) 的 IPv4/IPv6 地址分类，限制用户提供的 API 连接到公开地址；直接使用 npm 已发布实现，没有自行重写地址解析。MIT 许可证保存在 `licenses/ipaddrjs-MIT.txt`。API 密钥存储使用 Node 内置 AES-GCM 加密，不添加文件哈希校验。

2026-11-02 智能体优化直接复用 [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) 10.0.0 的并发队列与任务取消；四组按相同的先进先出顺序处理，固定版本记录在 npm 锁文件。MIT 许可证原文保存在 `licenses/p-queue-MIT.txt`。

同日进一步接入 [Vercel AI SDK](https://github.com/vercel/ai)：后端固定安装 `ai` 7.0.162 与 `@ai-sdk/openai-compatible` 3.0.84，直接调用官方 `generateText` / `createOpenAICompatible`，由其处理兼容接口的消息、响应、结束原因和用量。参考[兼容提供商文档](https://ai-sdk.dev/providers/openai-compatible-providers)及[请求设置文档](https://ai-sdk.dev/docs/ai-sdk-core/settings)，通过自定义 fetch 保留既有 HTTP 连接取消、DNS 检查、响应上限和中文错误；单轮生成、零自动重试，显式关闭遥测，直接访问用户配置的 API，不启用 AI Gateway。两包均为 Apache-2.0，许可证全文保存在 `licenses/ai-sdk-Apache-2.0.txt`，未修改上游包源码。LangGraph JS 仍为比较研究，未安装其运行时；具体取舍见 [智能体架构说明](docs/agent-architecture.md)。

2026-11-02 页面视觉统一直接复用 [Radix Colors](https://github.com/radix-ui/colors) 的浅色 gray / green 刻度，源自 `src/light.ts`，保存于 `frontend/src/styles/vendor/radix-colors.css`；MIT许可证保留于 `licenses/radix-colors-MIT.txt`。Apple官网和shadcn/ui仅用于视觉与交互参考，未复制其品牌素材或整套组件代码。
