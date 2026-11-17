# 服务器部署

## 共同配置

部署项目的`platform`目录。不要上传本机node_modules、演示数据库、浏览器测试输出或自动携带本机.env。
在服务器复制`.env.example`为`.env`，填写`TEACHER_USERNAME`、`TEACHER_PASSWORD`、`TEACHER_NAME`以及模型地址、模型名和密钥。初始密码至少8个字符，最多72个UTF-8字节。首次启动创建教师账号，后续密码以数据库为准，可在“账号与资料”中修改。推荐使用域名加HTTPS，设置`COOKIE_SECURE=true`。本地HTTP调试时该值必须为false。

DeepSeek配置：

```dotenv
AI_PROVIDER=openai
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
AI_THINKING=disabled
AI_API_KEY=填写密钥
```

不要在前端环境变量中填写密钥。`npm run check:ai`可检查实际连接。模型请求会把当前学生的实验文本和最近对话发送到配置的模型服务，教师可使用学生编号而非姓名组织实验。

## Docker Compose

```bash
cp .env.example .env
# 编辑.env后执行
docker compose up -d --build
docker compose logs -f app
curl http://127.0.0.1:3001/api/health
```

`compose.yaml`只在服务器127.0.0.1:3001提供应用，由Nginx转发HTTPS。数据库放在`lab-data`命名卷，容器升级不清除数据。不要执行会删除卷的`docker compose down -v`，除非明确要清空实验数据。

将`deploy/nginx.conf`放入Nginx站点目录，并替换域名及实际证书路径。确认服务器域名DNS和HTTPS证书后执行`nginx -t`并重新加载Nginx。没有预先提供真实域名，因此样例不包含现成证书。

## Node.js直接部署

要求Node.js24。以下按`/opt/qinghe`目录举例：

```bash
cd /opt/qinghe
npm ci
npm run build
npm start
```

验证后可安装`deploy/qinghe.service`为systemd服务。按服务器实际情况创建`qinghe`系统用户、赋予项目data目录读写权限，并确认Node路径与工作目录。服务通过.env读取参数，Nginx仍按上述样例转发。也可使用已有进程管理器。

不要开启多个写入同一SQLite文件的应用容器；当前方案面向单实例课堂平台。后续跨服务器部署需迁移数据库和会话存储。

智能指导也使用单实例的 p-queue 调度。默认 `AI_MAX_CONCURRENT=8`、`AI_QUEUE_LIMIT=128`、`AI_QUEUE_WAIT_MS=60000`；分别控制同时生成数、等待队列容量与等待超时。每次生成另有30秒请求超时，不做自动重试。按照租用服务的并发与速率配额调整；并发上限不等于每分钟token配额。服务重启会将未完成任务标为失败，学生可以重新求助，不自动重放已经可能计费的请求。

智能体升级会自动迁移到数据库版本5，增加 `guidance_runs`，保留所有已有用户与实验数据。HTTP `/student/help` 现在返回202表示受理，最终状态通过 `/student/state` 或 `/student/heartbeat` 获取；升级须同时发布新前端，旧标签页应刷新。

AI SDK升级版仍使用数据库版本5，无新增表迁移。发布时执行 `npm ci` 安装锁定的 `ai` 和 `@ai-sdk/openai-compatible` 依赖，再构建前端并重启单实例服务。保持原有 `.env`、数据库和模型密钥文件；无需部署到Vercel、申请AI Gateway密钥或安装LangGraph。模型调用仍直接连接配置的兼容API，自动重试关闭。同阶段状态同步新增 `revision` 字段，前后端应一起更新。

2026-11-03操作同步版新增 `/api/student/activity`，仍使用数据库版本5及现有依赖。需一并更新前端构建与后端并重启服务，旧学生首次操作后在原进度JSON内建立工作台状态。上线前按原步骤备份；无需重新导入名单或重建实验。具体行为见[操作同步说明](realtime-state.md)。

## 上线检查

1. 健康接口返回ok，首页在域名下正常加载。
2. 管理员使用账号和密码登录，验证学生与教师注册、审核前禁止登录、审核后允许登录；确认普通教师没有审核和创建教师权限。也可直接导入学生名单，不执行演示seed。
3. 选择两个测试账号验证主动/响应行为，完成一次五阶段流程。
4. 验证大模型服务有可用额度及足够的并发/速率配额。130个学生同时请求的实际吞吐受模型服务限制，本地的130账号并发测试不代表模型并发能力。
5. 下载完整JSON和CSV；重启服务后检查学生进度仍在。

## 备份和升级

Node直接部署执行`npm run backup`，将得到包含WAL已提交内容的一致性SQLite备份。
Docker部署执行`docker compose exec -e BACKUP_DIR=/app/data/backups app npm run backup`，备份保存在持久化卷内；再用`docker compose cp app:/app/data/backups ./backups`复制到服务器备份位置。

升级前做备份并保留旧源码版本。停止应用后，才可用选定备份替换data/lab.db，并移除停机后残留的旧WAL/SHM文件，再启动。不要在应用运行时直接覆盖数据库文件。

模型密钥与教师初始化配置保存在.env，需单独保管；实际用户资料和bcrypt密码摘要保存在数据库中。用户信息导出不会包含密码摘要。

模型设置功能会将个人及实验 API Key 加密存储，首次保存时在数据库同目录创建 `model-secrets.key`。`npm run backup` 会为它生成与备份数据库同名的 `.model-secrets.key` 文件；恢复时将配套文件复制到数据库同目录，命名为 `model-secrets.key`。迁移服务器时需一起迁移数据库、此文件和服务器 `.env`，否则无法使用原来保存的个人/实验模型。Docker 命名卷中的数据库与密钥文件会一起保留。源码包不包含这些本机资料。

从访问码版本升级时先备份，再执行`npm run setup`迁移本地配置并启动新版本。Docker部署可在构建前手动将ADMIN_CODE改为TEACHER_PASSWORD并添加TEACHER_USERNAME。旧版教师需要重新登录；学生实验记录保留，缺少学号的旧学生须由教师补齐资料。学号在平台内唯一，同一学生可以加入多轮实验。

升级注册审核版时，启动会自动迁移数据库：已有用户保持可登录，原有实验成果保留；现有 `admin` 教师成为管理员，新注册用户须通过审核。新建数据库时，环境变量指定的初始教师为管理员。管理员身份保存在数据库中，普通教师自行注册或管理员另建教师账号均不会自动获得审核权限。
