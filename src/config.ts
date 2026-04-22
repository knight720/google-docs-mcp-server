/**
 * 設定載入模組
 *
 * 設定方式（優先順序）：
 *   1. 環境變數 GOOGLE_OAUTH_CREDENTIALS_FILE
 *   2. 環境變數 GOOGLE_TOKEN_FILE
 *   3. config.json 的 credentialsFile / tokenFile
 *
 * Token 預設儲存在 %APPDATA%\google-docs-mcp\tokens.json（Windows）
 * 或 ~/.config/google-docs-mcp/tokens.json（其他平台）
 */

import { readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir, platform } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppConfig {
  /** OAuth 2.0 Desktop App credentials JSON 路徑 */
  credentialsFile: string;
  /** access/refresh token 儲存路徑 */
  tokenFile: string;
}

/** 解析 Google Docs URL 或純 ID，回傳 documentId */
export function parseDocumentId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match?.[1]) return match[1];
  return trimmed;
}

/** 取得 token 的預設儲存目錄 */
function getDefaultTokenDir(): string {
  if (platform() === "win32") {
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "google-docs-mcp");
  }
  return join(homedir(), ".config", "google-docs-mcp");
}

function loadConfig(): AppConfig {
  const configPath = resolve(__dirname, "../config.json");
  let fileConfig: Partial<{ credentialsFile: string; tokenFile: string }> = {};

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(raw) as typeof fileConfig;
    } catch {
      process.stderr.write(`[警告] 無法解析 config.json，將忽略檔案設定\n`);
    }
  }

  const credentialsFile =
    process.env["GOOGLE_OAUTH_CREDENTIALS_FILE"] ??
    fileConfig.credentialsFile ??
    "";

  if (!credentialsFile) {
    process.stderr.write(
      `[錯誤] 未設定 Google OAuth credentials 檔案路徑。\n` +
      `  方式一：設定環境變數 GOOGLE_OAUTH_CREDENTIALS_FILE=<path>\n` +
      `  方式二：在 config.json 中設定 "credentialsFile": "<path>"\n` +
      `\n` +
      `  請至 Google Cloud Console 建立 OAuth 2.0 憑證（桌面應用程式類型）並下載。\n`
    );
    process.exit(1);
  }

  const absoluteCredentials = resolve(credentialsFile);
  if (!existsSync(absoluteCredentials)) {
    process.stderr.write(`[錯誤] credentials 檔案不存在：${absoluteCredentials}\n`);
    process.exit(1);
  }

  const tokenDir = getDefaultTokenDir();
  const defaultTokenFile = join(tokenDir, "tokens.json");
  const tokenFile =
    process.env["GOOGLE_TOKEN_FILE"] ??
    fileConfig.tokenFile ??
    defaultTokenFile;

  // 確保 token 目錄存在
  const absoluteTokenFile = resolve(tokenFile);
  mkdirSync(dirname(absoluteTokenFile), { recursive: true });

  return {
    credentialsFile: absoluteCredentials,
    tokenFile: absoluteTokenFile,
  };
}

export const config = loadConfig();
