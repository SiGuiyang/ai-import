import { createHmac } from 'crypto';

/**
 * 开放接口鉴权配置
 * 校验 appId 和 appSecret 是否匹配
 */

// 允许的时间戳偏差（秒），防重放攻击
const TIMESTAMP_TOLERANCE = 300; // 5 分钟

/**
 * 计算签名：HMAC-SHA256(timestamp + appId, appSecret)
 */
export function computeSign(timestamp: string, appId: string, appSecret: string): string {
  return createHmac('sha256', appSecret)
    .update(`${timestamp}${appId}`)
    .digest('hex');
}

/**
 * 校验请求签名是否有效
 */
export function verifySign(appId: string, timestamp: string, sign: string, appSecret: string): boolean {
  // 校验时间戳是否在允许的时间偏差范围内
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE) {
    return false;
  }

  const expectedSign = computeSign(timestamp, appId, appSecret);
  return sign === expectedSign;
}

/**
 * 从请求中提取鉴权头信息
 */
export interface AuthHeaders {
  appId: string;
  timestamp: string;
  sign: string;
}

export function extractAuthHeaders(headers: Headers): AuthHeaders | null {
  const appId = headers.get('x-app-id');
  const timestamp = headers.get('x-timestamp');
  const sign = headers.get('x-sign');

  if (!appId || !timestamp || !sign) {
    return null;
  }

  return { appId, timestamp, sign };
}
