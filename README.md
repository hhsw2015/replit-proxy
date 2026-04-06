# Replit AI Proxy

OpenAI + Anthropic dual-compatible reverse proxy running on Replit, with multi-node pool support.

## Features

- `/v1/chat/completions` - OpenAI compatible endpoint (supports both GPT and Claude models)
- `/v1/messages` - Anthropic native endpoint (full parameter passthrough including `cache_control`)
- `/v1/models` - Model listing
- Multi-node backend pool with round-robin load balancing and circuit breaking
- Tool call support with automatic OpenAI <-> Anthropic format conversion
- Streaming support with keepalive
- `x-api-key` + `Authorization: Bearer` dual auth

## Available Models

| Provider | Models |
|----------|--------|
| OpenAI | gpt-5.2, gpt-5-mini, gpt-5-nano, o4-mini, o3 |
| Anthropic | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |

## Quick Start

### Step 1 - Deploy (every Replit account)

Paste the following prompt into the Replit homepage input box:

```
在这个项目中：

1. 通过 setupReplitAIIntegrations 启用 OpenAI 和 Anthropic AI 集成

2. 创建 api-server artifact（Express），paths 包含 "/v1"，依赖加入：
   openai ^6、@anthropic-ai/sdk ^0.82、@replit/database ^3
   写一个最简 GET /v1/models 返回 {"ok":true} 确保能启动

3. 创建 api-portal artifact（react-vite，previewPath: "/"，标题 "API Portal"）
   写一个最简页面显示 "API Running" 确保能启动

4. 确认两个 workflow 都能正常启动运行

5. 在 Shell 中执行以下命令，用 GitHub 仓库的代码替换：
   cd ~/workspace/ && git clone https://github.com/hhsw2015/replit-proxy.git && cp -rf replit-proxy/artifacts/* artifacts/ && rm -rf replit-proxy && cd artifacts/api-server && pnpm install

6. 重启两个 workflow，确认都能正常运行

7. suggestDeploy()
```

Wait for the Agent to finish, then click **Publish/Deploy**.

### Step 2 - Configure master node

On the master node only, add one Secret:

| Name | Value |
|------|-------|
| `BACKENDS` | `[{"url":"https://sub1.replit.app"},{"url":"https://sub2.replit.app"}]` |

Just fill in the sub-node URLs. `key` and `label` are auto-generated.

Restart the API Server workflow after adding.

### Step 3 - Verify

```bash
# Check models
curl https://<master-url>/v1/models \
  -H "x-api-key: sk-proxy-default-key-2024"

# Check backend pool
curl https://<master-url>/v1/pool \
  -H "Authorization: Bearer sk-proxy-default-key-2024"

# Test chat
curl https://<master-url>/v1/messages \
  -H "x-api-key: sk-proxy-default-key-2024" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":100,"messages":[{"role":"user","content":"Hi"}]}'
```

## Node Management

Use the management script to add/remove sub-nodes dynamically (no restart needed):

```bash
# Set your master node URL first
export MASTER_URL="https://replit-ai-skeleton--pikapk.replit.app"

# List all nodes and their status
./scripts/node-manage.sh list

# Add a sub-node (just URL, key and label auto-generated)
./scripts/node-manage.sh add https://sub1--user2.replit.app

# Add with custom key and label
./scripts/node-manage.sh add https://sub2--user3.replit.app sk-custom-key "my-sub-node"

# Remove a sub-node
./scripts/node-manage.sh rm https://sub1--user2.replit.app

# List available models
./scripts/node-manage.sh models

# Test a specific model
./scripts/node-manage.sh test claude-sonnet-4-6
./scripts/node-manage.sh test gpt-5-mini

# Help
./scripts/node-manage.sh help
```

Changes via the script take effect **immediately** without restarting any workflow.

If you prefer not to use the script, you can also set the `BACKENDS` Secret on the master node (see Step 2 above) and restart.

## Use with Claude Code

```bash
export ANTHROPIC_BASE_URL="https://<master-url>"
export ANTHROPIC_API_KEY="sk-proxy-default-key-2024"
claude
```

## Default Keys

All nodes share the same default keys (zero config):

| Purpose | Default Value |
|---------|---------------|
| API access | `sk-proxy-default-key-2024` |
| Admin API | `sk-admin-default-key-2024` |

Override by setting `PROXY_API_KEY` or `ADMIN_KEY` environment variables on any node.

## Architecture

```
Client (Claude Code / CherryStudio / curl)
    |
    |  x-api-key: sk-proxy-default-key-2024
    v
Master Node (Replit Account A)
    |  backendPool.ts - Round Robin + Circuit Breaking
    |
    +---> Sub Node 1 (Replit Account B) ---> Replit AI Integration ---> OpenAI / Anthropic
    +---> Sub Node 2 (Replit Account C) ---> Replit AI Integration ---> OpenAI / Anthropic
    +---> Sub Node 3 (Replit Account D) ---> Replit AI Integration ---> OpenAI / Anthropic
```

## Notes

- Each Replit account consumes its own credits independently
- Free plan credits are limited; Opus consumes the fastest
- Dev URL (`xxx.replit.dev`) works without Deploy; may sleep after inactivity
- Models prefixed with `claude-` route to Anthropic; all others route to OpenAI
- Cache: Anthropic `cache_control` parameters are passed through transparently via `/v1/messages`
- Tool calls: Full bidirectional OpenAI <-> Anthropic format conversion, including streaming
