import { extractSignatureHeaders, verifySignature } from "@/lib/signature";
import { db } from "@/lib/db";
import { openApps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * 验签中间件：验证 HTTP 签名头，找到对应的应用
 * 验证通过返回 app 信息，失败返回错误响应
 */
export async function verifyAppAuth(request: Request) {
  const sigHeaders = extractSignatureHeaders(request);

  // 查找应用
  const [app] = await db
    .select()
    .from(openApps)
    .where(eq(openApps.appId, sigHeaders.appId));

  if (!app) {
    return {
      authenticated: false,
      errorResponse: Response.json(
        { success: false, message: "AppId 不存在" },
        { status: 401 }
      ),
    };
  }

  // 检查应用状态
  if (app.status !== "active") {
    return {
      authenticated: false,
      errorResponse: Response.json(
        { success: false, message: "应用已被停用" },
        { status: 403 }
      ),
    };
  }

  // 获取请求体用于签名验证
  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      const cloned = request.clone();
      body = await cloned.text();
    } catch {
      body = undefined;
    }
  }

  // 验证签名
  const result = verifySignature(
    { ...sigHeaders, body },
    app.appSecret
  );

  if (!result.valid) {
    return {
      authenticated: false,
      errorResponse: Response.json(
        { success: false, message: result.message },
        { status: 401 }
      ),
    };
  }

  return {
    authenticated: true,
    app,
    body,
  };
}
