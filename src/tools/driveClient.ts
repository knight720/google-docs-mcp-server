/**
 * Google Drive API 用戶端封裝
 * 列出與搜尋使用者 Google Drive 中的 Google Docs 文件
 */

import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { getAuthenticatedClient } from "../auth.js";
import type { DocFile, ListDocumentsResult } from "../types.js";

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

function getDriveClient(): drive_v3.Drive {
  const auth = getAuthenticatedClient();
  return google.drive({ version: "v3", auth });
}

/**
 * 對 Drive API 查詢中的字串值做 escaping
 * （Google Drive query 用單引號包裹，需 escape 單引號為 \'）
 */
function escapeQueryString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** 列出 Google Drive 中的 Google Docs 文件 */
export async function listDocuments(options: {
  query?: string;
  pageSize?: number;
  pageToken?: string;
  includeSharedWithMe?: boolean;
}): Promise<ListDocumentsResult> {
  const drive = getDriveClient();
  const { query, pageSize = 50, pageToken, includeSharedWithMe = true } = options;

  // 組合 Drive query
  let q = `mimeType='${GOOGLE_DOC_MIME}' and trashed=false`;
  if (query) {
    q += ` and name contains '${escapeQueryString(query)}'`;
  }
  if (!includeSharedWithMe) {
    q += ` and 'me' in owners`;
  }

  const response = await drive.files.list({
    q,
    pageSize: Math.min(pageSize, 100),
    pageToken: pageToken ?? undefined,
    fields: "nextPageToken,incompleteSearch,files(id,name,modifiedTime,createdTime,owners,webViewLink)",
    orderBy: "modifiedTime desc",
    // 不使用 supportsAllDrives 以保持個人 My Drive 範疇（Shared drives 需額外申請）
  });

  const data = response.data;
  const documents: DocFile[] = (data.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? "",
    modifiedTime: f.modifiedTime ?? "",
    createdTime: f.createdTime ?? "",
    owners: (f.owners ?? []).map((o) => o.displayName ?? o.emailAddress ?? ""),
    webViewLink: f.webViewLink ?? "",
  }));

  return {
    documents,
    nextPageToken: data.nextPageToken ?? null,
    totalCount: documents.length,
    incompleteSearch: data.incompleteSearch ?? false,
  };
}
