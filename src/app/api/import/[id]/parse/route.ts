import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fileImports, parsingRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { preprocessFile } from "@/lib/parser/preprocessor";
import { parseFileWithRule } from "@/lib/parser/engine";

// GET /api/import/[id]/parse - 执行解析 (SSE)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  const ruleId = searchParams.get("ruleId");

  // SSE headers
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 获取导入记录
        const [importRecord] = await db
          .select()
          .from(fileImports)
          .where(eq(fileImports.id, params.id));

        if (!importRecord) {
          send({ type: "error", message: "导入记录不存在" });
          controller.close();
          return;
        }

        // 使用传入的 ruleId 更新导入记录
        const effectiveRuleId = ruleId || importRecord.ruleId;

        if (!effectiveRuleId) {
          send({ type: "error", message: "未选择解析规则" });
          controller.close();
          return;
        }

        // 更新 ruleId
        if (ruleId) {
          await db
            .update(fileImports)
            .set({ ruleId })
            .where(eq(fileImports.id, params.id));
          importRecord.ruleId = ruleId;
        }

        const [rule] = await db
          .select()
          .from(parsingRules)
          .where(eq(parsingRules.id, effectiveRuleId));

        if (!rule) {
          send({ type: "error", message: "解析规则不存在" });
          controller.close();
          return;
        }

        // 更新状态
        await db
          .update(fileImports)
          .set({ status: "parsing" })
          .where(eq(fileImports.id, params.id));

        // 读取文件内容
        const rawContent = importRecord.rawContent as any;
        let buffer: ArrayBuffer;

        if (rawContent?.fileBuffer) {
          const nodeBuffer = Buffer.from(rawContent.fileBuffer, "base64");
          buffer = nodeBuffer.buffer.slice(
            nodeBuffer.byteOffset,
            nodeBuffer.byteOffset + nodeBuffer.byteLength
          ) as ArrayBuffer;
        } else {
          send({ type: "error", message: "文件内容不存在" });
          controller.close();
          return;
        }

        // 预处理
        const workbook = await preprocessFile(
          buffer,
          importRecord.fileType,
          importRecord.fileName
        );

        const steps = rule.steps as any[];
        const fieldMapping = rule.fieldMapping as any;

        // 执行解析
        const result = await parseFileWithRule(
          workbook,
          steps,
          fieldMapping,
          (progress) => {
            send({
              type: "progress",
              current: progress.current,
              total: progress.total,
              percent: progress.percent,
              message: progress.message,
            });
          }
        );

        // 保存解析结果
        await db
          .update(fileImports)
          .set({
            status: "parsed",
            totalRows: result.totalRows,
            parsedRows: result.parsedRows,
            rawContent: { ...(rawContent as any), parsedOrders: result.orders, errors: result.errors },
            errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null,
          })
          .where(eq(fileImports.id, params.id));

        // 更新规则使用次数
        if (rule.id) {
          await db
            .update(parsingRules)
            .set({ usageCount: (rule.usageCount || 0) + 1 })
            .where(eq(parsingRules.id, rule.id));
        }

        send({
          type: "complete",
          total: result.totalRows,
          parsedRows: result.parsedRows,
          errors: result.errors,
        });
      } catch (err: any) {
        console.error("解析失败:", err);
        await db
          .update(fileImports)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(fileImports.id, params.id));
        send({ type: "error", message: err.message || "解析失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
