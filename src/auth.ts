/**
 * OAuth 2.0 認證模組
 *
 * 負責：
 *   - 建立 OAuth2 client
 *   - 從檔案載入已存的 tokens
 *   - 自動 refresh access token
 *   - token 更新時回寫檔案
 */

import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { config } from "./config.js";

export interface TokenData {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
}

/** 從 credentials JSON 建立 OAuth2 client */
export function createOAuth2Client(): OAuth2Client {
  const raw = readFileSync(config.credentialsFile, "utf-8");
  const creds = JSON.parse(raw) as {
    installed?: { client_id: string; client_secret: string; redirect_uris: string[] };
    web?: { client_id: string; client_secret: string; redirect_uris: string[] };
  };

  const { client_id, client_secret, redirect_uris } = creds.installed ?? creds.web ?? (() => {
    throw new Error("credentials.json 格式不正確，找不到 installed 或 web 區塊");
  })();

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // 當 token 自動 refresh 後，將新 token 存回檔案
  oauth2Client.on("tokens", (tokens) => {
    const existing = loadTokens() ?? {};
    const merged: TokenData = { ...existing, ...tokens };
    saveTokens(merged);
  });

  return oauth2Client;
}

/** 從檔案載入 token */
export function loadTokens(): TokenData | null {
  if (!existsSync(config.tokenFile)) return null;
  try {
    const raw = readFileSync(config.tokenFile, "utf-8");
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}

/** 將 token 存入檔案 */
export function saveTokens(tokens: TokenData): void {
  writeFileSync(config.tokenFile, JSON.stringify(tokens, null, 2), { encoding: "utf-8", mode: 0o600 });
}

/**
 * 取得已授權的 OAuth2 client。
 * 若找不到 token，提示使用者先執行 authorize 腳本後退出。
 */
export function getAuthenticatedClient(): OAuth2Client {
  const oauth2Client = createOAuth2Client();
  const tokens = loadTokens();

  if (!tokens?.refresh_token && !tokens?.access_token) {
    process.stderr.write(
      `[錯誤] 尚未完成 Google 授權。\n` +
      `  請先執行以下指令完成一次性授權：\n` +
      `  node dist/authorize.js\n`
    );
    process.exit(1);
  }

  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}
