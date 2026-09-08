---
created: 2026-03-20
tags: []
---

# Monica Multi-Model Compare

同一问题同时发送给多个模型，并排显示回答。复用 Monica Web 端 session，零额外成本。

## 原理

拦截 `monica.im` 网页端的 `fetch` 请求，提取聊天 API 的 endpoint、认证 headers 和消息体，然后用 `GM_xmlhttpRequest` 并发发送给其他模型（仅修改 `model` 字段），流式渲染到 Shadow DOM 隔离的侧边面板中。

**不走 `platform.monica.im` 付费 API**，消耗的是你已付费的 Max 订阅额度。

## 安装

### 前置条件
- Chrome / Edge / Firefox
- [Tampermonkey](https://www.tampermonkey.net/) 扩展

### 安装步骤
1. 打开 Tampermonkey → Dashboard → Utilities → File → Import
2. 选择 `monica-multi-model.user.js`，或：
3. 新建脚本 → 粘贴 `monica-multi-model.user.js` 全部内容 → 保存

## 首次使用：抓包配置（必做）

脚本默认的模型 ID 和 API endpoint 是占位值，**必须通过抓包获取真实值后才能工作**。

### Step 1：抓取 Monica 内部 API

1. 打开 `https://monica.im` → 登录
2. `F12` → Network → 勾选 `Fetch/XHR`
3. 在聊天界面发送一条消息
4. 观察 Network 面板中出现的 POST 请求，记录：

| 信息 | 在哪里找 | 示例 |
|------|---------|------|
| **Endpoint URL** | Request URL | `/api/v1/chat/completions` |
| **认证方式** | Request Headers | `Authorization: Bearer xxx` 或 Cookie |
| **Model ID** | Request Payload → model 字段 | `gpt-4o-2024-08-06` |
| **消息格式** | Request Payload → messages 字段 | `[{role, content}]` |
| **响应格式** | Response → EventStream | `data: {"choices":[...]}` |

5. 切换 Monica 界面上的模型选择器，再发一条消息，对比两次请求中 `model` 字段的值变化

### Step 2：用 curl 验证

```bash
# 用抓到的真实值替换
curl -X POST 'https://monica.im/实际endpoint' \
  -H 'Authorization: Bearer 你的token' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "另一个模型ID",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": true
  }'
```

确认能返回不同模型的回答。

### Step 3：配置脚本

1. 在 monica.im 页面右下角点击 **M** 浮动按钮启用脚本
2. 点击面板右上角 **⚙** 打开设置
3. 修改 **API Endpoint Pattern** 为抓包发现的实际路径关键词
4. 勾选或添加正确的模型 ID
5. 点击 **Show Last Captured Request** 验证拦截是否成功

## 使用方法

| 操作 | 效果 |
|------|------|
| 左键点击 **M** 按钮 | 开关多模型模式 |
| 右键点击 **M** 按钮 | 显示/隐藏侧边面板 |
| ⚙ 按钮 | 打开设置面板 |
| ▶ 按钮 | 折叠面板 |
| Tampermonkey 菜单 | Toggle / Reset Settings |

启用后，每次在 Monica 发送消息，脚本会自动拦截并同时向勾选的额外模型发送相同问题，流式显示在侧边面板中。

## 配置项

### 自动发现和删除模型

- 设置中默认开启「自动发现 Monica 置顶模型」。展开 Monica 的模型侧栏后，插件会自动把已加载的置顶模型加入 Extra Models；不会读取聊天正文来猜测模型。
- 可手动点击「扫描置顶模型」或「扫描全部模型」。后者仅扫描页面当前已加载的模型，不是完整的服务端模型目录。
- 新发现的模型默认不勾选并发。📌 表示置顶；「待确认」表示编号根据名称推测，例如 `Gemini 3.8 Flash` → `gemini-3.8-flash`。
- 在 Monica 原生界面选择该模型并正常发送一次消息后，插件会从请求中校准 `use_model` 和 `chat_model`。插件不会为检测模型自动发送消息；校准也可以在多模型模式关闭时进行。
- 每行右侧的 × 可删除模型。删除记录会保存，刷新和扫描都不会自动加回，Fusion 下拉列表也会同步移除。需要恢复时，在自定义模型输入框重新添加；「Reset Settings」会清除所有删除记录及其他设置。
- 检测依赖 Monica 当前侧栏结构；如果页面改版或侧栏尚未加载，可使用手动添加。

### 其他配置

- **API Endpoint Pattern**：用于匹配聊天请求的 URL 关键词（默认 `/api/`）
- **Request Stagger (ms)**：并发请求间隔，防止触发 rate limit（默认 200ms）
- **Extra Models**：勾选要并发查询的模型，支持添加自定义模型
- **Custom Model**：格式 `model-id:chat_model:显示名称`

## 回归验证

### 独立开发浏览器（不需要 Tampermonkey）

运行 `node test/dev-browser.js`，会启动独立的可见 Chrome，使用项目下 `.dev/monica-profile` 专用配置，不连接日常浏览器，也不复制现有账号。首次需要在新窗口登录 Monica。可用 `DEV_CHROME_PATH` 指定 Chrome for Testing / Chromium 可执行文件。

开发入口会校验并缓存 userscript 的依赖，在页面加载前自动注入当前本地代码和开发用 GM 适配层。修改 `monica-multi-model.user.js` 后自动刷新加载新代码，无需重复安装。正在执行自动测试时会延迟刷新。请勿用此窗口处理重要对话或未保存的草稿。

终端输入 `status` 查看注入、聊天请求数量及模型/Fusion 面板状态；输入 `test` 发送一条简短真实消息并检查所有面板完成（会消耗当前勾选模型的额度）；`reload` 手动重新加载，`quit` 关闭开发实例。日志不记录聊天内容或请求凭据。开发配置与 Tampermonkey 的模型设置相互独立。

运行 `node test/dev-browser.js --fixture --headless`，可在同一个自动注入入口中使用本地模拟服务验证开发环境，无需账号。模拟服务测试通过不代表 Monica 实网或 Tampermonkey 安装验收通过。

`.dev/` 已加入 Git 忽略列表，其中可能包含开发浏览器登录状态，请勿提交或分享。这个入口不修改浏览器安全策略，不安装扩展，也不覆盖当前 Chrome 的配置。

### 自动回归

运行 `node test/regression.test.js`，可通过 `PLAYWRIGHT_MODULE` 指定 Playwright 模块路径。浏览器测试需要本机 Chrome，Fusion 渲染测试需要联网加载脚本使用的 CDN 依赖。

统一入口覆盖请求桥接、模型配置、构建版本、UI 生命周期、模型发现/删除/恢复，以及普通窗口和包装窗口中的并发与 Fusion。包装窗口测试保留原生 `MessageEvent.source`，用于防止 userscript 的窗口包装导致消息被误丢弃；校准异常也不应阻断请求分发。

这些测试使用模拟回答，不能替代实际 Tampermonkey 安装验收。发布前仍应安装新版本，在 Monica 发送短消息，确认原生回答、并发模型、自动 Fusion 和手动重跑均可完成。

## 注意事项

- 逆向使用内部 API 可能违反 Monica ToS，仅供个人学习使用
- 不向任何第三方发送数据，所有请求仅发往 `monica.im`
- Auth 信息从浏览器 session 实时提取，不硬编码
- Advanced Credits 模型会加速消耗配额，注意控制并发模型数量
- Monica 改版可能导致 API 变化，需重新抓包配置





```

把以上这些问题都写成测试文件。
```

# END
