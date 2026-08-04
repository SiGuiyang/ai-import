// ============ Step Types ============

export type StepType =
  | "standard-table"
  | "matrix-transpose"
  | "card-split"
  | "text-regex"
  | "tail-section"
  | "sheet-merge"
  | "cell-split"
  | "group-by";

// ============ Standard Table Config ============
export interface StandardTableConfig {
  sheetIndex?: number;
  headerRow: number;
  dataStartRow: number;
  dataEndRow?: number;
  skipRows?: number[];
  columnMapping?: Record<string, string>;
  ignoreColumns?: string[];
  mergeCellStrategy?: "fill-down" | "skip";
}

// ============ Matrix Transpose Config ============
export interface MatrixTransposeConfig {
  rowHeaderStartRow: number;
  rowHeaderStartCol: number;
  rowHeaderEndCol: number;
  rowHeaderNames?: string[];
  colHeaderRow: number;
  colHeaderStartCol: number;
  colHeaderName: string;
  dataStartRow: number;
  dataEndRow?: number;
  dataStartCol: number;
  cellSplitter?: string;
  cellValuePattern?: string;
  cellFieldNames?: string[];
}

// ============ Card Split Config ============
export interface CardSplitConfig {
  cardMarker: string;
  cardMarkerPattern?: string;
  innerTableHeaderRowOffset: number;
  innerTableDataStartOffset: number;
  innerTableEndMarker?: string;
  cardFields: CardField[];
}

export interface CardField {
  name: string;
  rowOffset: number;
  pattern?: string;
  prefix?: string;
}

// ============ Text Regex Config ============
export interface TextRegexConfig {
  recordSeparator: string;
  fieldPatterns: TextFieldPattern[];
  itemListPattern: string;
  itemFields: string[];
}

export interface TextFieldPattern {
  name: string;
  pattern: string;
  group?: number;
  multiline?: boolean;
}

// ============ Tail Section Config ============
export interface TailSectionConfig {
  startMarker?: string;
  afterRow?: number;
  afterDataEnd?: boolean;
  extractMode: "horizontal" | "vertical" | "paragraph";
  fieldPatterns: TailFieldPattern[];
  associationField?: string;
}

export interface TailFieldPattern {
  name: string;
  prefix?: string;
  regex?: string;
  rowOffset?: number;
  colOffset?: number;
}

// ============ Sheet Merge Config ============
export interface SheetMergeConfig {
  sheetNames?: string[];
  excludeSheets?: string[];
  sheetNameAsField?: string;
  perSheetSteps: ParsingStep[];
}

// ============ Cell Split Config ============
export interface CellSplitConfig {
  splitBy: string;
  subFields: SubField[];
}

export interface SubField {
  name: string;
  type?: "string" | "number";
}

// ============ Group By Config ============
export interface GroupByConfig {
  groupField: string;
  aggregateFields?: string[];
  sharedFields: string[];
}

// ============ Parsing Step ============
export interface ParsingStep {
  id: string;
  type: StepType;
  label: string;
  enabled: boolean;
  config: Record<string, any>;
  useLlm?: boolean;
}

// ============ Field Mapping ============
export interface FieldMapping {
  externalCode?: FieldSource;
  storeName?: FieldSource;
  receiverName?: FieldSource;
  receiverPhone?: FieldSource;
  receiverAddress?: FieldSource;
  skuCode: FieldSource;
  skuName: FieldSource;
  quantity: FieldSource;
  specification?: FieldSource;
  remark?: FieldSource;
}

export interface FieldSource {
  stepId: string;
  fieldPath: string;
  transform?: string;
  aiInferred?: boolean;
  aiConfidence?: "high" | "medium" | "low";
}

// ============ Unified Workbook ============
export interface UnifiedWorkbook {
  sheets: UnifiedSheet[];
  metadata: {
    fileName: string;
    fileType: "xlsx" | "xls" | "docx" | "pdf";
    totalSheets: number;
  };
}

export interface UnifiedSheet {
  name: string;
  cells: CellValue[][];
  rawText?: string;
  paragraphs?: TextParagraph[];
}

export interface CellValue {
  value: string | number | null;
  row: number;
  col: number;
  mergeSpan?: { rowSpan: number; colSpan: number };
}

export interface TextParagraph {
  index: number;
  text: string;
}

// ============ Parsed Output ============
export interface ParsedOrder {
  externalCode?: string;
  storeName?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  remark?: string;
  items: ParsedOrderItem[];
}

export interface ParsedOrderItem {
  skuCode: string;
  skuName: string;
  quantity: number;
  specification?: string;
  sortOrder?: number;
}

// ============ Validation ============
export interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
  orderId?: string;
}
