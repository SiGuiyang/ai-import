import { StandardTableExtractor } from "./standard-table";
import { MatrixTransposeExtractor } from "./matrix-transpose";
import { CardSplitExtractor } from "./card-split";
import { TextRegexExtractor } from "./text-regex";
import { TailSectionExtractor } from "./tail-section";
import { SheetMergeExtractor } from "./sheet-merge";
import { CellSplitExtractor } from "./cell-split";
import { GroupByExtractor } from "./group-by";
import type { ParsingStep } from "../types";
import type { UnifiedSheet } from "../types";

export interface Extractor {
  type: string;
  extract(sheet: UnifiedSheet, config: Record<string, any>): Record<string, any>[];
}

const extractors: Record<string, Extractor> = {
  "standard-table": new StandardTableExtractor(),
  "matrix-transpose": new MatrixTransposeExtractor(),
  "card-split": new CardSplitExtractor(),
  "text-regex": new TextRegexExtractor(),
  "tail-section": new TailSectionExtractor(),
  "sheet-merge": new SheetMergeExtractor(),
  "cell-split": new CellSplitExtractor(),
  "group-by": new GroupByExtractor(),
};

export function executeStep(
  sheet: UnifiedSheet,
  step: ParsingStep
): Record<string, any>[] {
  const extractor = extractors[step.type];
  if (!extractor) throw new Error(`未知的提取器类型: ${step.type}`);
  return extractor.extract(sheet, step.config);
}

export function getExtractor(type: string): Extractor | undefined {
  return extractors[type];
}
