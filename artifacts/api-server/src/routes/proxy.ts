import { Router, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";
import {
  hasBackends,
  forwardRequest,
  forwardStream,
  getPoolStatus,
} from "../lib/backendPool";

const router = Router();

const openaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const anthropicBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const anthropicApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
const proxyApiKey = process.env.PROXY_API_KEY || "sk-proxy-default-key-2024";

let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;

if (openaiBaseUrl && openaiApiKey) {
  openai = new OpenAI({ baseURL: openaiBaseUrl, apiKey: openaiApiKey });
}
if (anthropicBaseUrl && anthropicApiKey) {
  anthropic = new Anthropic({ baseURL: anthropicBaseUrl, apiKey: anthropicApiKey });
}

function verifyToken(req: Request, res: Response): boolean {
  const auth = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"] as string | undefined;
  if (auth === `Bearer ${proxyApiKey}` || xApiKey === proxyApiKey) {
    return true;
  }
  res.status(401).json({ error: { message: "Unauthorized", type: "authentication_error", code: "invalid_api_key" } });
  return false;
}

const OPENAI_MODELS = ["gpt-5.2", "gpt-5-mini", "gpt-5-nano", "o4-mini", "o3"];
const ANTHROPIC_MODELS = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];

function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || model.startsWith("o");
}
function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

// ─── Backend pool forwarding helper ────────────────────────────────────────

function rawBody(req: Request): Buffer {
  const body = req.body as unknown;
  if (body === undefined || body === null) return Buffer.alloc(0);
  return Buffer.from(JSON.stringify(body), "utf-8");
}

async function proxyToPool(req: Request, res: Response, path: string): Promise<boolean> {
  if (!hasBackends()) return false;

  const body = rawBody(req);
  const isStream = typeof req.body === "object" && req.body !== null && (req.body as Record<string, unknown>).stream === true;
  const headers = req.headers as Record<string, string | string[] | undefined>;

  try {
    if (isStream) {
      await forwardStream(req.method, path, headers, body, res as unknown as import("http").ServerResponse);
    } else {
      const result = await forwardRequest(req.method, path, headers, body);
      for (const [k, v] of Object.entries(result.headers)) {
        if (k.toLowerCase() === "transfer-encoding") continue;
        res.setHeader(k, v);
      }
      res.status(result.statusCode).send(result.body);
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Backend pool forward failed");
    res.status(502).json({ error: { message: "All backends failed: " + String(err) } });
    return true;
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────

router.get("/models", async (req, res) => {
  if (!verifyToken(req, res)) return;

  if (await proxyToPool(req, res, "/v1/models")) return;

  const now = Math.floor(Date.now() / 1000);
  const data = [
    ...OPENAI_MODELS.map((id) => ({ id, object: "model", created: now, owned_by: "openai" })),
    ...ANTHROPIC_MODELS.map((id) => ({ id, object: "model", created: now, owned_by: "anthropic" })),
  ];
  res.json({ object: "list", data });
});

router.get("/pool", (req, res) => {
  if (!verifyToken(req, res)) return;
  res.json({ backends: getPoolStatus() });
});

router.post("/chat/completions", async (req: Request, res: Response) => {
  if (!verifyToken(req, res)) return;
  if (await proxyToPool(req, res, "/v1/chat/completions")) return;

  const body = req.body as OpenAI.ChatCompletionCreateParams;
  const { model, messages, tools, tool_choice, stream } = body;

  if (!model || !messages) {
    res.status(400).json({ error: { message: "model and messages are required" } });
    return;
  }

  if (!openai) {
    res.status(503).json({ error: { message: "No OpenAI integration and no backend pool configured" } });
    return;
  }

  if (isOpenAIModel(model)) {
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const keepalive = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* ignore */ } }, 5000);
      req.on("close", () => clearInterval(keepalive));

      try {
        const openaiStream = await openai.chat.completions.create({ ...(body as OpenAI.ChatCompletionCreateParamsStreaming), stream: true });
        for await (const chunk of openaiStream) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          (res as unknown as { flush?: () => void }).flush?.();
        }
        res.write("data: [DONE]\n\n");
      } catch (err) {
        logger.error({ err }, "OpenAI stream error");
        try { res.write(`data: ${JSON.stringify({ error: { message: String(err) } })}\n\n`); } catch { /* ignore */ }
      } finally {
        clearInterval(keepalive);
        res.end();
      }
    } else {
      try {
        const result = await openai.chat.completions.create({ ...body, stream: false });
        res.json(result);
      } catch (err) {
        logger.error({ err }, "OpenAI chat error");
        res.status(500).json({ error: { message: String(err) } });
      }
    }
    return;
  }

  if (isAnthropicModel(model)) {
    if (!anthropic) {
      res.status(503).json({ error: { message: "No Anthropic integration configured" } });
      return;
    }
    const { system, messages: anthropicMessages } = convertMessagesToAnthropic(messages);
    const anthropicTools = tools ? convertToolsToAnthropic(tools) : undefined;
    const anthropicToolChoice = convertToolChoiceToAnthropic(tool_choice);
    const extraBody = body as Record<string, unknown>;
    const createParams: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: (extraBody.max_completion_tokens as number) ?? 8192,
      messages: anthropicMessages,
      ...(system ? { system } : {}),
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
      ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
      ...(extraBody.temperature != null ? { temperature: extraBody.temperature as number } : {}),
      ...(extraBody.top_p != null ? { top_p: extraBody.top_p as number } : {}),
      ...(extraBody.metadata ? { metadata: extraBody.metadata as Anthropic.MessageCreateParams["metadata"] } : {}),
    };

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const keepalive = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* ignore */ } }, 5000);
      req.on("close", () => clearInterval(keepalive));

      try {
        const anthropicStream = anthropic.messages.stream({ ...createParams, stream: true });
        let currentToolId = "";
        let currentToolName = "";
        let toolCallIndex = -1;
        const chatId = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        for await (const event of anthropicStream) {
          if (event.type === "message_start") {
            res.write(`data: ${JSON.stringify({ id: chatId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null, logprobs: null }] })}\n\n`);
            (res as unknown as { flush?: () => void }).flush?.();
          } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            toolCallIndex++;
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            res.write(`data: ${JSON.stringify({ id: chatId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: toolCallIndex, id: currentToolId, type: "function", function: { name: currentToolName, arguments: "" } }] }, finish_reason: null, logprobs: null }] })}\n\n`);
            (res as unknown as { flush?: () => void }).flush?.();
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              res.write(`data: ${JSON.stringify({ id: chatId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null, logprobs: null }] })}\n\n`);
              (res as unknown as { flush?: () => void }).flush?.();
            } else if (event.delta.type === "input_json_delta") {
              res.write(`data: ${JSON.stringify({ id: chatId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: toolCallIndex, function: { arguments: event.delta.partial_json } }] }, finish_reason: null, logprobs: null }] })}\n\n`);
              (res as unknown as { flush?: () => void }).flush?.();
            }
          } else if (event.type === "message_delta") {
            let finishReason: OpenAI.ChatCompletionChunk.Choice["finish_reason"] = "stop";
            if (event.delta.stop_reason === "tool_use") finishReason = "tool_calls";
            else if (event.delta.stop_reason === "max_tokens") finishReason = "length";
            res.write(`data: ${JSON.stringify({ id: chatId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason, logprobs: null }] })}\n\n`);
            (res as unknown as { flush?: () => void }).flush?.();
          }
        }
        res.write("data: [DONE]\n\n");
      } catch (err) {
        logger.error({ err }, "Anthropic stream error");
        try { res.write(`data: ${JSON.stringify({ error: { message: String(err) } })}\n\n`); } catch { /* ignore */ }
      } finally {
        clearInterval(keepalive);
        res.end();
      }
    } else {
      try {
        const message = await anthropic.messages.stream(createParams).finalMessage();
        res.json(convertAnthropicResponseToOpenAI(message, model));
      } catch (err) {
        logger.error({ err }, "Anthropic chat error");
        res.status(500).json({ error: { message: String(err) } });
      }
    }
    return;
  }

  res.status(400).json({ error: { message: `Unknown model: ${model}` } });
});

router.post("/messages", async (req: Request, res: Response) => {
  if (!verifyToken(req, res)) return;
  if (await proxyToPool(req, res, "/v1/messages")) return;

  const body = req.body as Record<string, unknown>;
  const { model, messages, stream } = body as { model?: string; messages?: unknown; stream?: boolean };

  if (!model || !messages) {
    res.status(400).json({ error: { message: "model and messages are required" } });
    return;
  }

  if (!anthropic) {
    res.status(503).json({ error: { message: "No Anthropic integration and no backend pool configured" } });
    return;
  }

  if (isAnthropicModel(model)) {
    // Pass through ALL body params to preserve cache_control, temperature, top_p, metadata, etc.
    const { stream: _stream, ...passthrough } = body;
    const params = { ...passthrough, max_tokens: (body.max_tokens as number) ?? 8192 } as Anthropic.MessageCreateParamsNonStreaming;

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      const keepalive = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* ignore */ } }, 5000);
      req.on("close", () => clearInterval(keepalive));
      try {
        const s = anthropic.messages.stream({ ...params, stream: true });
        for await (const event of s) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          (res as unknown as { flush?: () => void }).flush?.();
        }
      } catch (err) {
        logger.error({ err }, "Anthropic /messages stream error");
        try { res.write(`event: error\ndata: ${JSON.stringify({ error: { message: String(err) } })}\n\n`); } catch { /* ignore */ }
      } finally {
        clearInterval(keepalive);
        res.end();
      }
    } else {
      try {
        const message = await anthropic.messages.stream(params).finalMessage();
        res.json(message);
      } catch (err) {
        logger.error({ err }, "Anthropic /messages error");
        res.status(500).json({ error: { message: String(err) } });
      }
    }
    return;
  }

  res.status(400).json({ error: { message: `Unknown model: ${model}` } });
});

// ─── Format converters (unchanged) ─────────────────────────────────────────

function convertMessagesToAnthropic(messages: OpenAI.ChatCompletionMessageParam[]): { system: string | undefined; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const converted: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "system") { system = typeof msg.content === "string" ? msg.content : ""; continue; }
    if (msg.role === "user") {
      converted.push({ role: "user", content: typeof msg.content === "string" ? msg.content : (msg.content as Anthropic.ContentBlockParam[]) });
    } else if (msg.role === "assistant") {
      if (msg.tool_calls?.length) {
        const content: Anthropic.ContentBlock[] = [];
        if (msg.content) content.push({ type: "text", text: typeof msg.content === "string" ? msg.content : "" });
        for (const tc of msg.tool_calls) {
          let inputObj: Record<string, unknown> = {};
          try { inputObj = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* empty */ }
          content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: inputObj });
        }
        converted.push({ role: "assistant", content });
      } else {
        converted.push({ role: "assistant", content: typeof msg.content === "string" ? msg.content : "" });
      }
    } else if (msg.role === "tool") {
      const lastMsg = converted[converted.length - 1];
      const toolResultBlock: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: msg.tool_call_id ?? "", content: typeof msg.content === "string" ? msg.content : "" };
      if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
        (lastMsg.content as Anthropic.ContentBlockParam[]).push(toolResultBlock);
      } else {
        converted.push({ role: "user", content: [toolResultBlock] });
      }
    }
  }
  return { system, messages: converted };
}

function convertToolsToAnthropic(tools: OpenAI.ChatCompletionTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({ name: t.function.name, description: t.function.description ?? "", input_schema: (t.function.parameters as Anthropic.Tool["input_schema"]) ?? { type: "object", properties: {} } }));
}

function convertToolChoiceToAnthropic(toolChoice: OpenAI.ChatCompletionCreateParams["tool_choice"]): Anthropic.MessageCreateParams["tool_choice"] | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "none") return undefined;
  if (toolChoice === "required") return { type: "any" };
  if (typeof toolChoice === "object" && toolChoice.type === "function") return { type: "tool", name: toolChoice.function.name };
  return undefined;
}

function convertAnthropicResponseToOpenAI(message: Anthropic.Message, model: string): OpenAI.ChatCompletion {
  const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
  let text = "";
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } });
    }
  }
  let finishReason: OpenAI.ChatCompletion.Choice["finish_reason"] = "stop";
  if (message.stop_reason === "tool_use") finishReason = "tool_calls";
  else if (message.stop_reason === "max_tokens") finishReason = "length";
  return {
    id: message.id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: "assistant", content: text || null, refusal: null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: message.usage.input_tokens, completion_tokens: message.usage.output_tokens, total_tokens: message.usage.input_tokens + message.usage.output_tokens },
  };
}

export default router;
