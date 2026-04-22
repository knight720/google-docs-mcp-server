/**
 * Google Docs API 用戶端封裝
 * 讀取文件內容，支援純文字抽取與原始結構查詢
 */

import { google } from "googleapis";
import type { docs_v1 } from "googleapis";
import { getAuthenticatedClient } from "../auth.js";
import type { DocumentTextResult } from "../types.js";

function getDocsClient(): docs_v1.Docs {
  const auth = getAuthenticatedClient();
  return google.docs({ version: "v1", auth });
}

/** 從 Google Docs 結構中遞迴抽取純文字 */
function extractText(
  content: docs_v1.Schema$StructuralElement[] | undefined,
  parts: string[],
  omitted: Set<string>
): void {
  if (!content) return;

  for (const element of content) {
    if (element.paragraph) {
      for (const pe of element.paragraph.elements ?? []) {
        if (pe.textRun?.content) {
          parts.push(pe.textRun.content);
        }
        // inlineObjectElement、autoText 等略過
      }
    } else if (element.table) {
      // 處理表格：逐格抽取文字，以 tab 分隔欄、換行分隔列
      for (const row of element.table.tableRows ?? []) {
        const cells: string[] = [];
        for (const cell of row.tableCells ?? []) {
          const cellParts: string[] = [];
          extractText(cell.content ?? [], cellParts, omitted);
          cells.push(cellParts.join("").replace(/\n$/, ""));
        }
        parts.push(cells.join("\t") + "\n");
      }
    } else if (element.tableOfContents) {
      omitted.add("目錄（Table of Contents）");
    } else if (element.sectionBreak) {
      parts.push("\n");
    }
  }
}

/** 讀取文件純文字內容 */
export async function getDocumentText(options: {
  documentId: string;
  maxChars?: number;
  includeHeaders?: boolean;
  includeFooters?: boolean;
}): Promise<DocumentTextResult> {
  const docs = getDocsClient();
  const { documentId, maxChars = 50000, includeHeaders = false, includeFooters = false } = options;

  const response = await docs.documents.get({ documentId });
  const doc = response.data;

  const title = doc.title ?? "";
  const parts: string[] = [];
  const omitted = new Set<string>();

  // 主體內容
  extractText(doc.body?.content ?? [], parts, omitted);

  // 頁首
  if (includeHeaders && doc.headers) {
    for (const header of Object.values(doc.headers)) {
      extractText(header.content ?? [], parts, omitted);
    }
  } else if (!includeHeaders && doc.headers && Object.keys(doc.headers).length > 0) {
    omitted.add("頁首（Headers）");
  }

  // 頁尾
  if (includeFooters && doc.footers) {
    for (const footer of Object.values(doc.footers)) {
      extractText(footer.content ?? [], parts, omitted);
    }
  } else if (!includeFooters && doc.footers && Object.keys(doc.footers).length > 0) {
    omitted.add("頁尾（Footers）");
  }

  // 註腳略過，標示
  if (doc.footnotes && Object.keys(doc.footnotes).length > 0) {
    omitted.add("註腳（Footnotes）");
  }

  let text = parts.join("");
  let truncated = false;

  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }

  return {
    documentId,
    title,
    text,
    charCount: text.length,
    truncated,
    sectionsOmitted: Array.from(omitted),
  };
}

/** 取得文件 metadata（不含全文）*/
export async function getDocumentMetadata(documentId: string): Promise<{
  documentId: string;
  title: string;
  revisionId: string;
}> {
  const docs = getDocsClient();
  const response = await docs.documents.get({
    documentId,
    fields: "documentId,title,revisionId",
  });
  return {
    documentId: response.data.documentId ?? documentId,
    title: response.data.title ?? "",
    revisionId: response.data.revisionId ?? "",
  };
}
