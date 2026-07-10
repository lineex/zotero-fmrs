import { getPref, setPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import {
  extractIdentifiersFromTexts,
  filenameLooksLikePdf,
  titleMatches,
} from "./Identifiers";

declare const ChromeUtils: {
  importESModule(path: string): any;
};
declare const Components: any;

const SUGGESTED_WINDOWS_CLI_PATH =
  "D:\\program\\MyAgents\\nodejs\\agently-cli.cmd";
const DEFAULT_POP3_USER = "";
const DEFAULT_POP3_PASSWORD = "";
const DEFAULT_POP3_HOST = "pop.163.com";
const DEFAULT_POP3_PORT = 995;

export interface AttachmentRecord {
  messageId: string;
  attachmentId?: string;
  filename: string;
  subject: string;
  senderEmail: string;
  createdAt: string;
  body?: string;
  contentType?: string;
  downloadUrl?: string;
}

export interface PollSummary {
  scanned: number;
  matched: number;
  imported: number;
  errors: string[];
}

interface MessageListResponse {
  ok?: boolean;
  data?: {
    data?: Array<{
      message_id?: string;
      subject?: string;
      created_at?: string;
      from?: {
        email?: string;
        name?: string;
      };
    }>;
  };
}

interface MessageReadResponse {
  ok?: boolean;
  data?: {
    message_id?: string;
    subject?: string;
    created_at?: string;
    body?: string;
    from?: {
      email?: string;
      name?: string;
    };
    attachments?: Array<{
      attachment_id?: string;
      filename?: string;
      content_type?: string;
      download_url?: string;
    }>;
  };
}

interface AttachmentDownloadResponse {
  filename?: string;
  saved_to?: string;
  size?: number;
}

interface Pop3Record {
  messageId?: string;
  filename?: string;
  subject?: string;
  senderEmail?: string;
  createdAt?: string;
  body?: string;
  contentType?: string;
  savedTo?: string;
}

interface Pop3Response {
  ok?: boolean;
  email?: string;
  count?: number;
  data?: Pop3Record[];
  message?: string;
}

export class AgentMailBridge {
  static get enabled() {
    return Boolean(getPref("agentMailEnabled"));
  }

  static get backend() {
    const value = String(getPref("mailBackend") || "pop3").trim();
    return value === "agently" ? "agently" : "pop3";
  }

  static get watchSender() {
    return String(getPref("agentMailSenderFilter") || "")
      .trim()
      .toLowerCase();
  }

  static get watchDir() {
    return String(getPref("agentMailDir") || "inbox").trim() || "inbox";
  }

  static get pollLimit() {
    const value = Number(getPref("agentMailPollLimit") || 30);
    return Number.isFinite(value) && value > 0
      ? Math.min(Math.max(Math.trunc(value), 1), 50)
      : 30;
  }

  static get lastMessageId() {
    return String(getPref("agentMailLastMessageId") || "").trim();
  }

  static get pop3Host() {
    return String(getPref("pop3Host") || DEFAULT_POP3_HOST).trim();
  }

  static get pop3Port() {
    const value = Number(getPref("pop3Port") || DEFAULT_POP3_PORT);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_POP3_PORT;
  }

  static get pop3UseSSL() {
    return getPref("pop3UseSSL") === undefined
      ? true
      : Boolean(getPref("pop3UseSSL"));
  }

  static get pop3Username() {
    return String(getPref("pop3Username") || DEFAULT_POP3_USER).trim();
  }

  static get pop3Password() {
    return String(getPref("pop3Password") || DEFAULT_POP3_PASSWORD).trim();
  }

  static getSuggestedCliPath() {
    return Zotero.isWin ? SUGGESTED_WINDOWS_CLI_PATH : "agently-cli";
  }

  static getConfiguredCliPath() {
    return String(getPref("agentMailCliPath") || "").trim();
  }

  static getDisplayCliPath() {
    return this.getConfiguredCliPath() || this.getSuggestedCliPath();
  }

  static async status() {
    if (this.backend === "pop3") {
      return this.statusPop3();
    }
    return this.statusAgently();
  }

  private static async statusPop3() {
    if (!Zotero.isWin) {
      return {
        ok: false,
        message: "pop3-powershell-required",
      };
    }
    try {
      const data = await this.runPop3Json("status");
      return {
        ok: Boolean(data?.ok),
        email: data?.email || this.pop3Username,
        message: data?.ok ? `ok / ${data.count ?? 0} messages` : data?.message || "pop3-auth-failed",
      };
    } catch (error) {
      return {
        ok: false,
        message: String(error),
      };
    }
  }

  private static async statusAgently() {
    const cliPath = this.getCliCommand();
    if (!cliPath) {
      return {
        ok: false,
        message: "agently-cli-not-found",
      };
    }

    try {
      const data = await this.runCliJson([cliPath, "+me"]);
      const aliases = Array.isArray(data?.data?.aliases) ? data.data.aliases : [];
      const primary = aliases.find((alias: any) => alias?.is_primary) || aliases[0];
      return {
        ok: Boolean(data?.ok),
        email: primary?.email ? String(primary.email) : "",
        message: data?.ok ? "ok" : "agent-mail-auth-required",
      };
    } catch (error) {
      return {
        ok: false,
        message: String(error),
      };
    }
  }

  static async pollAndImport(
    client: {
      findItemForRecord(record: AttachmentRecord): Promise<Zotero.Item | null>;
      importAttachmentToItem(record: AttachmentRecord, item: Zotero.Item): Promise<boolean>;
    },
    options: { interactive?: boolean } = {},
  ): Promise<PollSummary> {
    if (this.backend === "pop3") {
      return this.pollPop3AndImport(client, options);
    }
    return this.pollAgentlyAndImport(client, options);
  }

  private static async pollPop3AndImport(
    client: {
      findItemForRecord(record: AttachmentRecord): Promise<Zotero.Item | null>;
      importAttachmentToItem(record: AttachmentRecord, item: Zotero.Item): Promise<boolean>;
    },
    options: { interactive?: boolean } = {},
  ): Promise<PollSummary> {
    const summary: PollSummary = {
      scanned: 0,
      matched: 0,
      imported: 0,
      errors: [],
    };

    if (!this.enabled) {
      return summary;
    }
    if (!Zotero.isWin) {
      summary.errors.push("pop3-powershell-required");
      return summary;
    }

    let data: Pop3Response;
    try {
      data = await this.runPop3Json("poll");
    } catch (error) {
      summary.errors.push(String(error));
      return summary;
    }

    const records = Array.isArray(data?.data) ? data.data : [];
    const senderFilter = this.watchSender;
    const stopAtId = options.interactive ? "" : this.lastMessageId;
    let newestMessageId = "";

    for (const rawRecord of records) {
      const messageId = String(rawRecord?.messageId || "").trim();
      if (!messageId) {
        continue;
      }
      if (!newestMessageId) {
        newestMessageId = messageId;
      }
      if (stopAtId && messageId === stopAtId) {
        break;
      }

      const fromEmail = String(rawRecord?.senderEmail || "").trim().toLowerCase();
      const subject = String(rawRecord?.subject || "").trim();
      if (!isLiteratureEmail(fromEmail, subject, senderFilter)) {
        continue;
      }

      const filename = String(rawRecord?.filename || "").trim();
      const savedTo = String(rawRecord?.savedTo || "").trim();
      if (!filenameLooksLikePdf(filename) || !savedTo) {
        continue;
      }

      summary.scanned += 1;

      const record: AttachmentRecord = {
        messageId,
        attachmentId: `pop3:${messageId}:${filename}`,
        filename,
        subject: String(rawRecord?.subject || "").trim(),
        senderEmail: fromEmail,
        createdAt: String(rawRecord?.createdAt || ""),
        body: String(rawRecord?.body || ""),
        contentType: String(rawRecord?.contentType || "application/pdf"),
        downloadUrl: savedTo,
      };

      try {
        const item = await client.findItemForRecord(record);
        if (!item) {
          continue;
        }

        const isExact = await this.isExactMatchCheck(record, item);
        const matchMode = String(getPref("agentMailMatchMode") || "auto");
        if (matchMode === "manual") {
          if (!isExact) {
            if (options.interactive) {
              const confirmed = await this.confirmMatch(record, item);
              if (!confirmed) {
                continue;
              }
            } else {
              continue;
            }
          }
        }

        summary.matched += 1;
        const ok = await client.importAttachmentToItem(record, item);
        if (ok) {
          summary.imported += 1;
        }
      } catch (error) {
        summary.errors.push(String(error));
      }
    }

    if (newestMessageId && newestMessageId !== stopAtId) {
      setPref("agentMailLastMessageId", newestMessageId);
    }

    return summary;
  }

  private static async pollAgentlyAndImport(
    client: {
      findItemForRecord(record: AttachmentRecord): Promise<Zotero.Item | null>;
      importAttachmentToItem(record: AttachmentRecord, item: Zotero.Item): Promise<boolean>;
    },
    options: { interactive?: boolean } = {},
  ): Promise<PollSummary> {
    const summary: PollSummary = {
      scanned: 0,
      matched: 0,
      imported: 0,
      errors: [],
    };

    if (!this.enabled) {
      return summary;
    }

    const cliPath = this.getCliCommand();
    if (!cliPath) {
      summary.errors.push("agently-cli-not-found");
      return summary;
    }

    let listData: MessageListResponse;
    try {
      listData = await this.runCliJson([
        cliPath,
        "message",
        "+list",
        "--dir",
        this.watchDir,
        "--limit",
        String(this.pollLimit),
        "--has-attachments",
      ]);
    } catch (error) {
      summary.errors.push(String(error));
      return summary;
    }

    const messages = Array.isArray(listData?.data?.data)
      ? listData.data?.data || []
      : [];
    const senderFilter = this.watchSender;
    const stopAtId = options.interactive ? "" : this.lastMessageId;
    let newestMessageId = "";

    for (const message of messages) {
      const messageId = String(message?.message_id || "").trim();
      if (!messageId) {
        continue;
      }
      if (!newestMessageId) {
        newestMessageId = messageId;
      }
      if (stopAtId && messageId === stopAtId) {
        break;
      }

      const fromEmail = String(message?.from?.email || "")
        .trim()
        .toLowerCase();
      const subject = String(message?.subject || "").trim();
      if (!isLiteratureEmail(fromEmail, subject, senderFilter)) {
        continue;
      }

      summary.scanned += 1;

      try {
        const readData = (await this.runCliJson([
          cliPath,
          "message",
          "+read",
          "--id",
          messageId,
        ])) as MessageReadResponse;
        const attachments = Array.isArray(readData?.data?.attachments)
          ? readData.data?.attachments || []
          : [];
        const subject = String(readData?.data?.subject || message?.subject || "").trim();

        for (const attachment of attachments) {
          const filename = String(attachment?.filename || "").trim();
          if (!filenameLooksLikePdf(filename)) {
            continue;
          }

          const record: AttachmentRecord = {
            messageId,
            attachmentId: attachment?.attachment_id
              ? String(attachment.attachment_id)
              : undefined,
            filename,
            subject,
            senderEmail: fromEmail,
            createdAt: String(readData?.data?.created_at || message?.created_at || ""),
            body: String(readData?.data?.body || ""),
            contentType: attachment?.content_type
              ? String(attachment.content_type)
              : undefined,
            downloadUrl: attachment?.download_url
              ? String(attachment.download_url)
              : undefined,
          };

          const item = await client.findItemForRecord(record);
          if (!item) {
            continue;
          }

          const isExact = await this.isExactMatchCheck(record, item);
          const matchMode = String(getPref("agentMailMatchMode") || "auto");
          if (matchMode === "manual") {
            if (!isExact) {
              if (options.interactive) {
                const confirmed = await this.confirmMatch(record, item);
                if (!confirmed) {
                  continue;
                }
              } else {
                continue;
              }
            }
          }

          summary.matched += 1;
          const ok = await client.importAttachmentToItem(record, item);
          if (ok) {
            summary.imported += 1;
          }
        }
      } catch (error) {
        summary.errors.push(String(error));
      }
    }

    if (newestMessageId && newestMessageId !== stopAtId) {
      setPref("agentMailLastMessageId", newestMessageId);
    }

    return summary;
  }

  static async downloadAttachment(record: AttachmentRecord) {
    if (record.downloadUrl && this.isAbsolutePath(record.downloadUrl)) {
      return record.downloadUrl;
    }

    const cliPath = this.getCliCommand();
    if (!cliPath) {
      throw new Error("agently-cli-not-found");
    }
    if (!record.attachmentId) {
      throw new Error(record.downloadUrl || "agent-mail-large-attachment");
    }

    const workdir = await this.ensureWorkdir();
    const relativeOutput = "./downloads";
    await Zotero.File.createDirectoryIfMissingAsync(
      this.pathJoin(workdir, "downloads"),
    );

    const data = (await this.runCliJson(
      [
        cliPath,
        "attachment",
        "+download",
        "--msg",
        record.messageId,
        "--att",
        record.attachmentId,
        "--output",
        relativeOutput,
      ],
      workdir,
    )) as AttachmentDownloadResponse;

    const savedTo = String(data?.saved_to || "").trim();
    if (!savedTo) {
      throw new Error("agent-mail-download-failed");
    }
    return this.isAbsolutePath(savedTo) ? savedTo : this.pathJoin(workdir, savedTo);
  }

  static getSearchTerms(record: AttachmentRecord) {
    const parsed = parseLiteratureReply(record);
    const identifiers = extractIdentifiersFromTexts([
      parsed.identifier,
      record.subject,
      record.filename,
      record.body || "",
    ]);
    const filenameFmrsId = extractFmrsIdFromFilename(record.filename);
    let bodyTitleTerm = "";
    if (filenameFmrsId && record.body) {
      const cleanBody = stripHtml(record.body);
      const lines = cleanBody.split(/\r?\n/);
      for (const line of lines) {
        if (line.toUpperCase().includes(filenameFmrsId.toUpperCase())) {
          let cleaned = line
            .replace(/\(?[PS]\d{6,12}\)?/i, "")
            .replace(/^\s*(?:\[?\d+\]?|\d+[\.)]|【\d+】)\s*/, "")
            .replace(/\[点击纠错\]|\[需要正式版\]|\[Need Fulltext\]/g, "")
            .trim();
          if (cleaned) {
            bodyTitleTerm = getTitlePrefix(cleaned, 8);
          }
          break;
        }
      }
    }
    const terms = [
      identifiers.doi,
      identifiers.pmid,
      filenameFmrsId,
      bodyTitleTerm,
      getSafeSearchTitle(parsed.title),
      getSafeSearchTitle(cleanReplySubject(record.subject)),
      record.filename.replace(/\.pdf$/i, "").replace(/^DOI/i, ""),
    ];
    return uniqueStrings(
      terms
        .map((term) => term.trim())
        .filter((term) => term.length >= 4),
    );
  }

  static matchesItem(record: AttachmentRecord, item: Zotero.Item) {
    const filenameFmrsId = extractFmrsIdFromFilename(record.filename);
    const itemExtra = String(item.getField("extra") || "");
    const itemIdentifiers = extractIdentifiersFromTexts([
      String(item.getField("DOI") || ""),
      String(item.getField("url") || ""),
      String(item.getField("title") || ""),
      String(item.getField("extra") || ""),
    ]);
    const itemPmid = itemIdentifiers.pmid;
    const itemDoi = normalizeDOI(itemIdentifiers.doi);

    // 1. Precise FMRS ID match
    if (filenameFmrsId) {
      const numericId = filenameFmrsId.slice(1);
      if (numericId && (itemExtra.includes(numericId) || (itemPmid && itemPmid.includes(numericId)))) {
        return true;
      }
    }

    // 2. Title line match for multiple papers in body
    if (filenameFmrsId && record.body) {
      const cleanBody = stripHtml(record.body);
      const lines = cleanBody.split(/\r?\n/);
      for (const line of lines) {
        if (line.toUpperCase().includes(filenameFmrsId.toUpperCase())) {
          let cleaned = line
            .replace(/\(?[PS]\d{6,12}\)?/i, "")
            .replace(/^\s*(?:\[?\d+\]?|\d+[\.)]|【\d+】)\s*/, "")
            .replace(/\[点击纠错\]|\[需要正式版\]|\[Need Fulltext\]/g, "")
            .trim();
          const itemTitle = String(item.getField("title") || "");
          if (itemTitle && cleaned && titleMatches(itemTitle, cleaned)) {
            return true;
          }
          break;
        }
      }
    }

    // Fallback matching logic
    const parsed = parseLiteratureReply(record);
    const recordIdentifiers = extractIdentifiersFromTexts([
      parsed.identifier,
      parsed.title,
      record.subject,
      record.filename,
      record.body || "",
    ]);
    const recordFmrsId = extractFmrsIdFromTexts([
      parsed.identifier,
      record.subject,
      record.filename,
      record.body || "",
    ]);

    if (recordFmrsId) {
      const numericId = recordFmrsId.slice(1);
      if (numericId && (itemExtra.includes(numericId) || (itemPmid && itemPmid.includes(numericId)))) {
        return true;
      }
    }

    if (recordFmrsId && itemPmid) {
      const pmidMatch = recordFmrsId === `P${itemPmid}` || recordFmrsId === `S${itemPmid}`;
      if (pmidMatch) {
        return true;
      }
    }

    if (
      recordIdentifiers.doi &&
      itemDoi &&
      normalizeDOI(recordIdentifiers.doi) === itemDoi
    ) {
      return true;
    }

    if (
      recordIdentifiers.pmid &&
      itemPmid &&
      recordIdentifiers.pmid === itemPmid
    ) {
      return true;
    }

    let matchCount = 0;
    const itemTitle = String(item.getField("title") || "");
    const subjectTitle = parsed.title || cleanReplySubject(record.subject) || record.filename.replace(/\.pdf$/i, "");
    if (itemTitle && subjectTitle && titleMatches(itemTitle, subjectTitle)) {
      matchCount++;
      if (!parsed.author && !parsed.journal && !parsed.year) {
        matchCount++;
      }
    }

    const itemCreators = item.getCreators();
    if (parsed.author && itemCreators.length > 0) {
      const emailAuthorText = parsed.author.toLowerCase();
      const anyAuthorMatches = itemCreators.some((c) => {
        const lastName = String(c.lastName || "").trim().toLowerCase();
        const firstName = String(c.firstName || "").trim().toLowerCase();
        return (
          (lastName && emailAuthorText.includes(lastName)) ||
          (firstName && emailAuthorText.includes(firstName))
        );
      });
      if (anyAuthorMatches) {
        matchCount++;
      }
    }

    const itemJournal = String(item.getField("publicationTitle") || item.getField("journalAbbreviation") || "");
    if (parsed.journal && itemJournal && titleMatches(itemJournal, parsed.journal)) {
      matchCount++;
    }

    const itemDate = String(item.getField("date") || "");
    const itemYear = itemDate.match(/\b(19|20)\d{2}\b/)?.[0] || "";
    if (parsed.year && itemYear && parsed.year.includes(itemYear)) {
      matchCount++;
    }

    const itemVolume = String(item.getField("volume") || "").trim().toLowerCase();
    const parsedVolume = parsed.volume.trim().toLowerCase();
    if (parsedVolume && itemVolume && parsedVolume === itemVolume) {
      matchCount++;
    }

    const itemIssue = String(item.getField("issue") || "").trim().toLowerCase();
    const parsedIssue = parsed.issue.trim().toLowerCase();
    if (parsedIssue && itemIssue && parsedIssue === itemIssue) {
      matchCount++;
    }

    const itemPages = String(item.getField("pages") || "").trim().toLowerCase();
    const parsedPages = parsed.pages.trim().toLowerCase();
    if (parsedPages && itemPages && (parsedPages === itemPages || itemPages.includes(parsedPages))) {
      matchCount++;
    }

    return matchCount >= 2;
  }

  private static async isExactMatchCheck(record: AttachmentRecord, item: Zotero.Item): Promise<boolean> {
    const filenameFmrsId = extractFmrsIdFromFilename(record.filename);
    const itemExtra = String(item.getField("extra") || "");
    const itemIdentifiers = extractIdentifiersFromTexts([
      String(item.getField("DOI") || ""),
      String(item.getField("url") || ""),
      String(item.getField("title") || ""),
      String(item.getField("extra") || ""),
    ]);
    const itemPmid = itemIdentifiers.pmid;
    const itemDoi = normalizeDOI(itemIdentifiers.doi);

    // 1. Precise FMRS ID match
    if (filenameFmrsId) {
      const numericId = filenameFmrsId.slice(1);
      if (numericId && (itemExtra.includes(numericId) || (itemPmid && itemPmid.includes(numericId)))) {
        return true;
      }
    }

    // 2. Title line match for multiple papers in body
    if (filenameFmrsId && record.body) {
      const cleanBody = stripHtml(record.body);
      const lines = cleanBody.split(/\r?\n/);
      for (const line of lines) {
        if (line.toUpperCase().includes(filenameFmrsId.toUpperCase())) {
          let cleaned = line
            .replace(/\(?[PS]\d{6,12}\)?/i, "")
            .replace(/^\s*(?:\[?\d+\]?|\d+[\.)]|【\d+】)\s*/, "")
            .replace(/\[点击纠错\]|\[需要正式版\]|\[Need Fulltext\]/g, "")
            .trim();
          const itemTitle = String(item.getField("title") || "");
          if (itemTitle && cleaned && titleMatches(itemTitle, cleaned)) {
            return true;
          }
          break;
        }
      }
    }

    // Fallback matching logic
    const parsed = parseLiteratureReply(record);
    const recordIdentifiers = extractIdentifiersFromTexts([
      parsed.identifier,
      parsed.title,
      record.subject,
      record.filename,
      record.body || "",
    ]);
    const recordFmrsId = extractFmrsIdFromTexts([
      parsed.identifier,
      record.subject,
      record.filename,
      record.body || "",
    ]);

    if (recordFmrsId) {
      const numericId = recordFmrsId.slice(1);
      if (numericId && (itemExtra.includes(numericId) || (itemPmid && itemPmid.includes(numericId)))) {
        return true;
      }
    }

    if (recordFmrsId && itemPmid) {
      const pmidMatch = recordFmrsId === `P${itemPmid}` || recordFmrsId === `S${itemPmid}`;
      if (pmidMatch) {
        return true;
      }
    }

    if (
      recordIdentifiers.doi &&
      itemDoi &&
      normalizeDOI(recordIdentifiers.doi) === itemDoi
    ) {
      return true;
    }

    if (
      recordIdentifiers.pmid &&
      itemPmid &&
      recordIdentifiers.pmid === itemPmid
    ) {
      return true;
    }

    return false;
  }

  private static async confirmMatch(record: AttachmentRecord, item: Zotero.Item): Promise<boolean> {
    const matchMode = String(getPref("agentMailMatchMode") || "auto");
    if (matchMode === "auto") {
      return true;
    }

    try {
      const win = Zotero.getMainWindow();
      if (!win) {
        return true;
      }
      
      const title = getString("pref-mail-match-confirm");
      const message = getString("pref-mail-match-confirm-message", {
        args: {
          subject: record.subject,
          title: item.getField("title") || item.getDisplayTitle() || "Untitled",
        },
      });
      
      return win.confirm(`${title}\n\n${message}`);
    } catch (e) {
      ztoolkit.log(`[FMRS] failed to show confirm dialog: ${e}`);
      return true;
    }
  }

  private static getCliCommand() {
    return this.getConfiguredCliPath() || this.getSuggestedCliPath();
  }

  private static pathJoin(...parts: string[]) {
    return parts
      .filter(Boolean)
      .join(Zotero.isWin ? "\\" : "/")
      .replace(Zotero.isWin ? /\\+/g : /\/+/g, Zotero.isWin ? "\\" : "/");
  }

  private static isAbsolutePath(path: string) {
    return Zotero.isWin ? /^[a-z]:[\\/]/i.test(path) : path.startsWith("/");
  }

  private static async ensureWorkdir() {
    const dir = this.pathJoin(Zotero.getTempDirectory().path, "fmrs-agent-mail");
    await Zotero.File.createDirectoryIfMissingAsync(dir);
    return dir;
  }

  private static async runPop3Json(mode: "status" | "poll") {
    const workdir = await this.ensureWorkdir();
    const outputDir = this.pathJoin(workdir, "pop3-downloads");
    await Zotero.File.createDirectoryIfMissingAsync(outputDir);
    const scriptPath = this.pathJoin(workdir, "fmrs-pop3-163.ps1");
    await Zotero.File.putContentsAsync(scriptPath, POP3_SCRIPT, "utf-8");

    const result = await this.runPowerShell(scriptPath, [
      "-Mode",
      mode,
      "-User",
      this.pop3Username,
      "-Pass",
      this.pop3Password,
      "-Server",
      this.pop3Host,
      "-Port",
      String(this.pop3Port),
      "-UseSsl",
      this.pop3UseSSL ? "true" : "false",
      "-Limit",
      String(this.pollLimit),
      "-OutputDir",
      outputDir,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `pop3-exit-${result.exitCode}`);
    }
    const text = result.stdout.trim();
    if (!text) {
      return {} as Pop3Response;
    }
    try {
      const logPath = this.pathJoin(workdir, "failed-pop3-response.json");
      await Zotero.File.putContentsAsync(logPath, text, "utf-8");
      return JSON.parse(text) as Pop3Response;
    } catch (error) {
      ztoolkit.log(`[FMRS] POP3 JSON parse failed. Length: ${text.length}. Error: ${error}`);
      ztoolkit.log(`[FMRS] POP3 Raw Text (first 500): ${text.slice(0, 500)}`);
      ztoolkit.log(`[FMRS] POP3 Raw Text (last 500): ${text.slice(-500)}`);
      throw new Error(`JSON解析错误: ${String(error).replace(/SyntaxError:\s*/i, "")}`);
    }
  }

  private static getPowerShellPath() {
    if (!Zotero.isWin) {
      return "pwsh";
    }
    let windir = "C:\\Windows";
    try {
      const env = Components.classes["@mozilla.org/process/environment;1"]
        .getService(Components.interfaces.nsIEnvironment);
      windir = env.get("SystemRoot") || env.get("windir") || "C:\\Windows";
    } catch (e) {
      // fallback
    }
    return `${windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  }

  private static getShellPath() {
    if (!Zotero.isWin) {
      return "/bin/sh";
    }
    let windir = "C:\\Windows";
    try {
      const env = Components.classes["@mozilla.org/process/environment;1"]
        .getService(Components.interfaces.nsIEnvironment);
      windir = env.get("SystemRoot") || env.get("windir") || "C:\\Windows";
    } catch (e) {
      // fallback
    }
    return `${windir}\\System32\\cmd.exe`;
  }

  private static async readEntireStream(pipe: any): Promise<string> {
    if (!pipe) {
      return "";
    }
    let result = "";
    while (true) {
      const chunk = await pipe.readString();
      if (chunk === null || chunk === undefined || chunk === "") {
        break;
      }
      result += chunk;
    }
    return result;
  }

  private static async runPowerShell(scriptPath: string, args: string[]) {
    const { Subprocess } = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ) as any;
    const powershell = this.getPowerShellPath();
    const proc = await Subprocess.call({
      command: powershell,
      arguments: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        ...args,
      ],
      workdir: await this.ensureWorkdir(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, status] = await Promise.all([
      this.readEntireStream(proc.stdout),
      this.readEntireStream(proc.stderr),
      proc.wait(),
    ]);

    return {
      exitCode: Number(status?.exitCode ?? 0),
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
    };
  }

  private static async runCliJson(args: string[], workdir?: string) {
    const cwd = workdir || (await this.ensureWorkdir());
    const command = args.map((value) => quoteArg(value)).join(" ");
    const result = await this.runShell(command, cwd);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || result.stdout || `agently-cli-exit-${result.exitCode}`,
      );
    }
    const text = result.stdout.trim();
    if (!text) {
      return {};
    }
    return JSON.parse(text);
  }

  private static async runShell(command: string, workdir: string) {
    const { Subprocess } = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ) as any;
    const shellPath = this.getShellPath();
    const shellArgs = Zotero.isWin
      ? ["/d", "/s", "/c", command]
      : ["-lc", command];

    const proc = await Subprocess.call({
      command: shellPath,
      arguments: shellArgs,
      workdir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, status] = await Promise.all([
      this.readEntireStream(proc.stdout),
      this.readEntireStream(proc.stderr),
      proc.wait(),
    ]);

    return {
      exitCode: Number(status?.exitCode ?? 0),
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
    };
  }
}


function parseLiteratureReply(record: AttachmentRecord) {
  const body = stripHtml(String(record.body || ""));
  const subject = cleanReplySubject(record.subject);
  return {
    identifier: readLabeledValue(body, [
      "全文ID号",
      "全文ID",
      "DOI",
      "doi",
      "Identifier",
    ]),
    title: readLabeledValue(body, ["标题", "題名", "Title", "title"]) || subject,
    author: readLabeledValue(body, ["作者", "Author", "Authors"]),
    journal: readLabeledValue(body, ["刊名", "期刊", "Journal", "journal"]),
    year: readLabeledValue(body, ["出版年", "年份", "Year", "year"]),
    volume: readLabeledValue(body, ["卷", "Volume", "volume"]),
    issue: readLabeledValue(body, ["期", "Issue", "issue"]),
    pages: readLabeledValue(body, ["页码", "頁碼", "Pages", "pages"]),
  };
}

function cleanReplySubject(subject: string) {
  return String(subject || "")
    .replace(/^(成功回复|回复|回覆|答复|Re|FW|Fwd|文献传递|原文传递|系统成功回复)\s*[:：\-\s]\s*/i, "")
    .trim();
}

function readLabeledValue(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `[【\\[]\\s*${escaped}\\s*[】\\]]\\s*[:：]?\\s*([^\\r\\n]+)`,
      "i",
    );
    const bracketed = text.match(pattern);
    if (bracketed?.[1]) {
      return cleanMailValue(bracketed[1]);
    }

    const plain = text.match(
      new RegExp(`^\\s*${escaped}\\s*(?:[:：|]\\s*|\\s+)([^\\r\\n]+)`, "im"),
    );
    if (plain?.[1]) {
      return cleanMailValue(plain[1]);
    }
  }
  return "";
}

function cleanMailValue(value: string) {
  return value
    .replace(/^\s*[：:]\s*/, "")
    .replace(/[;；,，。]+$/g, "")
    .replace(/^\["?|"?\]$/g, "")
    .replace(/^\["?|"?;?\]$/g, "")
    .trim();
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r\n/g, "\n");
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function matchesSenderFilter(email: string, filter: string): boolean {
  if (!filter) return true;
  const parts = filter
    .split(/[,，;；]/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return true;

  const emailLower = email.trim().toLowerCase();
  return parts.some((part) => {
    if (part.startsWith("@")) {
      return emailLower.endsWith(part);
    }
    if (emailLower === part) {
      return true;
    }
    if (part.includes(".") && !part.includes("@")) {
      return emailLower.endsWith("@" + part) || emailLower.endsWith("." + part);
    }
    return emailLower.includes(part);
  });
}

function isLiteratureEmail(
  fromEmail: string,
  subject: string,
  senderFilter: string,
): boolean {
  const emailLower = fromEmail.trim().toLowerCase();

  if (senderFilter && !matchesSenderFilter(emailLower, senderFilter)) {
    return false;
  }

  const isTrustedDomain =
    emailLower.endsWith("@ivqqiv.com") || emailLower.endsWith("@clas.ac.cn");
  if (isTrustedDomain) {
    return true;
  }

  const subjectLower = subject.trim().toLowerCase();
  const pattern = /^(成功回复|成功回覆|成功答复|文献传递|原文传递|系统成功回复)\s*[:：\-]?\s*/i;
  if (pattern.test(subjectLower)) {
    return true;
  }

  return false;
}


function extractFmrsIdFromFilename(filename: string): string {
  if (!filename) return "";
  const match = filename.match(/(?:^|[^A-Za-z0-9])([PS]\d{6,12})(?:[^0-9]|$)/i);
  return match ? match[1].toUpperCase() : "";
}

function extractFmrsIdFromTexts(values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (!value) continue;
    const match = value.match(/\b([PS]\d{6,12})(?=\b|_|[^0-9]|$)/i);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return "";
}

function getTitlePrefix(text: string, maxWords = 8): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) {
    return text;
  }
  return words.slice(0, maxWords).join(" ");
}


function getSafeSearchTitle(title: string): string {
  if (!title) return "";
  
  let cleaned = title
    .replace(/<[^>]*>/g, "")
    .replace(/[【】\[\]\(\):：.,，。;；"'\-\?？\!！]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const hasChinese = /[\u4e00-\u9fa5]/.test(cleaned);
  if (hasChinese) {
    return cleaned.slice(0, 10).trim();
  }

  const words = cleaned.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length > 5) {
    return words.slice(0, 5).join(" ");
  }
  return cleaned;
}


function normalizeDOI(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLooseIdentifier(value?: string) {
  return normalizeDOI(value).replace(/[^a-z0-9]+/g, "");
}

function containsLoosePMID(text: string, pmid: string) {
  if (!pmid) {
    return false;
  }
  const escaped = pmid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\D)${escaped}(\\D|$)`).test(text);
}

function quoteArg(value: string) {
  if (Zotero.isWin) {
    const escaped = value.replace(/"/g, '""');
    return /[\s"]/g.test(value) ? `"${escaped}"` : value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const POP3_SCRIPT = String.raw`
param(
  [string]$Mode = "poll",
  [string]$User,
  [string]$Pass,
  [string]$Server = "pop.163.com",
  [int]$Port = 995,
  [string]$UseSsl = "true",
  [int]$Limit = 10,
  [string]$OutputDir
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Escape-Unicode($str) {
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $str.Length; $i++) {
    $c = $str[$i]
    $val = [int]$c
    if ($val -gt 127) {
      $sb.Append([string]::Format("\u{0:x4}", $val)) | Out-Null
    } else {
      $sb.Append($c) | Out-Null
    }
  }
  return $sb.ToString()
}

function Write-Json($obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  Write-Output (Escape-Unicode $json)
}

function Read-PopLine($reader) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { throw "POP3 connection closed" }
  return $line
}

function Send-Pop($writer, $reader, $cmd) {
  $writer.WriteLine($cmd)
  $line = Read-PopLine $reader
  if (-not $line.StartsWith("+OK")) { throw $line }
  return $line
}

function Read-Multi($reader) {
  $lines = New-Object System.Collections.Generic.List[string]
  while ($true) {
    $line = Read-PopLine $reader
    if ($line -eq ".") { break }
    if ($line.StartsWith("..")) { $line = $line.Substring(1) }
    $lines.Add($line)
  }
  return [string]::Join(([string][char]13 + [string][char]10), $lines.ToArray())
}

function Decode-Header($value) {
  if (-not $value) { return "" }
  
  $hasRawBytes = $false
  for ($i = 0; $i -lt $value.Length; $i++) {
    $code = [int][char]$value[$i]
    if ($code -ge 128 -and $code -le 255) {
      $hasRawBytes = $true
      break
    }
  }

  $workingValue = $value
  if ($hasRawBytes) {
    try {
      $rawBytes = [System.Text.Encoding]::GetEncoding("iso-8859-1").GetBytes($value)
      $utf8Str = [System.Text.Encoding]::UTF8.GetString($rawBytes)
      if ($utf8Str -match "\ufffd") {
        $workingValue = [System.Text.Encoding]::GetEncoding("gbk").GetString($rawBytes)
      } else {
        $workingValue = $utf8Str
      }
    } catch {}
  }

  return [regex]::Replace($workingValue, '=\?([^?]+)\?([bBqQ])\?([^?]+)\?=', {
    param($m)
    $charset = $m.Groups[1].Value
    $enc = $m.Groups[2].Value.ToUpperInvariant()
    $data = $m.Groups[3].Value
    try {
      if ($enc -eq "B") {
        $bytes = [Convert]::FromBase64String($data)
      } else {
        $q = $data.Replace("_", " ")
        $bytesList = New-Object System.Collections.Generic.List[byte]
        for ($i = 0; $i -lt $q.Length; $i++) {
          if ($q[$i] -eq '=' -and $i + 2 -lt $q.Length) {
            $bytesList.Add([Convert]::ToByte($q.Substring($i + 1, 2), 16))
            $i += 2
          } else {
            $bytesList.Add([byte][char]$q[$i])
          }
        }
        $bytes = $bytesList.ToArray()
      }
      return [System.Text.Encoding]::GetEncoding($charset).GetString($bytes)
    } catch {
      return $m.Value
    }
  })
}

function Decode-BodyText($body, $encoding, $charset) {
  try {
    $bytes = $null
    if ($encoding -match "base64") {
      $bytes = [Convert]::FromBase64String(($body -replace "\s+", ""))
    } elseif ($encoding -match "quoted-printable") {
      $q = $body -replace "=\r?\n", ""
      $bytesList = New-Object System.Collections.Generic.List[byte]
      for ($i = 0; $i -lt $q.Length; $i++) {
        if ($q[$i] -eq '=' -and $i + 2 -lt $q.Length -and $q.Substring($i + 1, 2) -match '^[0-9A-Fa-f]{2}$') {
          $bytesList.Add([Convert]::ToByte($q.Substring($i + 1, 2), 16))
          $i += 2
        } else {
          $bytesList.Add([byte][char]$q[$i])
        }
      }
      $bytes = $bytesList.ToArray()
    } else {
      $bytes = [System.Text.Encoding]::GetEncoding("iso-8859-1").GetBytes($body)
    }
    if (-not $charset) { $charset = "utf-8" }
    return [System.Text.Encoding]::GetEncoding($charset).GetString($bytes)
  } catch {
    return $body
  }
}

function Split-Headers($raw) {
  $m = [regex]::Match($raw, "(?s)^(.*?)(?:\r?\n\r?\n)(.*)$")
  if (-not $m.Success) { return @(@{}, $raw) }
  $headerText = $m.Groups[1].Value -replace "\r?\n[\t ]+", " "
  $body = $m.Groups[2].Value
  $headers = @{}
  foreach ($line in ($headerText -split "\r?\n")) {
    $idx = $line.IndexOf(":")
    if ($idx -gt 0) {
      $name = $line.Substring(0, $idx).Trim().ToLowerInvariant()
      $val = $line.Substring($idx + 1).Trim()
      if ($headers.ContainsKey($name)) { $headers[$name] = $headers[$name] + "; " + $val } else { $headers[$name] = $val }
    }
  }
  return @($headers, $body)
}

function Get-Param($header, $name) {
  if (-not $header) { return "" }
  $escaped = [regex]::Escape($name)
  $m = [regex]::Match($header, $escaped + '\*?\s*=\s*"?([^";]+)"?', 'IgnoreCase')
  if ($m.Success) {
    $v = $m.Groups[1].Value
    $v = $v -replace "^utf-8''", ""
    try { $v = [System.Uri]::UnescapeDataString($v) } catch {}
    return Decode-Header $v
  }
  return ""
}

function Save-Part($headers, $body, $subject, $sender, $date, $messageId, $bodyRef, $records) {
  $ct = "" + $headers["content-type"]
  $cd = "" + $headers["content-disposition"]
  $cte = ("" + $headers["content-transfer-encoding"]).ToLowerInvariant()
  $charset = Get-Param $ct "charset"
  $filename = Get-Param $cd "filename"
  if (-not $filename) { $filename = Get-Param $ct "name" }

  if ($ct -match "multipart/") {
    $boundary = Get-Param $ct "boundary"
    if ($boundary) {
      $escaped = [regex]::Escape("--" + $boundary)
      $parts = [regex]::Split($body, "(?m)^" + $escaped + "(?:--)?\s*$")
      foreach ($part in $parts) {
        if ($part.Trim()) {
          $split = Split-Headers $part.Trim()
          Save-Part $split[0] $split[1] $subject $sender $date $messageId $bodyRef $records
        }
      }
    }
    return
  }

  if (-not $filename -and $ct -match "text/plain") {
    $text = Decode-BodyText $body $cte $charset
    if ($text) { $bodyRef.Value = ($bodyRef.Value + ([string][char]10) + $text).Trim() }
    return
  }

  if ($filename -and (($filename -match "\.pdf$") -or ($ct -match "application/pdf"))) {
    if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }
    $safe = ($filename -replace '[\\/:*?"<>|]+', '_')
    $path = Join-Path $OutputDir ((Get-Date -Format "yyyyMMddHHmmssfff") + "-" + $safe)
    try {
      if ($cte -match "base64") {
        $bytes = [Convert]::FromBase64String(($body -replace "\s+", ""))
      } else {
        $bytes = [System.Text.Encoding]::GetEncoding("iso-8859-1").GetBytes($body)
      }
      [System.IO.File]::WriteAllBytes($path, $bytes)
      $records.Add([pscustomobject]@{
        messageId = $messageId
        filename = $filename
        subject = $subject
        senderEmail = $sender
        createdAt = $date
        body = $bodyRef.Value
        contentType = $(if ($ct) { $ct } else { "application/pdf" })
        savedTo = $path
      }) | Out-Null
    } catch {}
  }
}

$client = New-Object System.Net.Sockets.TcpClient
$client.Connect($Server, $Port)
$netStream = $client.GetStream()
if ($UseSsl -eq "true") {
  $sslStream = New-Object System.Net.Security.SslStream($netStream, $false, ({ $true }))
  $sslStream.AuthenticateAsClient($Server)
  $stream = $sslStream
} else {
  $stream = $netStream
}
$reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::GetEncoding("iso-8859-1"))
$writer = New-Object System.IO.StreamWriter($stream, [System.Text.Encoding]::ASCII)
$writer.NewLine = ([string][char]13 + [string][char]10)
$writer.AutoFlush = $true

try {
  Read-PopLine $reader | Out-Null
  Send-Pop $writer $reader ("USER " + $User) | Out-Null
  Send-Pop $writer $reader ("PASS " + $Pass) | Out-Null
  $stat = Send-Pop $writer $reader "STAT"
  $count = 0
  if ($stat -match '^\+OK\s+(\d+)') { $count = [int]$matches[1] }
  if ($Mode -eq "status") {
    Send-Pop $writer $reader "QUIT" | Out-Null
    Write-Json @{ ok = $true; email = $User; count = $count }
    exit 0
  }

  $records = New-Object System.Collections.Generic.List[object]
  if ($count -gt 0) {
    $start = [Math]::Max(1, $count - $Limit + 1)
    for ($i = $count; $i -ge $start; $i--) {
      $uidLine = Send-Pop $writer $reader ("UIDL " + $i)
      $uid = "msg-" + $i
      if ($uidLine -match '^\+OK\s+\d+\s+(\S+)') { $uid = $matches[1] }
      Send-Pop $writer $reader ("RETR " + $i) | Out-Null
      $raw = Read-Multi $reader
      $split = Split-Headers $raw
      $headers = $split[0]
      $body = $split[1]
      $subject = Decode-Header ("" + $headers["subject"])
      $from = Decode-Header ("" + $headers["from"])
      $sender = ""
      if ($from -match '<([^>]+)>') { $sender = $matches[1].Trim().ToLowerInvariant() } else { $sender = $from.Trim().ToLowerInvariant() }
      $date = "" + $headers["date"]
      $bodyRef = [pscustomobject]@{ Value = "" }
      Save-Part $headers $body $subject $sender $date $uid $bodyRef $records
    }
  }
  Send-Pop $writer $reader "QUIT" | Out-Null
  Write-Json @{ ok = $true; email = $User; count = $count; data = @($records.ToArray()) }
} finally {
  $reader.Close()
  $writer.Close()
  $client.Close()
}
`;
