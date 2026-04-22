#!/usr/bin/env node
/**
 * Google Docs MCP Server
 *
 * 提供讀取個人 Google Drive 上 Google Docs 文件的工具。
 * 使用 OAuth 2.0 認證（需先執行 authorize.js 完成授權）。
 *
 * 設定方式：
 *   - 環境變數 GOOGLE_OAUTH_CREDENTIALS_FILE=<path>  (OAuth credentials JSON)
 *   - 環境變數 GOOGLE_TOKEN_FILE=<path>              (可選，自訂 token 儲存路徑)
 *   - 或建立 config.json（參考 config.json.example）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseDocumentId } from "./config.js";
import { ResponseFormat } from "./types.js";
import { listDocuments } from "./tools/driveClient.js";
import { getDocumentText, getDocumentMetadata } from "./tools/docsClient.js";

const server = new McpServer({
  name: "google-docs-mcp-server",
  version: "1.0.0",
});

function handleError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("PERMISSION_DENIED") || msg.includes("403")) {
      return `錯誤：權限不足。請確認 OAuth 授權範圍包含 Drive metadata 與 Docs readonly。`;
    }
    if (msg.includes("NOT_FOUND") || msg.includes("404")) {
      return `錯誤：找不到文件。請確認 Document ID 是否正確，以及您有閱讀權限。`;
    }
    if (msg.includes("INVALID_ARGUMENT") || msg.includes("400")) {
      return `錯誤：無效的參數。${msg}`;
    }
    if (msg.includes("invalid_grant") || msg.includes("Token has been expired")) {
      return `錯誤：授權已失效。請重新執行 node dist/authorize.js 完成授權。`;
    }
    return `錯誤：${msg}`;
  }
  return `錯誤：發生未預期的問題：${String(error)}`;
}

// ─── Tool: docs_list_documents ────────────────────────────────────────────────

server.registerTool(
  "docs_list_documents",
  {
    title: "列出 Google Docs 文件",
    description: `列出個人 Google Drive 中的 Google Docs 文件，支援關鍵字搜尋與分頁。

Args:
  - query (string, 可選)：依文件名稱搜尋的關鍵字
  - pageSize (number, 可選)：每頁數量，預設 50，最大 100
  - pageToken (string, 可選)：分頁 token（由上一頁回傳的 nextPageToken）
  - includeSharedWithMe (boolean, 可選)：是否包含「與我共用」的文件，預設 true
  - response_format (string, 可選)：回應格式 markdown 或 json

Returns:
  文件清單（id、名稱、修改時間、擁有者、網址）與分頁資訊

Notes:
  - 結果依最後修改時間倒序排列
  - 若 incompleteSearch=true 表示結果可能不完整（Drive 索引尚未更新）`,
    inputSchema: z.object({
      query: z.string().optional().describe("依文件名稱搜尋的關鍵字（部分比對）"),
      pageSize: z.number().int().min(1).max(100).default(50).describe("每頁文件數量（預設 50，最大 100）"),
      pageToken: z.string().optional().describe("分頁 token，來自上一頁的 nextPageToken"),
      includeSharedWithMe: z.boolean().default(true).describe("是否包含「與我共用」的文件（預設 true）"),
      response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("回應格式：markdown（預設）或 json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ query, pageSize, pageToken, includeSharedWithMe, response_format }) => {
    try {
      const result = await listDocuments({ query, pageSize, pageToken, includeSharedWithMe });

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
      }

      if (result.documents.length === 0) {
        const msg = query ? `找不到名稱包含「${query}」的文件。` : `Google Drive 中沒有 Google Docs 文件。`;
        return { content: [{ type: "text", text: msg }] };
      }

      const lines: string[] = [
        `# Google Docs 文件清單`,
        ``,
        `共 ${result.totalCount} 筆${result.nextPageToken ? "（尚有更多，使用 pageToken 取得下一頁）" : ""}${result.incompleteSearch ? "\n⚠️ 注意：搜尋結果可能不完整（Drive 索引尚未更新）" : ""}`,
        ``,
        `| 名稱 | 修改時間 | 擁有者 | Document ID |`,
        `| --- | --- | --- | --- |`,
        ...result.documents.map((d) =>
          `| [${d.name}](${d.webViewLink}) | ${d.modifiedTime.slice(0, 10)} | ${d.owners.join(", ")} | \`${d.id}\` |`
        ),
      ];

      if (result.nextPageToken) {
        lines.push(``, `**nextPageToken**: \`${result.nextPageToken}\``);
      }

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: result };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ─── Tool: docs_get_document_text ─────────────────────────────────────────────

server.registerTool(
  "docs_get_document_text",
  {
    title: "讀取文件純文字",
    description: `讀取 Google Docs 文件的純文字內容，適合 AI 閱讀與分析。

Args:
  - documentId (string)：Document ID 或 Google Docs 完整 URL
  - maxChars (number, 可選)：最大回傳字元數，預設 50000（避免超出 context）
  - includeHeaders (boolean, 可選)：是否包含頁首，預設 false
  - includeFooters (boolean, 可選)：是否包含頁尾，預設 false
  - response_format (string, 可選)：回應格式 markdown 或 json

Returns:
  文件標題、純文字內容、字元數、是否被截斷、略過的區塊清單

Notes:
  - 表格內容會以 tab 分隔欄、換行分隔列
  - 若 truncated=true，請使用較大的 maxChars 或分段讀取`,
    inputSchema: z.object({
      documentId: z.string().min(1).describe("Document ID 或 Google Docs 完整 URL"),
      maxChars: z.number().int().min(1).max(200000).default(50000).describe("最大回傳字元數（預設 50000）"),
      includeHeaders: z.boolean().default(false).describe("是否包含頁首（預設 false）"),
      includeFooters: z.boolean().default(false).describe("是否包含頁尾（預設 false）"),
      response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("回應格式：markdown（預設）或 json"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ documentId, maxChars, includeHeaders, includeFooters, response_format }) => {
    try {
      const id = parseDocumentId(documentId);
      const result = await getDocumentText({ documentId: id, maxChars, includeHeaders, includeFooters });

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
      }

      const lines: string[] = [
        `# ${result.title}`,
        ``,
        `- **Document ID**: \`${result.documentId}\``,
        `- **字元數**: ${result.charCount}${result.truncated ? `（已截斷，原文超過 ${maxChars} 字元）` : ""}`,
      ];

      if (result.sectionsOmitted.length > 0) {
        lines.push(`- **略過區塊**: ${result.sectionsOmitted.join("、")}`);
      }

      lines.push(``, `---`, ``, result.text);

      if (result.truncated) {
        lines.push(``, `> ⚠️ 內容已截斷。若需完整內容，請增加 maxChars 參數值。`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: result };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ─── Tool: docs_get_document_metadata ─────────────────────────────────────────

server.registerTool(
  "docs_get_document_metadata",
  {
    title: "讀取文件 Metadata",
    description: `取得 Google Docs 文件的基本資訊（不含全文內容）。

Args:
  - documentId (string)：Document ID 或 Google Docs 完整 URL

Returns:
  documentId、標題、revisionId`,
    inputSchema: z.object({
      documentId: z.string().min(1).describe("Document ID 或 Google Docs 完整 URL"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ documentId }) => {
    try {
      const id = parseDocumentId(documentId);
      const result = await getDocumentMetadata(id);
      const lines = [
        `# ${result.title}`,
        ``,
        `- **Document ID**: \`${result.documentId}\``,
        `- **Revision ID**: \`${result.revisionId}\``,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: result };
    } catch (error) {
      return { content: [{ type: "text", text: handleError(error) }] };
    }
  }
);

// ─── 啟動 ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[Google Docs MCP] 已就緒，等待指令...\n`);
}

main().catch((error) => {
  process.stderr.write(`[Google Docs MCP] 啟動失敗：${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
