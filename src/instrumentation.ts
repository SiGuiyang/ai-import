/**
 * Next.js Instrumentation Hook
 * 在服务启动时自动检查并创建数据库表
 */
export async function register() {
  // 仅在 Node.js 运行时（服务端）执行数据库初始化
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeDatabase } = await import("./lib/db/migrate");
    await initializeDatabase();
  }
}
