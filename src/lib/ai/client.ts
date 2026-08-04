import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.LLM_API_KEY || "placeholder",
      baseURL: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    });
  }
  return _client;
}

const MODEL = process.env.LLM_MODEL || "qwen-plus";

export async function chat(
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: messages as any,
    temperature: 0.1,
    max_tokens: 4096,
  });

  return response.choices[0]?.message?.content || "";
}

export async function chatWithRetry(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxRetries = 1
): Promise<string> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await chat(messages);
    } catch (err: any) {
      if (i === maxRetries) throw err;
      console.warn(`LLM 调用失败，重试 ${i + 1}/${maxRetries}:`, err.message);
    }
  }
  throw new Error("LLM 调用失败，已达最大重试次数");
}
