import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  AgentMailBridge,
  AttachmentRecord,
  PollSummary,
} from "./AgentMailBridge";
import { extractIdentifiersFromTexts } from "./Identifiers";
import { showNotice } from "./Notifications";
import { FmrsArticle, FmrsClient } from "./FmrsClient";

const FMRS_LOGIN_ORIGIN = "https://www.metstr.com/";
const FMRS_SEARCH_ORIGIN = "https://newfmrs.metstr.com/";
const FMRS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FALLBACK_AGENT_MAIL = "";
const FMRS_COOKIE_HOSTS = [
  ".metstr.com",
  "www.metstr.com",
  ".newfmrs.metstr.com",
  "newfmrs.metstr.com",
  ".openapi.metstr.com",
  "openapi.metstr.com",
] as const;

type FetchMode = "download" | "request";

type CookieInfo = {
  name: string;
  value: string;
  host: string;
  path: string;
};

interface EmbeddedLoginSnapshot {
  uid: string;
  token: string;
  accessMode: string;
  cookies: CookieInfo[];
}

interface BrowserLoginDialogData {
  browser?: XULBrowserElement;
  statusText?: string;
  pollTimer?: number;
  checking?: boolean;
  captured?: boolean;
  unloadCallback?: () => void;
}

interface CookieQICookie {
  QueryInterface?(iid: any): nsICookie;
  name: string;
  value: string;
  host: string;
  path: string;
}

interface CookieSandboxConstructor {
  new (
    browser: unknown,
    uri: string | URL,
    cookieData: string,
    userAgent: string,
  ): any;
}

interface FmrsSession {
  client: FmrsClient;
  verify: Awaited<ReturnType<FmrsClient["verify"]>>;
  email: string;
}

export interface FmrsDownloadResult {
  attached: boolean;
  requested: boolean;
  skipped: boolean;
  reason?: string;
}

declare const Services: JSServices;

function getServices() {
  return typeof Services === "undefined"
    ? (ztoolkit.getGlobal("Services") as JSServices)
    : Services;
}

function getComponents() {
  return typeof Components === "undefined"
    ? (ztoolkit.getGlobal("Components") as typeof Components)
    : Components;
}

function getCookieSandbox() {
  return (Zotero as any).CookieSandbox as CookieSandboxConstructor;
}

function createURI(spec: string) {
  return getServices().io.newURI(spec);
}

function systemPrincipal() {
  return getServices().scriptSecurityManager.getSystemPrincipal();
}

export class FmrsFetcher {
  static notify = showNotice;

  static async createSession(options: { notify?: boolean } = {}) {
    const client = FmrsClient.fromPrefs();
    const verify = await client.verify();
    if (!verify.ok) {
      if (options.notify !== false) {
        const message =
          verify.message === "missing-token"
            ? getString("popwin-no-token")
            : verify.message;
        this.notify(getString("popwin-no-token"), message, "fail");
      }
      return null;
    }

    const email =
      (await this.resolveRequestEmail(client, verify.email)) ||
      client.settings.defaultEmail ||
      String(getPref("defaultEmail") || "") ||
      "";

    return {
      client,
      verify,
      email,
    } as FmrsSession;
  }

  static async tryDownloadItemWithSession(
    session: FmrsSession,
    item: Zotero.Item,
    options: {
      notify?: boolean;
      allowRequestFallback?: boolean;
      skipIfExists?: boolean;
    } = {},
  ): Promise<FmrsDownloadResult> {
    const notify = options.notify !== false;
    const skipIfExists = options.skipIfExists !== false;

    if (!item.isRegularItem()) {
      return {
        attached: false,
        requested: false,
        skipped: true,
        reason: "not-regular-item",
      };
    }

    const itemTitle =
      item.getDisplayTitle() || String(item.getField("title") || "");
    const identifiers = this.extractIdentifiers(item);
    if (!identifiers.pmid && !identifiers.doi) {
      if (notify) {
        this.notify(getString("popwin-noidentifier"), itemTitle, "fail");
      }
      return {
        attached: false,
        requested: false,
        skipped: true,
        reason: "missing-identifier",
      };
    }

    const article = await session.client.resolveArticleByIdentifier(identifiers);
    if (!article?.id) {
      if (notify) {
        this.notify(getString("popwin-authfail"), itemTitle, "fail");
      }
      return {
        attached: false,
        requested: false,
        skipped: false,
        reason: "article-not-found",
      };
    }

    const fmrsTitle = String(article.ti || itemTitle || "FMRS item");
    const bestAttachment = await item.getBestAttachment();
    if (skipIfExists && bestAttachment && bestAttachment.isPDFAttachment()) {
      return {
        attached: false,
        requested: false,
        skipped: true,
        reason: "already-has-pdf",
      };
    }

    if (notify) {
      this.notify(getString("popwin-fetching"), fmrsTitle);
    }

    const channels = await session.client.getDownloadChannels(article.id);
    for (const channel of channels) {
      const pdfUrl = await session.client.resolvePdfUrl(channel.url);
      if (!pdfUrl) {
        continue;
      }
      try {
        await this.attachPdfFromUrl(pdfUrl, item, fmrsTitle);
        if (notify) {
          this.notify(getString("popwin-success"), fmrsTitle, "success");
        }
        return { attached: true, requested: false, skipped: false };
      } catch (error) {
        ztoolkit.log(`[FMRS] attach failed for ${pdfUrl}: ${error}`);
      }
    }

    if (options.allowRequestFallback) {
      const ok = await this.submitRequest(
        session.client,
        article,
        fmrsTitle,
        session.email,
      );
      if (ok) {
        if (notify) {
          this.notify(
            getString("popwin-fallback-requested"),
            fmrsTitle,
            "success",
          );
        }
        return { attached: false, requested: true, skipped: false };
      }
    }

    if (notify) {
      this.notify(getString("popwin-download-failed"), fmrsTitle, "fail");
    }
    return {
      attached: false,
      requested: false,
      skipped: false,
      reason: "download-failed",
    };
  }

  static async downloadOrRequest(items: Zotero.Item[], mode: FetchMode) {
    const session = await this.createSession({ notify: true });
    if (!session) {
      return;
    }

    for (const item of items) {
      try {
        if (!item.isRegularItem()) {
          continue;
        }

        const itemTitle =
          item.getDisplayTitle() || String(item.getField("title") || "");
        const identifiers = this.extractIdentifiers(item);
        if (!identifiers.pmid && !identifiers.doi) {
          this.notify(getString("popwin-noidentifier"), itemTitle, "fail");
          continue;
        }

        if (mode === "request") {
          const article = await session.client.resolveArticleByIdentifier(identifiers);
          if (!article?.id) {
            this.notify(getString("popwin-authfail"), itemTitle, "fail");
            continue;
          }
          const fmrsTitle = String(article.ti || itemTitle || "FMRS item");
          await this.submitRequest(session.client, article, fmrsTitle, session.email);
          continue;
        }

        await this.tryDownloadItemWithSession(session, item, {
          notify: true,
          allowRequestFallback: Boolean(getPref("autoRequestFullText")),
          skipIfExists: true,
        });
      } catch (error) {
        this.notify(getString("popwin-authfail"), String(error), "fail");
      }
    }
  }

  static async openLoginHelper() {
    const dialogData: BrowserLoginDialogData = {
      statusText: getString("login-helper-status-browser-missing"),
      checking: false,
      captured: false,
    };
    dialogData.unloadCallback = () => {
      this.stopLoginPolling(dialogData);
      dialogData.browser = undefined;
    };

    const dialog = new ztoolkit.Dialog(1, 1)
      .setDialogData(dialogData)
      .addCell(0, 0, {
        tag: "vbox",
        styles: {
          padding: "12px",
          gap: "10px",
          width: "860px",
          height: "620px",
        },
        children: [
          {
            tag: "description",
            properties: {
              textContent: getString("login-helper-intro"),
            },
          },
          {
            tag: "description",
            properties: {
              textContent: getString("login-helper-cookie-note"),
            },
          },
          {
            tag: "description",
            properties: {
              textContent:
                "Zotero 9 下内嵌浏览器可能无法显示微信二维码。建议点击“打开 FMRS 登录页”，用外部浏览器完成扫码登录；插件会继续尝试从 Zotero 可见 Cookie 中检测登录态。",
            },
          },
          {
            tag: "browser",
            id: "fmrs-login-browser",
            attributes: {
              flex: 1,
              type: "content",
              disableglobalhistory: true,
            },
            listeners: [
              {
                type: "DOMContentLoaded",
                listener: async () => {
                  const browser = dialogData.browser;
                  if (!browser) {
                    return;
                  }
                  await this.handleBrowserLoginProgress(browser, dialog.window, dialogData);
                },
              },
            ],
          },
          {
            tag: "description",
            attributes: {
              "data-bind": "statusText",
              "data-prop": "textContent",
            },
            properties: {
              textContent: dialogData.statusText,
            },
          },
        ],
      })
      .addButton(getString("login-helper-open-login"), "open-login", {
        noClose: true,
        callback: () => {
          Zotero.launchURL(FMRS_LOGIN_ORIGIN);
          if (dialogData.browser?.webNavigation) {
            dialogData.browser.webNavigation.loadURI(
              createURI(FMRS_LOGIN_ORIGIN),
              {
                triggeringPrincipal: systemPrincipal(),
              },
            );
          }
        },
      })
      .addButton(getString("login-helper-open-qr"), "open-qr", {
        noClose: true,
        callback: () => {
          Zotero.launchURL(FMRS_SEARCH_ORIGIN);
          if (dialogData.browser?.webNavigation) {
            dialogData.browser.webNavigation.loadURI(
              createURI(FMRS_SEARCH_ORIGIN),
              {
                triggeringPrincipal: systemPrincipal(),
              },
            );
          }
        },
      })
      .addButton(
        getString("login-helper-copy-cookie-steps"),
        "copy-cookie-steps",
        {
          noClose: true,
          callback: () => {
            Zotero.Utilities.Internal.copyTextToClipboard(
              [
                "1. 在嵌入浏览器或外部浏览器完成微信扫码登录",
                "2. 插件会自动轮询 Cookie 抓取会话；如需要也可手动点击“重新检测登录态”",
                "3. 一旦检测到会话，插件会自动写回 UID / Token / accessMode",
                "4. 如果内嵌浏览器不工作，请改用外部浏览器登录，再回到插件窗口等待自动捕获",
              ].join("\n"),
            );
            this.notify(
              "FMRS",
              getString("login-helper-steps-copied"),
              "success",
            );
          },
        },
      )
      .addButton(
        getString("login-helper-refresh-detect"),
        "refresh-detect",
        {
          noClose: true,
          callback: async () => {
            await this.maybePollBrowserSession(dialogData, dialog.window);
          },
        },
      )
      .addButton(getString("login-helper-close"), "close")
      .open("FMRS Login", {
        fitContent: false,
        width: 920,
        height: 760,
        centerscreen: true,
        resizable: true,
      });

    const browser = dialog.window.document.querySelector(
      "#fmrs-login-browser",
    ) as XULBrowserElement | null;
    if (browser?.webNavigation) {
      dialogData.browser = browser;
      browser.webNavigation.loadURI(createURI(FMRS_LOGIN_ORIGIN), {
        triggeringPrincipal: systemPrincipal(),
      });
      this.startLoginPolling(dialogData, dialog.window);
    } else {
      dialogData.statusText = getString("login-helper-status-browser-missing");
      this.refreshDialogStatus(dialog.window, dialogData.statusText);
    }
  }

  private static startLoginPolling(
    dialogData: BrowserLoginDialogData,
    win: Window,
  ) {
    this.stopLoginPolling(dialogData);
    dialogData.pollTimer = Zotero.setTimeout(async () => {
      if (!addon.data.alive || dialogData.captured) {
        this.stopLoginPolling(dialogData);
        return;
      }
      await this.maybePollBrowserSession(dialogData, win);
      if (!dialogData.captured) {
        this.startLoginPolling(dialogData, win);
      }
    }, 3000);
  }

  private static stopLoginPolling(dialogData: BrowserLoginDialogData) {
    if (dialogData.pollTimer) {
      Zotero.clearTimeout(dialogData.pollTimer);
      dialogData.pollTimer = undefined;
    }
  }

  private static async maybePollBrowserSession(
    dialogData: BrowserLoginDialogData,
    win: Window,
  ) {
    if (dialogData.checking || dialogData.captured || !dialogData.browser) {
      return;
    }
    dialogData.checking = true;
    try {
      const ok = await this.tryCaptureEmbeddedLogin(dialogData.browser, win);
      if (ok) {
        dialogData.captured = true;
        this.stopLoginPolling(dialogData);
      }
    } finally {
      dialogData.checking = false;
    }
  }

  private static async handleBrowserLoginProgress(
    browser: XULBrowserElement,
    win: Window,
    dialogData: BrowserLoginDialogData,
  ) {
    try {
      const current = browser.currentURI?.spec || "";
      if (!current) {
        return;
      }

      if (/metstr\.com/i.test(current)) {
        await this.maybePollBrowserSession(dialogData, win);
      }
    } catch (error) {
      ztoolkit.log(`[FMRS] embedded login progress error: ${error}`);
    }
  }

  private static refreshDialogStatus(win: Window, status: string) {
    const text = win.document.querySelector(
      "*[data-bind='statusText']",
    ) as HTMLElement | null;
    if (text) {
      text.textContent = status;
    }
  }

  private static async tryCaptureEmbeddedLogin(
    browser: XULBrowserElement,
    win?: Window,
  ) {
    const snapshot = await this.captureSessionFromCookies(
      browser.currentURI?.spec || FMRS_SEARCH_ORIGIN,
    );
    if (!snapshot?.token) {
      return false;
    }

    const client = FmrsClient.fromPrefs();
    client.saveSession({
      uid: snapshot.uid,
      token: snapshot.token,
      accessMode: snapshot.accessMode,
    });

    const email = await this.resolveRequestEmail(client, "");
    if (email) {
      setPref("defaultEmail", email);
    }

    const verify = await FmrsClient.fromPrefs().verify().catch(() => null);
    const status = verify?.ok
      ? getString("login-helper-status-captured")
      : getString("login-helper-status-captured-partial");

    const targetWindow = win || (browser.ownerGlobal as Window);
    this.refreshDialogStatus(targetWindow, status);
    this.notify("FMRS", status, verify?.ok ? "success" : "default");
    return true;
  }

  private static async captureSessionFromCookies(
    origin: string,
  ): Promise<EmbeddedLoginSnapshot | null> {
    const cookies = collectCookies(FMRS_COOKIE_HOSTS);
    const token =
      pickCookieValue(cookies, [
        "token",
        "loginToken",
        "Authorization",
        "authorization",
      ]) || "";
    const uid =
      pickCookieValue(cookies, ["uid", "userId", "id", "fmrs_uid"]) ||
      "";
    const accessMode =
      pickCookieValue(cookies, ["accessMode", "access_mode"]) || "1";

    if (!token) {
      return null;
    }

    const normalizedUid = /^\d+$/.test(uid)
      ? uid
      : await this.resolveUidFromToken(token, accessMode, origin, cookies);
    if (!normalizedUid) {
      return null;
    }

    return {
      uid: normalizedUid,
      token,
      accessMode,
      cookies,
    };
  }

  private static async resolveUidFromToken(
    token: string,
    accessMode: string,
    origin: string,
    cookies: CookieInfo[],
  ) {
    const sandbox = buildCookieSandbox(origin, cookies);
    const client = new FmrsClient({
      token,
      uid: "0",
      accessMode,
    });
    try {
      const self = await client.selfDetailFromToken(token, accessMode, sandbox);
      const candidate = String(self?.id || self?.uid || "").trim();
      if (/^\d+$/.test(candidate)) {
        return candidate;
      }
    } catch (error) {
      ztoolkit.log(`[FMRS] resolve uid from token failed: ${error}`);
    }
    return "";
  }

  private static async resolveRequestEmail(
    client: FmrsClient,
    preferred?: string,
  ) {
    const forcedDefault = "surehlin10@163.com";
    const candidate = String(preferred || "").trim();
    if (candidate) {
      return candidate;
    }

    const configured = String(getPref("defaultEmail") || "").trim();
    if (configured) {
      if (configured !== forcedDefault) {
        setPref("defaultEmail", forcedDefault);
      }
      return forcedDefault;
    }

    setPref("defaultEmail", forcedDefault);
    client.settings.defaultEmail = forcedDefault;
    return forcedDefault;
  }

  static async pollAgentMail(): Promise<PollSummary> {
    return AgentMailBridge.pollAndImport({
      findItemForRecord: async (record) => this.findItemForRecord(record),
      importAttachmentToItem: async (record, item) =>
        this.importAgentMailAttachment(record, item),
    });
  }

  static async findItemForRecord(record: AttachmentRecord) {
    const searchTerms = AgentMailBridge.getSearchTerms(record);
    const libraries = Zotero.Libraries.getAll().filter((library) =>
      Zotero.Libraries.isEditable(library.libraryID),
    );
    for (const library of libraries) {
      const seen = new Set<number>();
      const candidates: Zotero.Item[] = [];
      for (const term of searchTerms) {
        const search = new Zotero.Search({ libraryID: library.libraryID });
        search.addCondition("title", "contains", term);
        const ids = await search.search();
        const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
        for (const item of items) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            candidates.push(item);
          }
        }
      }
      const match = candidates.find((item) =>
        AgentMailBridge.matchesItem(record, item),
      );
      if (match) {
        return match;
      }
    }
    return null;
  }

  static async importAgentMailAttachment(
    record: AttachmentRecord,
    item: Zotero.Item,
  ) {
    const bestAttachment = await item.getBestAttachment();
    if (bestAttachment && bestAttachment.isPDFAttachment()) {
      return false;
    }
    const savedTo = await AgentMailBridge.downloadAttachment(record);
    await Zotero.Attachments.importFromFile({
      file: savedTo,
      libraryID: item.libraryID,
      parentItemID: item.id,
      title: record.subject || item.getDisplayTitle() || record.filename,
      contentType: record.contentType || "application/pdf",
    });
    this.notify(
      getString("popwin-mail-imported"),
      record.subject || record.filename,
      "success",
    );
    return true;
  }

  private static async submitRequest(
    client: FmrsClient,
    article: FmrsArticle,
    title: string,
    email: string,
  ) {
    const result = await client.requestFullText(article.id, email);
    if (result.ok) {
      this.notify(getString("popwin-email-sent"), title, "success");
      return true;
    }
    this.notify(
      result.message || getString("popwin-authfail"),
      title,
      "fail",
    );
    return false;
  }

  private static extractIdentifiers(item: Zotero.Item) {
    return extractIdentifiersFromTexts([
      String(item.getField("DOI") || ""),
      String(item.getField("url") || ""),
      String(item.getField("title") || ""),
      String(item.getField("extra") || ""),
    ]);
  }

  private static async attachPdfFromUrl(
    pdfUrl: string,
    item: Zotero.Item,
    title: string,
  ) {
    const fileBaseName = sanitizeFilename(
      title || String(item.getField("title") || "") || "fmrs-paper",
    );
    await Zotero.Attachments.importFromURL({
      libraryID: item.libraryID,
      parentItemID: item.id,
      title: title || String(item.getField("title") || ""),
      url: pdfUrl,
      fileBaseName,
      contentType: "application/pdf",
      referrer: "",
      cookieSandbox: null,
    });
  }
}

function collectCookies(hosts: readonly string[]) {
  const result: CookieInfo[] = [];
  for (const host of hosts) {
    try {
      const cookies = getServices().cookies.getCookiesFromHost(host, {}, true) || [];
      for (const cookie of cookies as CookieQICookie[]) {
        const fields = getCookieFields(cookie);
        result.push({
          name: fields.name,
          value: fields.value,
          host: fields.host,
          path: fields.path,
        });
      }
    } catch (error) {
      ztoolkit.log(`[FMRS] read cookies from ${host} failed: ${error}`);
    }
  }
  return dedupeCookies(result);
}

function getCookieFields(cookie: CookieQICookie) {
  if (typeof cookie.QueryInterface === "function") {
    const coerced = cookie.QueryInterface(
      getComponents().interfaces.nsICookie,
    ) as nsICookie;
    return {
      name: coerced.name,
      value: coerced.value,
      host: coerced.host,
      path: coerced.path,
    };
  }
  return {
    name: cookie.name,
    value: cookie.value,
    host: cookie.host,
    path: cookie.path,
  };
}

function normalizeFallbackEmail(value: string) {
  return value.trim() || FALLBACK_AGENT_MAIL;
}

function dedupeCookies(cookies: CookieInfo[]) {
  const seen = new Set<string>();
  const result: CookieInfo[] = [];
  for (const cookie of cookies) {
    const key = `${cookie.host}|${cookie.path}|${cookie.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cookie);
  }
  return result;
}

function pickCookieValue(cookies: CookieInfo[], names: string[]) {
  const lower = names.map((name) => name.toLowerCase());
  const direct = cookies.find((cookie) =>
    lower.includes(cookie.name.toLowerCase()),
  );
  if (direct?.value) {
    return direct.value;
  }
  for (const cookie of cookies) {
    const parsed = tryParseCookieJson(cookie.value);
    if (!parsed) {
      continue;
    }
    for (const name of names) {
      const value = readObjectValue(parsed, name);
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function tryParseCookieJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readObjectValue(obj: any, key: string): string {
  if (!obj || typeof obj !== "object") {
    return "";
  }
  const target = key.toLowerCase();
  for (const [name, value] of Object.entries(obj)) {
    if (name.toLowerCase() === target && value != null) {
      return String(value);
    }
    if (value && typeof value === "object") {
      const nested = readObjectValue(value, key);
      if (nested) {
        return nested;
      }
    }
  }
  return "";
}

function buildCookieSandbox(origin: string, cookies: CookieInfo[]) {
  const cookiePairs: Record<string, string> = {};
  for (const cookie of cookies) {
    cookiePairs[cookie.name] = cookie.value;
  }
  const cookieString = Object.entries(cookiePairs)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new (getCookieSandbox())(null, origin, cookieString, FMRS_USER_AGENT);
}

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180);
}
