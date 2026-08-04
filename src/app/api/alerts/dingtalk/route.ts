/**
 * POST /api/alerts/dingtalk
 *
 * 模块八：钉钉机器人告警检查接口
 * 由外部定时任务（或 crontab）定期调用，检查阈值并推送告警。
 *
 * 配置：环境变量 DINGTALK_WEBHOOK_URL 设置钉钉机器人 Webhook 地址
 *
 * 告警逻辑：
 * - 队列积压 > 5000 行 → 告警
 * - DB 断连 → 告警
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { alertQueueBacklog, alertDbDisconnected } from '@/lib/alerts';

// 内存去重：避免同一告警在短时间内重复发送
const lastAlertTime: Record<string, number> = {};
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟内不重复发送同类告警

function canSend(key: string): boolean {
  const last = lastAlertTime[key] || 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  lastAlertTime[key] = Date.now();
  return true;
}

export async function POST(req: NextRequest) {
  const webhookUrl = process.env.DINGTALK_WEBHOOK_URL;

  if (!webhookUrl) {
    return NextResponse.json({
      code: 0,
      message: 'DINGTALK_WEBHOOK_URL 未配置，跳过告警检查',
      alerts: [],
    });
  }

  const sql = await getSql();
  const alerts: string[] = [];

  // 检查 DB 连接
  let dbConnected = false;
  try {
    const r = await sql`SELECT 1 as ping`;
    dbConnected = (r[0]?.ping) === 1;
  } catch { dbConnected = false; }

  if (!dbConnected && canSend('db')) {
    await alertDbDisconnected();
    alerts.push('DB_DISCONNECTED');
  }

  // 检查队列积压
  try {
    const rowsResult = await sql`
      SELECT COALESCE(SUM(end_row - start_row + 1), 0) as total_pending_rows
      FROM import_task_batches WHERE status IN ('PENDING', 'QUEUED')
    `;
    const pendingRows = parseInt(rowsResult[0]?.total_pending_rows || '0');

    if (pendingRows > 5000 && canSend('queue')) {
      const eventsResult = await sql`
        SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'PENDING'
      `;
      await alertQueueBacklog(pendingRows, parseInt(eventsResult[0]?.cnt || '0'));
      alerts.push('QUEUE_BACKLOG');
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    code: 0,
    message: alerts.length > 0 ? `发送 ${alerts.length} 条告警` : '无告警',
    alerts,
  });
}
