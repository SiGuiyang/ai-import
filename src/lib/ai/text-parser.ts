import { chatWithRetry } from "./client";

export async function parseNonStructuredText(
  text: string,
  fieldRequirements: { name: string; description: string; required: boolean }[]
): Promise<Record<string, string>[]> {
  const fieldList = fieldRequirements
    .map((f) => `- ${f.name} (${f.required ? "必填" : "可选"}): ${f.description}`)
    .join("\n");

  const response = await chatWithRetry([
    {
      role: "system",
      content: `你是一个物流信息提取助手。从非结构化文本中提取指定的字段信息。

请返回 JSON 数组格式，每个元素是一条记录：
[
  {
    "field1": "提取的值1",
    "field2": "提取的值2"
  }
]

提取规则：
- 如果找到对应信息，填入提取的值
- 如果未找到，填入 null
- 只返回 JSON 数组，不要加代码块标记`,
    },
    {
      role: "user",
      content: `需要提取的字段：
${fieldList}

原始文本：
${text}

请提取并返回 JSON 数组。`,
    },
  ]);

  let jsonStr = response.trim();
  jsonStr = jsonStr.replace(/^```json\s*/i, "").replace(/^```\s*/i, "");
  jsonStr = jsonStr.replace(/\s*```$/, "");

  try {
    return JSON.parse(jsonStr);
  } catch {
    return [];
  }
}
