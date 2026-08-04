const API_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export async function callQwen(
  messages: { role: string; content: string }[],
  options?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('DASHSCOPE_API_KEY not configured');
  }

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options?.model || 'qwen-plus',
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens || 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Qwen API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
