# 审批工作流系统

> 仓库地址：<https://github.com/DaisyMaoqy/approval-workflow-system>

一个通用申请审批流程的前端实现，业务场景覆盖**差旅**与**请假**两类申请：员工通过类型无关的向导填写多步表单发起申请，
预览确认后提交，经主管与财务两级审批，并按角色提供不同视角的统计报表。新增申请类型只需在注册表声明，无需改动路由与向导外壳。

## 技术栈

| 领域 | 选型                                                 |
| ---- | ---------------------------------------------------- |
| 框架 | SvelteKit 2（Svelte 5 runes）+ TypeScript            |
| 样式 | TailwindCSS v4（CSS-first 配置）                     |
| 表单 | 字段配置驱动动态表单 + Zod 校验（schemaConfig 推导） |
| 图表 | Apache ECharts                                       |
| 测试 | Vitest + jsdom                                       |

## 快速开始

```sh
nvm use            # Node 22，见 .nvmrc
npm install
npm run dev
```

## 常用命令

| 命令                    | 说明                                      |
| ----------------------- | ----------------------------------------- |
| `npm run dev`           | 启动开发服务器                            |
| `npm run build`         | 生产构建                                  |
| `npm run preview`       | 预览生产构建                              |
| `npm test`              | 运行单元测试                              |
| `npm run test:coverage` | 带覆盖率的测试                            |
| `npm run check`         | svelte-check 类型检查                     |
| `npm run lint`          | Prettier + ESLint 检查                    |
| `npm run format`        | 自动格式化                                |
| `npm run seed`          | 重新生成演示数据 `src/lib/data/seed.json` |

## 功能

- **发起申请** —— 向导步骤与字段由 `applicationTypes.ts` 注册表驱动，与具体业务类型解耦：
  `travel`（差旅）为四步（基本信息 → 行程明细 → 费用预算 → 预览确认），
  `leave`（请假）为三步（基本信息 → 请假时间 → 预览确认）；
  草稿自动保存；表单字段**输入过程中即实时校验**（不限于失焦）；
  预览页每个区块可跳回对应步骤并定位到具体字段；最后一步支持「存为草稿」
- **申请列表与详情** —— 按状态、类型、年份、月份筛选与关键字搜索，状态 tab 的数量徽标
  跟随类型/年/月同步；详情页含审批时间线与操作区；带查看权限校验，无权限时显示提示而非内容；
  提交申请与从编辑返回均直接回到「我的申请」，并按当前全局申请类型展示
- **审批处理** —— 主管、财务两级审批，驳回必须填写意见（限 200 字），被驳回的单可重新编辑；
  「待我审批」卡片在状态下方展示提交时间，与「我的申请」卡片一致
- **统计报表** —— 主管专属管理视图，随选中的申请类型展示团队成本 / 请假天数 / 审批效率
  （差旅看成本、请假看天数），员工与财务不可见

## 关键设计

### 路由划分为多个业务入口

```
/requests           我的申请（列表与详情 /requests/[id]）
/approvals          待我审批（仅主管与财务可见）
/apply/[type]/[step] 统一发起向导
                     [type] = travel | leave，[step] 由注册表定义（如 basic | trips | budget | preview）
                     向导的步骤与字段完全由注册表驱动
/reports            统计报表（主管专属）
```

四类入口**平铺为顶级路由**，职责彼此独立，便于按角色逐项做权限控制，也让每个页面只对自己负责。

这样划分的收益是可扩展：发起向导是**类型无关的通用骨架**，
新增一种申请只需在 `src/lib/domain/applicationTypes.ts` 的注册表里声明
步骤与字段，**无需改动路由、向导外壳与渲染组件**。当前 `travel`（差旅）与 `leave`（请假）
均已注册，且 `seed.json` 两类单都有演示数据（差旅 40 张、请假 19 张）。

> **申请类型如何切换**：类型不是 URL 参数，而是持久化在 `localStorage`（`approval-app-type`）的全局偏好，
> 只有侧栏顶部的「切换申请类型」下拉会改它；普通导航（点菜单、列表、详情）绝不改动。
> 「我的申请」列表、向导、统计报表都按当前全局类型展示，从编辑态返回列表也不会切走类型。

注册表同时驱动 **UI 渲染与 Zod 校验**：一份 `FieldDef` 既生成动态表单，
也通过 `schemaConfig.ts` 推导出逐步与整单的校验 schema，两者天然不漂移。
通用的 `Request` 模型用 `type` 判别字段，业务字段统一放在 `fields: Record<string, unknown>`
里（差旅特化类型 `TravelRequest = Request & { fields: TravelFields }` 仅用于既有差旅组件的强类型读取），
状态机、仓储、统计等下游全部基于这个统一模型工作。

路径统一由 SvelteKit 的 `resolve()` 生成，它接受 route ID 并做类型检查，
路由拼错或缺少参数在编译期就会报错 —— 比自行维护一份路径常量更可靠。

### 统一的左侧导航

导航结构定义在 `src/lib/components/layout/navigation.ts`，
每个菜单项声明自己对哪些角色可见，过滤逻辑集中在 `visibleSections()` 一处，
而不是在模板里散落 `{#if role === 'manager'}`。

选中态用前缀匹配，详情页 `/requests/TR-0001` 也会让「我的申请」保持高亮；
匹配时要求下一个字符是 `/`，避免 `/requests-archive` 这类兄弟路径被误点亮。

### 切角色即切身份

演示提供三个身份：**张三**（工程师）、**李经理**（研发部主管）与**王会计**（财务），
通过顶栏身份卡片切换。这样既满足「审批人不能审批自己提交的单」这条业务规则，
又能完整演示「提交 → 主管审批 → 财务审批 → 通过」的两级全链路，无需任何演示专用的后门开关。

李经理本人也可以提交申请。由于系统里只有他一名主管、且「不能自审」，
其申请会停留在「待主管审批」状态，不会出现在他自己的待办列表中；
二审由财务（王会计）负责，与主管环节相互独立。

查看范围同样随角色收紧：员工看不到他人或领导的单，经理可查看团队员工的
非草稿单（草稿仅申请人自己可见）；详情页据此对无权限访问渲染「无权查看」分支，
而非把内容直接暴露出去。

角色切换器还会按页面收紧可选项：统计报表页（`/reports`）禁用员工与财务、审批页
（`/approvals`）禁用员工 —— 当前页面不可切换的角色按钮置灰并提示
「当前页面不可切换至此角色」，避免误入后以越权身份查看数据。

身份状态用 Svelte context 持有而非模块级 `$state` —— 模块级状态在 SSR 下
由所有请求共享，会造成用户之间串号；context 的生命周期跟随组件树，每个请求各自独立。

### 校验规则的唯一真相

校验 schema 由 `src/lib/domain/schemaConfig.ts` 从 `FieldDef` 配置**推导**而出
（`buildStepSchema` 逐步、`buildTypeSchema` 整单，含跨字段 refine），
底层的 Zod 原子定义在 `src/lib/domain/schema.ts`。

客户端向导（`StepRenderer`）在「下一步 / 提交」时用 `validate(schema, draft)` 一次性校验，
错误按字段路径展示，配合 `touched` / `attempted` 实现「输入过程中实时提示」；
localStorage 草稿回读时，结构变更或被手动改动的脏数据会被丢弃。

配置只写一份，UI 渲染与校验天然不漂移；字段类型由 `FieldDef` 驱动，改配置时校验自动跟随。

完整的校验规则清单见 [docs/validation.md](docs/validation.md)。

### 数据来源与离线兜底

申请数据读取自 Apifox 云端 Mock（`GET /api/requests`，可按 `?type=` 过滤单类型），
请求失败或超时会自动降级到本地 `src/lib/data/seed.json`，
因此**离线、未配置环境变量的情况下应用依然可以完整运行**。
所有写操作落在 localStorage。

> Apifox 官方声明云端 Mock 地址会不定时变更，仅供测试使用。
> 本地兜底正是为此准备 —— 接口不可用不影响演示。

配置方式：复制 `.env.example` 为 `.env`，按需修改 `PUBLIC_MOCK_BASE_URL`。

### 统一的请求层（core/http）

所有对后端的调用（含未来的申请单写操作、审批动作、报表、登录）都只经由
`src/lib/core/http.ts` 一个出口，职责按层划分、互不越界：

- **`src/lib/core/http.ts` —— 全局请求基础设施**：负责请求拦截（按 `USE_BACKEND`
  拼接 Mock `/api` 或后端 `/aws/v1` base、附加 `Content-Type` 与
  `Authorization: Bearer <Qy_token>`）、响应拦截（联调模式拆统一信封
  `{ code, data, msg }` 仅返回 `data`，成功 `code:"200"`、否则抛 `ApiError` 取 `msg`）、
  以及统一的错误处理（抛 `ApiError`，区分网络 / 超时 / HTTP / 业务码，401 自动清 token
  并跳登录）。业务模块不重复拼 URL、拼头、解析信封。暴露
  `apiGet / apiPost / apiPut / apiPatch / apiDelete` 与联调总开关 `USE_BACKEND`。
- **`src/lib/data/requests.ts` —— 领域数据仓**：只关心申请单的读取、筛选、本地回退
  与 store；通过 `apiGet('/requests')` 消费 `core/http` 的返回值（兼容「数组」与
  「分页包 `{ list, total, page, pageSize }``），自身不再直接 `fetch`。写操作由一组
  **异步集成函数**承接（`submitNewRequest` / `saveDraftRequest` / `resubmitRequest` /
  `removeRequest` / `applyAction`）：`USE_BACKEND` 为真时调后端
  `/aws/v1/<type>-requests` 及其 RPC 子路径（submit/approve/reject/cancel/reedit），
  用返回值回写本地 store；后端不可用或抛错时降级到同名的「本地兜底」同步函数
  （`createRequest` / `createDraft` / `updateRequestFromDraft` / `deleteRequest`，
  保留仅用于单测溯源），保证页面始终可用。
- **`src/lib/state/auth.svelte.ts` —— 登录态**：持有后端签发的 `Qy_token` 并持久化到
  `localStorage`；`core/http` 从中读取 token 组装鉴权头，二者通过同一个 key 解耦。

> **联调开关**：`core/http.ts` 中的 `USE_BACKEND` 置 `true` 即整体切到后端 `/aws/v1`，
> 置 `false` 沿用 Apifox Mock；请求失败 / 超时 / 401 均按既有策略降级，保证页面始终有数据。

### 演示数据

`npm run seed` 生成的数据具备三个特性：

- **确定性** —— 使用固定种子的 PRNG，同样的脚本永远产出同样的文件，diff 可读
- **走真实状态机** —— 每张单的状态由 `transition()` 逐步流转而来，而非硬编码，
  因此审批时间线必然自洽，脚本本身也成为状态机的一道额外验证
- **配额分配** —— 按精确配额而非随机抽样分配状态，保证每个筛选 tab 都有内容

数据规模：研发部 5 人、跨 12 个自然月、59 张申请单（差旅 40 + 请假 19），覆盖全部 6 种状态。

### 提交时间按本地时区记录

申请单的 `submittedAt` / `updatedAt` 等时间戳按用户所在时区的墙钟存储
（本地年月日时分秒 + `Z` 占位，由 `toLocalISO()` 统一生成），展示时原样读回本地时间，
避免在 UTC 时区下看到偏移后的日期。重新编辑后再提交会以最新的提交时间为准。

## 目录结构

```
src/
├── lib/
│   ├── domain/         领域层：类型与注册表、状态机、校验 schema、金额与聚合（纯函数，无 UI 依赖）
│   ├── data/           数据层：远程读取、离线兜底、localStorage 仓储
│   ├── state/          客户端状态：当前身份、申请类型（持久化）、草稿、列表筛选
│   ├── core/           全局基础设施：统一请求客户端（请求/响应拦截 + 错误处理）、路由常量
│   ├── components/
│   │   ├── layout/     全局壳：侧栏导航（含类型切换）、身份切换、页头
│   │   ├── common/     通用件：面板、弹窗、筛选、图标等，与业务无关
│   │   ├── form/       表单控件：动态字段、预览、筛选条等配置驱动的渲染件
│   │   └── request/    跨页复用的领域展示件：状态徽标、行程表、预算、时间线
│   ├── styles/         设计令牌、全局基础样式、跨页复用的 BEM 类
│   └── vitest/         单元测试，目录结构镜像被测源码
└── routes/
    ├── requests/       我的申请：列表与详情（/requests/[id]）
    ├── approvals/      待我审批
    ├── apply/          新建向导（/apply/[type]/[step]）
    └── reports/        统计报表
```

只服务于单个页面的组件，就近放在该路由的 `components/` 下
（如详情页的 `routes/requests/[id]/components/`），
只有确实跨页复用的才提到 `$lib`。读某个页面时不必在 `$lib` 与路由之间来回跳，
组件被谁使用也一目了然。

样式同理分层：单处使用的样式就近留在组件的 scoped `<style>` 里并语义化命名，
出现第二个使用方时才收口到 `src/lib/styles/components.css`。
图标统一走 `$lib/components/common/Icon.svelte`，path 数据集中一处，不引图标库。

## 测试

单元测试覆盖四类目标：

- **领域逻辑** —— 状态流转矩阵、校验规则边界、金额精度、数据聚合
- **审批操作编排** —— `RequestActions` 组件对状态机、仓储读写、失败分支与跳转的串联
- **数据仓储** —— 申请单筛选、搜索、聚合与远程加载降级逻辑
- **组件** —— 渲染输出、交互行为、状态驱动的差异

测试文件放在 `src/lib/vitest/` 下，目录结构镜像被测源码
（`domain/money.ts` → `vitest/domain/money.test.ts`），
测试与实现分离，源码目录保持干净。

```sh
npm test
```
