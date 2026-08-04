import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileImports } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";

// GET /api/import/[id]/export - 导出 Excel
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [record] = await db
      .select()
      .from(fileImports)
      .where(eq(fileImports.id, params.id));

    if (!record) {
      return NextResponse.json(
        { success: false, error: "导入记录不存在" },
        { status: 404 }
      );
    }

    const rawContent = record.rawContent as any;
    const parsedOrders = rawContent?.parsedOrders || [];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("出库单");

    // 表头
    sheet.columns = [
      { header: "外部编码", key: "externalCode", width: 20 },
      { header: "收货门店", key: "storeName", width: 25 },
      { header: "收件人姓名", key: "receiverName", width: 15 },
      { header: "收件人电话", key: "receiverPhone", width: 15 },
      { header: "收件人地址", key: "receiverAddress", width: 35 },
      { header: "SKU编码", key: "skuCode", width: 20 },
      { header: "SKU名称", key: "skuName", width: 25 },
      { header: "发货数量", key: "quantity", width: 12 },
      { header: "规格型号", key: "specification", width: 20 },
      { header: "备注", key: "remark", width: 25 },
    ];

    // 表头样式
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FF0FC6C2" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF0FAF9" },
    };

    // 数据行
    for (const order of parsedOrders) {
      if (order.items && order.items.length > 0) {
        for (const item of order.items) {
          sheet.addRow({
            externalCode: order.externalCode || "",
            storeName: order.storeName || "",
            receiverName: order.receiverName || "",
            receiverPhone: order.receiverPhone || "",
            receiverAddress: order.receiverAddress || "",
            skuCode: item.skuCode || "",
            skuName: item.skuName || "",
            quantity: item.quantity || 0,
            specification: item.specification || "",
            remark: order.remark || "",
          });
        }
      } else {
        sheet.addRow({
          externalCode: order.externalCode || "",
          storeName: order.storeName || "",
          receiverName: order.receiverName || "",
          receiverPhone: order.receiverPhone || "",
          receiverAddress: order.receiverAddress || "",
          skuCode: "",
          skuName: "",
          quantity: 0,
          specification: "",
          remark: order.remark || "",
        });
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(record.fileName)}_parsed.xlsx"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "导出失败" },
      { status: 500 }
    );
  }
}
