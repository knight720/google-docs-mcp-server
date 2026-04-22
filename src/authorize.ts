#!/usr/bin/env node
/**
 * Google OAuth 2.0 一次性授權腳本
 *
 * 使用方式：node dist/authorize.js
 *
 * 流程：
 *   1. 在 127.0.0.1 隨機 port 開啟暫時 HTTP callback server
 *   2. 開啟瀏覽器（或顯示 URL 讓使用者手動開）
 *   3. 使用者登入並授權後，callback 自動接收 code
 *   4. 換取 tokens 並儲存
 */

import * as http from "http";
import * as url from "url";
import { createOAuth2Client, saveTokens } from "./auth.js";
import { config } from "./config.js";

// 最小必要 scope：Drive metadata 唯讀 + Docs 全文唯讀
const SCOPES = [
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
];

async function authorize(): Promise<void> {
  const oauth2Client = createOAuth2Client();

  // 使用 loopback redirect
  const port = await getFreePort();
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // 確保每次都回傳 refresh_token
    scope: SCOPES,
    redirect_uri: redirectUri,
  });

  // 更新 client 的 redirect URI（使用 unknown 繞過 private 存取限制）
  (oauth2Client as unknown as { redirectUri: string }).redirectUri = redirectUri;

  console.log("\n=== Google Docs MCP Server - OAuth 授權 ===\n");
  console.log("請在瀏覽器開啟以下 URL 進行授權：\n");
  console.log(authUrl);
  console.log("\n授權完成後，此腳本將自動繼續...\n");

  // 嘗試自動開啟瀏覽器（使用 Node.js 內建的 child_process）
  try {
    const { execSync } = await import("child_process");
    const cmd = process.platform === "win32" ? `start "" "${authUrl}"` : process.platform === "darwin" ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch {
    // 開啟失敗時，使用者手動複製 URL 即可
  }

  // 等待 callback
  const code = await waitForAuthCode(port);

  const { tokens } = await oauth2Client.getToken({ code, redirect_uri: redirectUri });
  saveTokens(tokens);

  console.log("✅ 授權成功！tokens 已儲存至：");
  console.log(`   ${config.tokenFile}\n`);
}

/** 在 127.0.0.1 開啟暫時 HTTP server，等待 OAuth callback 並回傳 code */
function waitForAuthCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url ?? "", true);
      const code = parsedUrl.query["code"];
      const error = parsedUrl.query["error"];

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>授權失敗：${error}</h1><p>請關閉此視窗。</p>`);
        server.close();
        reject(new Error(`OAuth 授權失敗：${error}`));
        return;
      }

      if (code && typeof code === "string") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>✅ 授權成功！</h1><p>請關閉此視窗，返回終端機。</p>`);
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>未收到授權碼</h1>`);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      // server 啟動，等待 callback
    });

    server.on("error", reject);

    // 5 分鐘逾時
    setTimeout(() => {
      server.close();
      reject(new Error("授權逾時（5 分鐘內未完成）"));
    }, 5 * 60 * 1000);
  });
}

/** 取得隨機可用 port */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

authorize().catch((error) => {
  process.stderr.write(`[授權失敗] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
