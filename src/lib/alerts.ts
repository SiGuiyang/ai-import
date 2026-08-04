/**
 * 模块八：告警通知服务
 *
 * 支持钉钉机器人 Webhook 发送告警消息。
 * 当队列积压超阈值 / 任务全部失败 / DB 断连时自动推送。
 */

/** 钉钉 Webhook URL，从环境变量读取 */
const DINGTALK_WEBHOOK_URL = process.env.DINGTALK_WEBHOOK_URL || '';

/** 告警类型 */
export type AlertType = 'queue_backlog' | 'task_failed' | 'db_disconnected' | 'db_reconnected';

interface AlertPayload {
  type: AlertType;
  title: string;
  message: string;
  level: 'warning' | 'error' | 'info';
  data?: Record<string, any>;
}

/**
 * 发送钉钉机器人消息（Markdown 格式）
 * 文档: https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages
 */
async function sendDingTalk(alert: AlertPayload): Promise<boolean> {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) return false;

  const levelIcon = alert.level === 'error' ? '🔴' : alert.level === 'warning' ? '🟡' : '🔵';

  const text = [
    `## ${levelIcon} ${alert.title}`,
    '',
    alert.message,
    '',
  ];

  if (alert.data) {
    text.push('---');
    text.push('**详细信息：**');
    text.push('');
    for (const [k, v] of Object.entries(alert.data)) {
      text.push(`- **${k}**：${v}`);
    }
  }

  text.push('');
  text.push(`> 告警时间：${new Date().toLocaleString('zh-CN')}`);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: `[AI Import] ${alert.title}`,
          text: text.join('\n'),
        },
      }),
    });

    const result = await res.json();
    return result.errcode === 0;
  } catch {
    return false;
  }
}

/** 获取 Webhook URL（可被测试覆盖） */
let _overrideUrl: string | null = null;
export function __setWebhookUrl__(url: string | null) { _overrideUrl = url; }
function getWebhookUrl(): string {
  return _overrideUrl !== null ? _overrideUrl : DINGTALK_WEBHOOK_URL;
}

// ==================== 公开 API ====================

/**
 * 发送告警（静默失败，不影响主流程）
 */
export async function sendAlert(alert: AlertPayload): Promise<void> {
  try {
    const sent = await sendDingTalk(alert);
    if (sent) {
      console.log(`[Alert] 告警已发送: ${alert.type} - ${alert.title}`);
    }
  } catch (e) {
    console.error('[Alert] 发送告警失败:', e);
  }
}

/**
 * 队列积压告警
 */
export async function alertQueueBacklog(pendingRows: number, pendingEvents: number) {
  const level = pendingRows > 10000 ? 'error' : 'warning';
  await sendAlert({
    type: 'queue_backlog',
    title: '队列积压告警',
    message: `导入队列积压已超过阈值，当前待处理 ${pendingRows.toLocaleString()} 行，${pendingEvents} 个批次事件。系统可能在慢速处理，建议检查 Worker 状态。`,
    level,
    data: {
      '待处理行数': pendingRows.toLocaleString(),
      '待处理事件数': pendingEvents,
      '告警阈值': '5,000 行（warning）/ 10,000 行（error）',
    },
  });
}

/**
 * 任务失败告警
 */
export async function alertTaskFailed(taskId: string, fileName: string, reason: string, traceId: string) {
  await sendAlert({
    type: 'task_failed',
    title: '导入任务失败',
    message: `导入任务异常终止。文件名: ${fileName}，失败原因: ${reason}`,
    level: 'error',
    data: {
      '任务ID': taskId,
      '文件名': fileName,
      '失败原因': reason,
      'Trace ID': traceId,
    },
  });
}

/**
 * DB 断连告警
 */
export async function alertDbDisconnected() {
  await sendAlert({
    type: 'db_disconnected',
    title: '数据库连接异常',
    message: '数据库连接已断开，导入服务降级运行中。部分功能可能不可用，请尽快检查。',
    level: 'error',
    data: {
      '影响范围': '所有需要持久化的导入任务',
      '建议操作': '检查数据库服务状态或网络连接',
    },
  });
}

/**
 * DB 恢复通知
 */
export async function alertDbReconnected() {
  await sendAlert({
    type: 'db_reconnected',
    title: '数据库连接恢复',
    message: '数据库连接已恢复正常，导入服务恢复运行。',
    level: 'info',
  });
}
