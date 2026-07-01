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

- **API Endpoint Pattern**：用于匹配聊天请求的 URL 关键词（默认 `/api/`）
- **Request Stagger (ms)**：并发请求间隔，防止触发 rate limit（默认 200ms）
- **Extra Models**：勾选要并发查询的模型，支持添加自定义模型
- **Custom Model**：格式 `model-id:显示名称`

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
