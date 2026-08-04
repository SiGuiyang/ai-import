import type { ParsedOrder, ParsingStep, UnifiedWorkbook } from "./types";
import { executeStep } from "./extractors/index";
import { SheetMergeExtractor } from "./extractors/sheet-merge";
import { applyFieldMapping } from "./field-mapper";

export interface ParseProgress {
  current: number;
  total: number;
  percent: number;
  message: string;
}

export interface ParseResult {
  orders: ParsedOrder[];
  totalRows: number;
  parsedRows: number;
  errors: string[];
}

export async function parseFile(
  workbook: UnifiedWorkbook,
  steps: ParsingStep[],
  onProgress?: (progress: ParseProgress) => void
): Promise<ParseResult> {
  let allIntermediate: Record<string, any>[] = [];
  const errors: string[] = [];

  // 过滤启用且非 group-by 的步骤（group-by 在后续处理）
  const activeSteps = steps.filter((s) => s.enabled && s.type !== "group-by");
  const groupByStep = steps.find((s) => s.enabled && s.type === "group-by");

  const totalSteps = activeSteps.length;

  for (let i = 0; i < activeSteps.length; i++) {
    const step = activeSteps[i];

    onProgress?.({
      current: i,
      total: totalSteps,
      percent: Math.round((i / totalSteps) * 100),
      message: `正在执行：${step.label}`,
    });

    try {
      let stepResults: Record<string, any>[] = [];

      if (step.type === "sheet-merge") {
        const extractor = new SheetMergeExtractor();
        stepResults = extractor.extractFromSheets(workbook.sheets, step.config);
      } else if (step.type === "cell-split") {
        // cell-split 需要 inputData，如果已有中间数据则使用
        const inputData = allIntermediate.length > 0 ? allIntermediate : workbook.sheets[0]?.cells;
        stepResults = executeStep(
          { ...workbook.sheets[0], cells: [] } as any,
          { ...step, config: { ...step.config, inputData } }
        );
      } else {
        stepResults = executeStep(workbook.sheets[0], step);
      }

      if (stepResults.length > 0) {
        // 如果是后续步骤，将上一轮结果合并
        if (allIntermediate.length > 0) {
          // 将上一个步骤的结果作为这个步骤的附件数据
          const merged = allIntermediate.map((prev, idx) => ({
            ...prev,
            ...(stepResults[idx] || {}),
          }));
          allIntermediate = merged;
        } else {
          allIntermediate = stepResults;
        }
      }
    } catch (err: any) {
      errors.push(`步骤 [${step.label}] 执行失败: ${err.message}`);
    }
  }

  // 如果有 group-by 步骤，对中间数据执行分组
  if (groupByStep && allIntermediate.length > 0) {
    try {
      const { groupField, sharedFields } = groupByStep.config;
      const grouped = new Map<string, Record<string, any>[]>();

      for (const record of allIntermediate) {
        const key = String(record[groupField] ?? "__no_group__");
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(record);
      }

      const groupResults: Record<string, any>[] = [];
      grouped.forEach((records) => {
        const merged = { ...records[0] };
        if (sharedFields && sharedFields.length > 0) {
          // 共享字段保持不变（已在第一个记录中）
        }
        merged._groupItems = records;
        merged._groupCount = records.length;
        groupResults.push(merged);
      });
      allIntermediate = groupResults;
    } catch (err: any) {
      errors.push(`分组聚合失败: ${err.message}`);
    }
  }

  const totalRows = allIntermediate.length;

  onProgress?.({
    current: totalSteps,
    total: totalSteps,
    percent: 100,
    message: `解析完成，共 ${totalRows} 行数据`,
  });

  return {
    orders: allIntermediate as any as ParsedOrder[],
    totalRows,
    parsedRows: totalRows,
    errors,
  };
}

/**
 * 使用完整规则解析文件（含字段映射）
 */
export async function parseFileWithRule(
  workbook: UnifiedWorkbook,
  steps: ParsingStep[],
  fieldMapping: any,
  onProgress?: (progress: ParseProgress) => void
): Promise<ParseResult> {
  const intermediate = await parseFile(workbook, steps, onProgress);

  if (fieldMapping && intermediate.orders.length > 0) {
    const orders = applyFieldMapping(intermediate.orders, fieldMapping);
    return {
      ...intermediate,
      orders: orders as any,
    };
  }

  return intermediate;
}
