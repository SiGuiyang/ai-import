export type FileType = 'excel' | 'word' | 'pdf';

export type SheetMode = 'first' | 'all' | 'named' | 'index';

export type SourceType = 'column' | 'row' | 'value';

export interface ColumnMapping {
  targetField: string;
  sourceType: SourceType;
  sourceKey?: string;
  sourceIndex?: number;
  defaultValue?: string;
  required: boolean;
}

export interface TailExtraction {
  field: string;
  rowMarker: string;
  columnIndex: number;
}

export interface TransposeConfig {
  dimensionHeaders: string[];
  dimensionField: string;
  valueField: string;
  quantityField?: string;
  quantityHeaderRow?: number;
}

export interface CardSplitConfig {
  startMarker: string;
  tableRowsAfterMarker: number;
  headerRowIndex?: number;
}

export interface CellSplitConfig {
  column: string;
  pattern: string;
  targetFields: string[];
}

export interface SourceArea {
  sheetMode: SheetMode;
  sheetNames?: string[];
  sheetIndex?: number;
  headerSkipRows: number;
  headerRowIndex: number;
  dataStartRow: number;
  dataEndMarker?: string;
  dataEndRow?: number;
  tailInfoRows?: number;
}

export interface ParseRule {
  id: string;
  name: string;
  fileType: FileType;
  description?: string;
  sourceArea: SourceArea;
  columnMappings: ColumnMapping[];
  tailExtractions: TailExtraction[];
  transpose?: TransposeConfig;
  cardSplit?: CardSplitConfig;
  cellSplit?: CellSplitConfig;
  groupBy?: string;
  skipLinesRegex?: string[];
  aiGenerated: boolean;
  confidence?: number;
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  externalCode: string;
  receiverStore?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  skuSpec?: string;
  remark?: string;
  batchId: string;
  rowIndex: number;
  createdAt: string;
}

export interface ParseResult {
  success: boolean;
  data: Record<string, unknown>[];
  errors: string[];
  fileName: string;
  totalRows: number;
  parseTime: number;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export interface BatchSubmitResult {
  success: boolean;
  totalCount: number;
  successCount: number;
  failCount: number;
  errors: string[];
  batchId: string;
}

export interface StoredOrder {
  id: string;
  external_code?: string;
  receiver_store?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  sku_code: string;
  sku_name: string;
  sku_quantity: number;
  sku_spec?: string;
  remark?: string;
  batch_id: string;
  created_at: string;
}
