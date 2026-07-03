import { getPref, setPref } from "../utils/prefs";

export interface FmrsSettings {
  apiBase: string;
  uid: string;
  token: string;
  accessMode: string;
  defaultEmail: string;
  autoRequestFullText: boolean;
}

export interface FmrsArticle {
  id: string;
  pmid?: string;
  ti?: string;
  doi?: string;
  cab?: string;
  pmc?: string;
  pubmedCentral?: string;
  [key: string]: unknown;
}

export interface FmrsChannel {
  id: string;
  label: string;
  url: string;
}

export interface VerifyResult {
  ok: boolean;
  message: string;
  email?: string;
}

export interface SessionSnapshot {
  uid: string;
  token: string;
  accessMode: string;
}

export class FmrsClient {
  readonly settings: FmrsSettings;

  constructor(settings: Partial<FmrsSettings> = {}) {
    this.settings = {
      apiBase: normalizeApiBase(
        settings.apiBase ?? getPref("apiBase") ?? "https://openapi.metstr.com",
      ),
      uid: settings.uid ?? getPref("uid") ?? "",
      token: settings.token ?? getPref("token") ?? "",
      accessMode: settings.accessMode ?? getPref("accessMode") ?? "1",
      defaultEmail: settings.defaultEmail ?? getPref("defaultEmail") ?? "",
      autoRequestFullText:
        settings.autoRequestFullText ?? Boolean(getPref("autoRequestFullText")),
    };
  }

  static fromPrefs() {
    return new FmrsClient();
  }

  hasToken() {
    return Boolean(this.settings.uid && this.settings.token);
  }

  saveSession(snapshot: SessionSnapshot) {
    setPref("uid", snapshot.uid.trim());
    setPref("token", snapshot.token.trim());
    setPref("accessMode", snapshot.accessMode.trim() || "1");
  }

  headers(extra: Record<string, string> = {}) {
    return {
      uid: this.settings.uid,
      token: this.settings.token,
      db: "FmrsC",
      accessMode: this.settings.accessMode || "1",
      Origin: "https://newfmrs.metstr.com",
      Referer: "https://newfmrs.metstr.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      ...extra,
    };
  }

  async verify(): Promise<VerifyResult> {
    if (!this.hasToken()) {
      return { ok: false, message: "missing-token" };
    }
    const data = await this.requestJson(
      `${this.settings.apiBase}/fmrs-search/analyse/total`,
    );
    if (data.code === 0) {
      const self = await this.selfDetail().catch(() => null);
      if (self?.userEmail && !this.settings.defaultEmail) {
        setPref("defaultEmail", self.userEmail);
      }
      return {
        ok: true,
        message: "ok",
        email: self?.userEmail,
      };
    }
    return {
      ok: false,
      message: data.msg || "auth-failed",
    };
  }

  async verifyWithSandbox(
    cookieSandbox: Zotero.CookieSandbox,
    headerOverrides?: Record<string, string>,
  ): Promise<VerifyResult> {
    const data = await this.requestJson(
      `${this.settings.apiBase}/fmrs-search/analyse/total`,
      true,
      cookieSandbox,
      headerOverrides,
    );
    if (data.code === 0) {
      const self = await this.selfDetail(cookieSandbox, headerOverrides).catch(
        () => null,
      );
      return {
        ok: true,
        message: "ok",
        email: self?.userEmail,
      };
    }
    return {
      ok: false,
      message: data.msg || "auth-failed",
    };
  }

  async selfDetail(
    cookieSandbox?: Zotero.CookieSandbox,
    headerOverrides?: Record<string, string>,
  ): Promise<{ userEmail?: string; id?: string; uid?: string } | null> {
    const data = await this.requestJson(
      `${this.settings.apiBase}/fmrs-user/user/new/selfDetail`,
      true,
      cookieSandbox,
      headerOverrides,
    );
    if ((data.code === 200 || data.code === 0) && data.data) {
      return data.data;
    }
    return null;
  }

  async sendPhoneCode(
    cookieSandbox?: Zotero.CookieSandbox,
  ): Promise<{ ok: boolean; message: string; captchaKey?: string; captchaImg?: string }> {
    const captcha = await this.requestJson(
      `${this.settings.apiBase}/fmrs-user/user/new/getCaptcha`,
      false,
      cookieSandbox,
    );
    const captchaKey = String(captcha?.data?.captchaKey || "");
    const captchaImg = String(captcha?.data?.captchaImg || "");
    return {
      ok: Boolean(captchaKey),
      message: captchaKey
        ? "captcha-ready"
        : String(captcha?.msg || "captcha-failed"),
      captchaKey,
      captchaImg,
    };
  }

  async submitPhoneCaptcha(
    phone: string,
    captchaKey: string,
    captchaCode: string,
    cookieSandbox?: Zotero.CookieSandbox,
  ) {
    const data = await this.requestJsonPost(
      `${this.settings.apiBase}/fmrs-user/user/new/checkCode/login`,
      {
        userPhone: phone,
        captchaKey,
        captchaCode,
      },
      false,
      cookieSandbox,
    );
    return {
      ok: data.code === 200,
      message: String(data.msg || ""),
    };
  }

  async loginByPhone(
    phone: string,
    checkCode: string,
    cookieSandbox?: Zotero.CookieSandbox,
  ): Promise<SessionSnapshot | null> {
    const data = await this.requestJsonPost(
      `${this.settings.apiBase}/fmrs-user/user/new/phoneLogin`,
      {
        userPhone: phone,
        checkCode,
      },
      false,
      cookieSandbox,
    );
    const payload = data?.data;
    if (data.code === 200 && payload?.loginToken && payload?.id) {
      return {
        uid: String(payload.id),
        token: String(payload.loginToken),
        accessMode: String(payload?.metStrUserInfo?.accessMode || "1"),
      };
    }
    return null;
  }

  async inferSessionFromCookieSandbox(
    token: string,
    accessMode: string,
    cookieSandbox: Zotero.CookieSandbox,
  ): Promise<SessionSnapshot | null> {
    const verify = await this.verifyWithSandbox(cookieSandbox, {
      uid: "0",
      token,
      accessMode,
    }).catch(() => null);
    if (!verify?.ok) {
      return null;
    }
    const self = await this.selfDetail(cookieSandbox, {
      uid: "0",
      token,
      accessMode,
    }).catch(() => null);
    const candidate = String(self?.id || self?.uid || "").trim();
    if (!/^\d+$/.test(candidate)) {
      return null;
    }
    return {
      uid: candidate,
      token,
      accessMode,
    };
  }

  async selfDetailFromToken(
    token: string,
    accessMode: string,
    cookieSandbox?: Zotero.CookieSandbox,
  ) {
    return this.selfDetail(cookieSandbox, {
      uid: "0",
      token,
      accessMode,
    });
  }

  async resolvePmid(doi: string): Promise<string | null> {
    const url = new URL(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
    );
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("term", doi);
    url.searchParams.set("retmode", "json");
    const data = await this.requestJson(url.href, false);
    const list = data?.esearchresult?.idlist;
    return Array.isArray(list) && list.length > 0 ? String(list[0]) : null;
  }

  async resolveArticleByIdentifier(identifier: { pmid?: string; doi?: string }) {
    const pmid =
      identifier.pmid ||
      (identifier.doi ? await this.resolvePmid(identifier.doi) : null);
    if (pmid) {
      const data = await this.requestJson(
        `${this.settings.apiBase}/fmrs-search/article/detail?id=${encodeURIComponent(pmid)}`,
      );
      if (data.code === 0 && data.data) {
        return data.data as FmrsArticle;
      }
    }

    if (identifier.doi) {
      const data = await this.requestJsonPost(
        `${this.settings.apiBase}/fmrs-search/article/search`,
        {
          page: 1,
          size: 5,
          query: identifier.doi,
        },
      );
      return data?.data?.records?.[0] || null;
    }

    return null;
  }

  async getDownloadChannels(fmrsId: string): Promise<FmrsChannel[]> {
    const data = await this.requestJson(
      `${this.settings.apiBase}/fmrs-search/article/download?id=${encodeURIComponent(fmrsId)}`,
    );
    const htmls = data?.data?.htmls;
    if (data.code !== 0 || typeof htmls !== "string") {
      return [];
    }
    return parseDownloadHtml(htmls);
  }

  async requestFullText(fmrsId: string, email?: string) {
    const targetEmail = email || this.settings.defaultEmail;
    if (!targetEmail) {
      throw new Error("missing-email");
    }
    const url = new URL(`${this.settings.apiBase}/fmrs-search/require/submit`);
    url.searchParams.set("id", fmrsId);
    url.searchParams.set("email", targetEmail);
    const data = await this.requestJson(url.href);
    return {
      ok: data.code === 0,
      message: data.msg || "",
      email: targetEmail,
    };
  }

  async resolvePdfUrl(url: string, depth = 0): Promise<string | null> {
    if (depth > 3) {
      return null;
    }
    if (/\.pdf(?:$|[?#])/i.test(url)) {
      return url;
    }
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/pdf,*/*",
      },
    });
    const text = String(
      (resp as any).responseText ?? (resp as any).response ?? "",
    );
    const finalUrl = String((resp as any).responseURL || url);
    const contentType = String(
      ((resp as any).channel && (resp as any).channel.contentType) || "",
    ).toLowerCase();
    if (contentType.includes("pdf")) {
      return finalUrl;
    }
    if (/^%PDF/i.test(text)) {
      return finalUrl;
    }
    if (/Preparing to download/i.test(text)) {
      return null;
    }

    const parsed = parsePdfUrlFromHtml(text, finalUrl);
    if (parsed) {
      return parsed;
    }
    return null;
  }

  async requestJson(
    url: string,
    fmrsHeaders = true,
    cookieSandbox?: Zotero.CookieSandbox,
    headerOverrides?: Record<string, string>,
  ): Promise<any> {
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: fmrsHeaders
        ? this.headers(headerOverrides)
        : {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            ...(headerOverrides || {}),
          },
      cookieSandbox,
    });
    const text = String((resp as any).responseText ?? (resp as any).response ?? "");
    return text ? JSON.parse(text) : {};
  }

  async requestJsonPost(
    url: string,
    body: Record<string, unknown>,
    fmrsHeaders = true,
    cookieSandbox?: Zotero.CookieSandbox,
    headerOverrides?: Record<string, string>,
  ): Promise<any> {
    const resp = await Zotero.HTTP.request("POST", url, {
      headers: {
        ...(fmrsHeaders
          ? this.headers(headerOverrides)
          : {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "application/json, text/plain, */*",
              ...(headerOverrides || {}),
            }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cookieSandbox,
    });
    const text = String((resp as any).responseText ?? (resp as any).response ?? "");
    return text ? JSON.parse(text) : {};
  }
}

function normalizeApiBase(value: string) {
  return value.replace(/\/+$/, "");
}

function parseDownloadHtml(html: string): FmrsChannel[] {
  const channels: FmrsChannel[] = [];
  const pattern =
    /<a\s+href="([^"]+)"[^>]*class="xiazi"[^>]*>\s*([^<]+?)\s*<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const labelText = match[2].trim();
    const idMatch = /^通道([PS]\d+)\s*\(([^)]*)\)/.exec(labelText);
    channels.push({
      id: idMatch?.[1] || labelText,
      label: idMatch?.[2] || labelText,
      url: match[1].replace(/&amp;/g, "&"),
    });
  }
  const order = new Map(
    ["P1", "P2", "P3", "S4"].map((id, index) => [id, index] as const),
  );
  channels.sort((a, b) => {
    const ai = order.get(a.id) ?? 99;
    const bi = order.get(b.id) ?? 99;
    return ai - bi;
  });
  return channels;
}

function parsePdfUrlFromHtml(html: string, baseUrl: string): string | null {
  const patterns = [
    /<embed[^>]+src="([^"]+\.pdf[^"]*)"/i,
    /<iframe[^>]+src="([^"]+\.pdf[^"]*)"/i,
    /href="([^"]*\.pdf[^"]*)"/i,
    /pdf_url"\s*content="([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      return new URL(match[1], baseUrl).href;
    }
  }
  const jsRedirect = /location\.(?:replace|href)\s*=\s*["']([^"']+)["']/i.exec(
    html,
  );
  if (jsRedirect) {
    return new URL(jsRedirect[1], baseUrl).href;
  }
  const metaRefresh =
    /<meta\s+http-equiv=["']refresh["']\s+content=["']\d*;?\s*url=([^"']+)["']/i.exec(
      html,
    );
  if (metaRefresh) {
    return new URL(metaRefresh[1], baseUrl).href;
  }
  return null;
}
