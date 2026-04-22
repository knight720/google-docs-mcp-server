# Google Docs MCP Server

透過 OAuth 2.0 讀取個人 Google Drive 上 Google Docs 文件的 MCP Server。

- **認證方式**：OAuth 2.0（可存取個人所有 Google Docs，不受共用限制）
- **最小權限**：`drive.metadata.readonly` + `documents.readonly`
- **定位**：單機、單使用者本機工具

## 提供的 MCP Tools

| Tool | 說明 |
| --- | --- |
| `docs_list_documents` | 列出 Google Drive 中的 Google Docs，支援關鍵字搜尋與分頁 |
| `docs_get_document_text` | 讀取文件純文字內容（適合 AI 閱讀），支援 `maxChars` 截斷 |
| `docs_get_document_metadata` | 取得文件 metadata（標題、revisionId） |

---

## 設定流程

### Step 1：建立 Google Cloud 專案

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 點選頂部專案選單 → **新增專案**，輸入名稱後建立
3. 確認左上角已切換到新建的專案

> 若已有現有 GCP 專案也可沿用。

---

### Step 2：啟用所需 API

在同一個 GCP 專案中啟用以下兩個 API：

- [啟用 Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
- [啟用 Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)

點進各連結後按「**啟用**」即可。

---

### Step 3：設定 OAuth 同意畫面

1. 左側選單 → **API 和服務** → **OAuth 同意畫面**
2. User Type 選擇 **外部（External）** → 點「建立」
3. 填寫必填欄位：
   - **應用程式名稱**：`MCP Docs Server`（可自訂）
   - **使用者支援電子郵件**：你的 Gmail
   - **開發人員聯絡資訊**：你的 Gmail
4. 點「**儲存並繼續**」跳過「範圍」頁面
5. 在「**測試使用者**」頁面點「**+ ADD USERS**」，加入你的 Gmail → 儲存
6. 完成

> **為何需要加入測試使用者？**
> 應用程式在測試階段只有列入清單的帳號才能授權，不需要通過 Google 官方審核。

---

### Step 4：建立 OAuth 用戶端 ID

1. 左側選單 → **API 和服務** → **憑證（Credentials）**
2. 點「**+ 建立憑證**」→「**OAuth 用戶端 ID**」
3. 應用程式類型選：**桌面應用程式（Desktop app）**
4. 名稱隨意填寫（例如 `MCP Docs Client`）→ 按「建立」
5. 點「**下載 JSON**」，將檔案儲存到安全位置

   建議路徑：
   ```
   D:\Cloud\Dropbox\91APP\Setting\mcp-docs-credentials.json
   ```

> ⚠️ 此檔案包含 OAuth 用戶端金鑰，請勿 commit 到 git 或公開分享。

---

### Step 5：建置專案

```bash
cd D:\Code\SideProject\google-docs-mcp-server
npm install
npm run build
```

---

### Step 6：建立 config.json

在專案根目錄建立 `config.json`（參考 `config.json.example`）：

```json
{
  "credentialsFile": "D:\\Cloud\\Dropbox\\91APP\\Setting\\mcp-docs-credentials.json",
  "tokenFile": "D:\\Cloud\\Dropbox\\91APP\\Setting\\mcp-docs-tokens.json"
}
```

| 欄位 | 說明 |
|------|------|
| `credentialsFile` | Step 4 下載的 OAuth 憑證 JSON 路徑 |
| `tokenFile` | 授權後儲存 access/refresh token 的路徑（自動建立） |

> 也可改用環境變數：
> ```
> GOOGLE_OAUTH_CREDENTIALS_FILE=<credentials 路徑>
> GOOGLE_TOKEN_FILE=<token 路徑>（可選）
> ```

---

### Step 7：執行一次性 OAuth 授權

```bash
cd D:\Code\SideProject\google-docs-mcp-server
node dist/authorize.js
```

執行後：
1. 瀏覽器自動開啟 Google 授權頁面
2. 選擇你的 Google 帳號
3. 若出現「**這個應用程式未經 Google 驗證**」警告 → 點「**進階**」→「**前往 MCP Docs Server（不安全）**」
4. 確認授權範圍 → 點「**允許**」
5. 終端機顯示 `✅ 授權成功！` 即完成

Token 自動儲存至 `config.json` 中指定的 `tokenFile` 路徑，**之後不需要再執行**（token 會自動 refresh）。

---

### Step 8：設定 MCP Server

在 `~/.copilot/mcp-config.json` 加入：

```json
"google-docs": {
  "type": "local",
  "command": "node",
  "args": ["D:\\Code\\SideProject\\google-docs-mcp-server\\dist\\index.js"],
  "tools": ["*"]
}
```

> 若使用環境變數而非 config.json，則需加入：
> ```json
> "env": {
>   "GOOGLE_OAUTH_CREDENTIALS_FILE": "D:\\Cloud\\Dropbox\\91APP\\Setting\\mcp-docs-credentials.json"
> }
> ```

重啟 Copilot CLI 後即可使用。

---

## 多帳號支援

若需要同時存取多個 Google 帳號，為每個帳號準備一份獨立的 token 檔案：

1. 複製一份 config，修改 `tokenFile` 路徑
2. 執行 `node dist/authorize.js` 並以不同帳號登入
3. 在 `mcp-config.json` 新增一組 server，透過環境變數指向不同 token 檔案：

```json
"google-docs-account2": {
  "type": "local",
  "command": "node",
  "args": ["D:\\Code\\SideProject\\google-docs-mcp-server\\dist\\index.js"],
  "env": {
    "GOOGLE_OAUTH_CREDENTIALS_FILE": "D:\\Cloud\\Dropbox\\91APP\\Setting\\mcp-docs-credentials.json",
    "GOOGLE_TOKEN_FILE": "D:\\Cloud\\Dropbox\\91APP\\Setting\\mcp-docs-tokens-account2.json"
  },
  "tools": ["*"]
}
```

---

## 注意事項

- **Shared drives**：預設不包含，僅列出 My Drive 與「與我共用」的文件
- **Token 安全**：token 檔案含長效 refresh token，請確保不要 commit 到 git（已加入 `.gitignore`）
- **重新授權**：若 token 失效，重新執行 `node dist/authorize.js` 即可
- **費用**：Drive API 與 Docs API 個人使用完全免費，無呼叫次數費用
