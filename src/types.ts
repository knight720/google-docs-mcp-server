/** Google Docs MCP Server 共用型別定義 */

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** Drive 上的 Google Doc 文件資訊 */
export interface DocFile extends Record<string, unknown> {
  id: string;
  name: string;
  modifiedTime: string;
  createdTime: string;
  owners: string[];
  webViewLink: string;
}

/** docs_list_documents 回傳結果 */
export interface ListDocumentsResult extends Record<string, unknown> {
  documents: DocFile[];
  nextPageToken: string | null;
  totalCount: number;
  incompleteSearch: boolean;
}

/** docs_get_document_text 回傳結果 */
export interface DocumentTextResult extends Record<string, unknown> {
  documentId: string;
  title: string;
  text: string;
  charCount: number;
  truncated: boolean;
  sectionsOmitted: string[];
}

/** docs_get_document 回傳結果（原始 Docs API 結構，僅保留 metadata） */
export interface DocumentResult extends Record<string, unknown> {
  documentId: string;
  title: string;
  revisionId: string;
}
