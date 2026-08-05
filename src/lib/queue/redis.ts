import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
    if (!redis) {
        // BullMQ 需要 Redis 协议连接，不能使用 REST API URL
        const url = process.env.UPSTASH_REDIS_REDIS_URL;

        if (!url) {
            throw new Error(
                "Redis 连接地址未配置。请设置 UPSTASH_REDIS_REDIS_URL 或 REDIS_URL。\n" +
                "本地开发: export REDIS_URL=redis://localhost:6379\n" +
                "Upstash: 在 Upstash 控制台复制 Redis URL（非 REST API URL）"
            );
        }

        console.log(`[Redis] Connecting to: ${url.replace(/\/\/.*@/, "//***@")}`);

        redis = new Redis(url, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            lazyConnect: false,
            connectTimeout: 10000,
            retryStrategy: (times) => {
                if (times > 10) {
                    console.error("[Redis] 重试次数已达上限，停止重连");
                    return null;
                }
                const delay = Math.min(times * 1000, 5000);
                console.warn(`[Redis] 第 ${times} 次重连，${delay}ms 后重试...`);
                return delay;
            },
        });

        redis.on("error", (err) => {
            console.error("[Redis] 连接错误:", err.message);
            if (err.message.includes("ECONNREFUSED")) {
                console.error(
                    "[Redis] 无法连接到 Redis 服务器，请确保已启动 Redis 或配置正确的连接地址"
                );
            }
        });

        redis.on("connect", () => {
            console.log("[Redis] 已连接");
        });

        redis.on("ready", () => {
            console.log("[Redis] 就绪");
        });

        redis.on("close", () => {
            console.warn("[Redis] 连接已关闭");
        });
    }
    return redis;
}

export async function closeRedis(): Promise<void> {
    if (redis) {
        await redis.quit();
        redis = null;
        console.log("[Redis] 已断开");
    }
}
