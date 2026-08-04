import { execSync } from "child_process";

/**
 * 项目启动时初始化数据库表
 * 若表已存在则跳过，不存在则创建
 */
export async function initializeDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn(
      "[DB Init] DATABASE_URL is not set, skipping table initialization."
    );
    return;
  }

  try {
    console.log("[DB Init] Checking database tables...");
    execSync("npx drizzle-kit push", {
      stdio: "inherit",
      env: { ...process.env },
      cwd: process.cwd(),
    });
    console.log("[DB Init] Database tables are up to date.");
  } catch (error) {
    console.error("[DB Init] Failed to initialize database tables:", error);
    // 不抛出异常，允许应用在 DB 初始化失败时仍可启动
  }
}
