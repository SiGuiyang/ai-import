import crypto from "crypto";

/**
 * 标准 HTTP 验签工具
 *
 * 签名算法: HMAC-SHA256
 * 请求头:
 *   X-App-Id      应用ID
 *   X-Timestamp   请求时间戳 (毫秒)
 *   X-Nonce       随机字符串 (防重放)
 *   X-Sign        签名
 *
 * 签名字符串拼接: appId + timestamp + nonce + body + appSecret
 * 然后对拼接串做 HMAC-SHA256，再转 hex
 */

export interface SignatureHeaders {
  appId: string;
  timestamp: string;
  nonce: string;
  sign: string;
  body?: string;
}

/**
 * 生成签名
 */
export function generateSignature(
  appId: string,
  appSecret: string,
  timestamp: string,
  nonce: string,
  body?: string
): string {
  const raw = [appId, timestamp, nonce, body || ""].join("");
  return crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
}

/**
 * 生成请求所需的签名头
 */
export function buildSignatureHeaders(
  appId: string,
  appSecret: string,
  body?: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const sign = generateSignature(appId, appSecret, timestamp, nonce, body);

  return {
    "X-App-Id": appId,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Sign": sign,
    "Content-Type": "application/json",
  };
}

/**
 * 验证签名
 * @returns { valid: boolean, message?: string }
 */
export function verifySignature(
  headers: SignatureHeaders,
  appSecret: string,
  maxAgeMs: number = 5 * 60 * 1000 // 默认 5 分钟有效期
): { valid: boolean; message?: string } {
  const { appId, timestamp, nonce, sign, body } = headers;

  // 1. 校验必填字段
  if (!appId || !timestamp || !nonce || !sign) {
    return { valid: false, message: "缺少必要的签名头: X-App-Id, X-Timestamp, X-Nonce, X-Sign" };
  }

  // 2. 校验时间戳有效期 (防重放攻击)
  const now = Date.now();
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    return { valid: false, message: "X-Timestamp 格式无效" };
  }
  if (Math.abs(now - ts) > maxAgeMs) {
    return { valid: false, message: "请求已过期，时间戳偏差超过允许范围" };
  }

  // 3. 校验 Nonce 长度
  if (nonce.length < 16) {
    return { valid: false, message: "X-Nonce 长度不足" };
  }

  // 4. 计算并比对签名
  const expectedSign = generateSignature(appId, appSecret, timestamp, nonce, body);
  if (!crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expectedSign))) {
    return { valid: false, message: "签名验证失败" };
  }

  return { valid: true };
}

/**
 * 从请求中提取签名头
 */
export function extractSignatureHeaders(request: Request): SignatureHeaders {
  return {
    appId: request.headers.get("X-App-Id") || "",
    timestamp: request.headers.get("X-Timestamp") || "",
    nonce: request.headers.get("X-Nonce") || "",
    sign: request.headers.get("X-Sign") || "",
  };
}

/**
 * 生成唯一的 AppId
 */
export function generateAppId(): string {
  return "app_" + crypto.randomBytes(12).toString("hex");
}

/**
 * 生成 AppSecret
 */
export function generateAppSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}
