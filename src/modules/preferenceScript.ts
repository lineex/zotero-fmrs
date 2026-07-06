import { config } from "../../package.json";
import { AgentMailBridge } from "./AgentMailBridge";
import { defaultSciHubUrlsString } from "./CustomResolver";
import { FmrsClient } from "./FmrsClient";
import { Common } from "./Common";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = { window: _window };
  } else {
    addon.data.prefs.window = _window;
  }

  const apiBase = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-apiBase`,
  ) as HTMLInputElement;
  const uid = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-uid`,
  ) as HTMLInputElement;
  const token = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-token`,
  ) as HTMLInputElement;
  const accessMode = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-accessMode`,
  ) as HTMLInputElement;
  const defaultEmail = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-defaultEmail`,
  ) as HTMLInputElement;
  const autoRequest = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-autoRequest`,
  ) as XUL.Checkbox;

  const autoDownloadOnAdd = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-autoDownloadOnAdd`,
  ) as XUL.Checkbox;
  const downloadEngine = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-downloadEngine`,
  ) as HTMLSelectElement;
  const scihubUrls = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-scihubUrls`,
  ) as HTMLInputElement;

  const agentMailEnabled = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-agentMailEnabled`,
  ) as XUL.Checkbox;
  const mailBackend = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-mailBackend`,
  ) as HTMLSelectElement;
  const mailSection = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-mailSection`,
  ) as HTMLElement;
  const agentMailSection = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-agentMailSection`,
  ) as HTMLElement;
  const pop3Username = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-pop3Username`,
  ) as HTMLInputElement;
  const pop3Password = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-pop3Password`,
  ) as HTMLInputElement;
  const pop3Host = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-pop3Host`,
  ) as HTMLInputElement;
  const pop3Port = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-pop3Port`,
  ) as HTMLInputElement;
  const pop3UseSSL = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-pop3UseSSL`,
  ) as XUL.Checkbox;
  const agentMailCliPath = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-agentMailCliPath`,
  ) as HTMLInputElement;
  const agentMailSenderFilter = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-agentMailSenderFilter`,
  ) as HTMLInputElement;
  const agentMailPollLimit = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-agentMailPollLimit`,
  ) as HTMLInputElement;
  const powerShellPath = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-powerShellPath`,
  ) as HTMLInputElement;
  const cmdPath = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-cmdPath`,
  ) as HTMLInputElement;
  const agentMailRefreshMinutes = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-agentMailRefreshMinutes`,
  ) as HTMLInputElement;

  const status = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-status`,
  ) as HTMLElement;
  const agentMailStatus = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-agentMailStatus`,
  ) as HTMLElement;

  const saveButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-save`,
  ) as XUL.Button;
  const verifyButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-verify`,
  ) as XUL.Button;
  const loginButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-login`,
  ) as XUL.Button;
  const loginHelperButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-loginHelper`,
  ) as XUL.Button;
  const verifyAgentMailButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-verifyAgentMail`,
  ) as XUL.Button;
  const authAgentMailButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-authAgentMail`,
  ) as XUL.Button;
  const verifyMailConnectionButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-verifyMailConnection`,
  ) as XUL.Button;
  const syncAgentMailButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-syncAgentMail`,
  ) as XUL.Button;
  const syncAgentMailAgentButton = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-syncAgentMailAgent`,
  ) as XUL.Button;

  const updateMailBackendVisibility = () => {
    const usingAgentMail = mailBackend.value === "agently";
    mailSection.style.display = usingAgentMail ? "none" : "block";
    agentMailSection.style.display = usingAgentMail ? "block" : "none";
  };

  const syncToInputs = () => {
    apiBase.value = String(getPref("apiBase") || "https://openapi.metstr.com");
    uid.value = String(getPref("uid") || "");
    token.value = String(getPref("token") || "");
    accessMode.value = String(getPref("accessMode") || "1");
    defaultEmail.value = String(getPref("defaultEmail") || "");
    autoRequest.checked = Boolean(getPref("autoRequestFullText"));

    autoDownloadOnAdd.checked =
      getPref("autoDownloadOnAdd") === undefined
        ? true
        : Boolean(getPref("autoDownloadOnAdd"));
    downloadEngine.value = String(getPref("downloadEngine") || "scihub-first");
    scihubUrls.value = String(getPref("scihubUrls") || defaultSciHubUrlsString());

    agentMailEnabled.checked = Boolean(getPref("agentMailEnabled"));
    mailBackend.value = String(getPref("mailBackend") || "pop3");
    pop3Username.value = String(getPref("pop3Username") || "");
    pop3Password.value = String(getPref("pop3Password") || "");
    pop3Host.value = String(getPref("pop3Host") || "pop.163.com");
    pop3Port.value = String(getPref("pop3Port") || 995);
    pop3UseSSL.checked =
      getPref("pop3UseSSL") === undefined ? true : Boolean(getPref("pop3UseSSL"));
    agentMailCliPath.value = String(
      getPref("agentMailCliPath") || Common.defaultAgentMailCliPath(),
    );
    agentMailSenderFilter.value = String(getPref("agentMailSenderFilter") || "");
    agentMailPollLimit.value = String(getPref("agentMailPollLimit") || 10);
    agentMailRefreshMinutes.value = String(
      getPref("agentMailRefreshMinutes") || 10,
    );

    updateMailBackendVisibility();

    status.textContent = getString("pref-status");
    agentMailStatus.textContent = getString("pref-agentMail-status");
  };

  const syncToPrefs = async () => {
    setPref("apiBase", apiBase.value.trim() || "https://openapi.metstr.com");
    setPref("uid", uid.value.trim());
    setPref("token", token.value.trim());
    setPref("accessMode", accessMode.value.trim() || "1");
    setPref("defaultEmail", defaultEmail.value.trim() || "");
    setPref("autoRequestFullText", autoRequest.checked);

    setPref("autoDownloadOnAdd", autoDownloadOnAdd.checked);
    setPref("downloadEngine", downloadEngine.value || "scihub-first");
    setPref("scihubUrls", scihubUrls.value.trim() || defaultSciHubUrlsString());

    setPref("agentMailEnabled", agentMailEnabled.checked);
    setPref("mailBackend", mailBackend.value || "pop3");
    setPref("pop3Username", pop3Username.value.trim() || "");
    setPref("pop3Password", pop3Password.value.trim() || "");
    setPref("pop3Host", pop3Host.value.trim() || "pop.163.com");
    setPref("pop3Port", Number(pop3Port.value || 995));
    setPref("pop3UseSSL", pop3UseSSL.checked);
    setPref(
      "agentMailCliPath",
      agentMailCliPath.value.trim() || Common.defaultAgentMailCliPath(),
    );
    setPref("agentMailSenderFilter", agentMailSenderFilter.value.trim());
    setPref("agentMailPollLimit", Number(agentMailPollLimit.value || 10));
    setPref(
      "agentMailRefreshMinutes",
      Number(agentMailRefreshMinutes.value || 10),
    );
  };

  const markStatus = (message: string) => {
    status.textContent = `${getString("pref-status")}: ${message}`;
  };

  const markAgentMailStatus = (message: string) => {
    agentMailStatus.textContent = `${getString("pref-agentMail-status")}: ${message}`;
  };

  const verify = async () => {
    await syncToPrefs();
    const client = FmrsClient.fromPrefs();
    const result = await client.verify();
    if (result.ok) {
      if (result.email && !defaultEmail.value.trim()) {
        defaultEmail.value = result.email;
        setPref("defaultEmail", result.email);
      }
      markStatus(`OK${result.email ? ` / ${result.email}` : ""}`);
      return;
    }
    markStatus(
      `FAIL / ${
        result.message === "missing-token"
          ? getString("popwin-no-token")
          : result.message
      }`,
    );
  };

  const verifyAgentMail = async () => {
    await syncToPrefs();
    const result = await AgentMailBridge.status();
    if (result.ok) {
      markAgentMailStatus(`OK${result.email ? ` / ${result.email}` : ""}`);
      return;
    }
    markAgentMailStatus(`FAIL / ${result.message}`);
  };

  const openAgentMailAuth = async () => {
    await syncToPrefs();
    Zotero.launchURL("https://help.mail.163.com/faqDetail.do?code=d7a5dc8471d711eb98eb7cd30aeb00bb");
    markAgentMailStatus(getString("pref-agentMail-auth-hint"));
  };

  syncToInputs();

  apiBase.addEventListener("change", syncToPrefs);
  uid.addEventListener("change", syncToPrefs);
  token.addEventListener("change", syncToPrefs);
  accessMode.addEventListener("change", syncToPrefs);
  defaultEmail.addEventListener("change", syncToPrefs);
  autoRequest.addEventListener("command", syncToPrefs);

  autoDownloadOnAdd.addEventListener("command", syncToPrefs);
  downloadEngine.addEventListener("change", syncToPrefs);
  scihubUrls.addEventListener("change", syncToPrefs);

  agentMailEnabled.addEventListener("command", syncToPrefs);
  mailBackend.addEventListener("change", async () => {
    updateMailBackendVisibility();
    await syncToPrefs();
  });
  pop3Username.addEventListener("change", syncToPrefs);
  pop3Password.addEventListener("change", syncToPrefs);
  pop3Host.addEventListener("change", syncToPrefs);
  pop3Port.addEventListener("change", syncToPrefs);
  pop3UseSSL.addEventListener("command", syncToPrefs);
  agentMailCliPath.addEventListener("change", syncToPrefs);
  agentMailSenderFilter.addEventListener("change", syncToPrefs);
  agentMailPollLimit.addEventListener("change", syncToPrefs);
  agentMailRefreshMinutes.addEventListener("change", syncToPrefs);

  saveButton.addEventListener("command", async () => {
    await syncToPrefs();
    markStatus("saved");
    markAgentMailStatus("saved");
    void addon.hooks.refreshMailSync();
    void addon.hooks.refreshDownloadSetup();
  });
  verifyButton.addEventListener("command", () => {
    void verify();
  });
  loginButton.addEventListener("command", () => {
    Zotero.launchURL("https://www.metstr.com/");
  });
  loginHelperButton.addEventListener("command", () => {
    void addon.hooks.runMailSync(false);
    void import("./FmrsFetcher").then(({ FmrsFetcher }) =>
      FmrsFetcher.openLoginHelper(),
    );
  });
  verifyAgentMailButton.addEventListener("command", () => {
    void verifyAgentMail();
  });
  verifyMailConnectionButton.addEventListener("command", () => {
    const originalBackend = mailBackend.value;
    mailBackend.value = "pop3";
    void verifyAgentMail().finally(() => {
      mailBackend.value = originalBackend;
      void syncToPrefs();
    });
  });
  authAgentMailButton.addEventListener("command", () => {
    void openAgentMailAuth();
  });
  const syncCurrentMail = async (backend: "pop3" | "agently") => {
    const originalBackend = mailBackend.value;
    mailBackend.value = backend;
    await syncToPrefs();
    void addon.hooks.runMailSync(true);
    mailBackend.value = originalBackend;
    updateMailBackendVisibility();
    await syncToPrefs();
  };

  syncAgentMailButton.addEventListener("command", () => {
    void syncCurrentMail("pop3");
  });
  syncAgentMailAgentButton.addEventListener("command", () => {
    void syncCurrentMail("agently");
  });
}
