import { verifyAppAuth } from "@/lib/signature/middleware";

/**
 * POST /api/open/orders/create
 *
 * 示例开放接口：外部系统通过验签后创建出库单
 *
 * 请求头:
 *   X-App-Id:      应用ID
 *   X-Timestamp:   时间戳(毫秒)
 *   X-Nonce:       随机字符串
 *   X-Sign:        签名 = HMAC-SHA256(appId+timestamp+nonce+body+appSecret)
 *
 * 请求体:
 *   { externalCode, storeName, receiverName, receiverPhone, receiverAddress, items, remark }
 */
export async function POST(request: Request) {
  // 验签
  const auth = await verifyAppAuth(request);
  if (!auth.authenticated) {
    return auth.errorResponse!;
  }

  try {
    const requestBody = JSON.parse(auth.body || "{}");
    const {
      externalCode,
      storeName,
      receiverName,
      receiverPhone,
      receiverAddress,
      items,
    } = requestBody;

    // 基础参数校验
    const hasStoreGroup = !!storeName;
    const hasReceiverGroup = !!(receiverName && receiverPhone && receiverAddress);

    if (!hasStoreGroup && !hasReceiverGroup) {
      return Response.json(
        {
          success: false,
          message: "收货门店 和 收件人信息(姓名+电话+地址) 至少填写一组",
        },
        { status: 400 }
      );
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return Response.json(
        { success: false, message: "物品明细不能为空" },
        { status: 400 }
      );
    }

    // TODO: 这里调用实际的业务逻辑创建出库单
    // 目前返回成功示例

    return Response.json(
      {
        success: true,
        message: "出库单创建成功",
        data: {
          orderId: "demo-order-" + Date.now(),
          externalCode: externalCode || null,
          storeName: storeName || null,
          receiverName: receiverName || null,
          receiverPhone: receiverPhone || null,
          receiverAddress: receiverAddress || null,
          itemCount: items.length,
          appId: auth.app.appId,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return Response.json(
      { success: false, message: error.message || "请求参数解析失败" },
      { status: 400 }
    );
  }
}

/**
 * GET /api/open/orders/query
 * 查询出库单（验签）
 */
export async function GET(request: Request) {
  const auth = await verifyAppAuth(request);
  if (!auth.authenticated) {
    return auth.errorResponse!;
  }

  const { searchParams } = new URL(request.url);
  const externalCode = searchParams.get("externalCode");

  return Response.json({
    success: true,
    message: "查询成功",
    data: {
      appId: auth.app.appId,
      query: { externalCode },
      records: [],
      total: 0,
    },
  });
}
