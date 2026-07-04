import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { AgentMailBridge } from "./AgentMailBridge";
import { defaultSciHubUrlsString } from "./CustomResolver";
import { DownloadCoordinator } from "./DownloadCoordinator";
import { FmrsClient } from "./FmrsClient";
import { FmrsFetcher } from "./FmrsFetcher";

type PrefDialogData = {
  unloadCallback?: () => void;
};

export class Common {
  static async registerPrefs() {
    await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      src: rootURI + "content/preferences.xhtml",
      label: getString("prefs-title"),
      image: `chrome://${config.addonRef}/content/icons/fmrs.svg`,
      helpURL: "https://github.com/lineex/zotero-fmrs",
    });
  }

  static openPrefs() {
    return Zotero.Utilities.Internal.openPreferences("zotero-prefpane-general");
  }

  static openSettingsDialog() {
    const dialogData: PrefDialogData = {};
    const dialog = new ztoolkit.Dialog(1, 1)
      .setDialogData(dialogData)
      .addCell(0, 0, this.createSettingsDialogContent() as any, false)
      .addButton(getString("pref-save"), "save", {
        noClose: true,
        callback: () => {
          const win = dialog.window;
          this.saveSettingsDialogPrefs(win);
          this.setSettingsDialogStatus(win, getString("pref-status"), "saved");
          this.setSettingsDialogStatus(
            win,
            getString("pref-agentMail-status"),
            "saved",
            "agentMailStatus",
          );
          void addon.hooks.refreshMailSync();
          void addon.hooks.refreshDownloadSetup();
        },
      })
      .addButton(getString("pref-verify"), "verify", {
        noClose: true,
        callback: async () => {
          const win = dialog.window;
          this.saveSettingsDialogPrefs(win);
          await this.verifyFmrsFromSettingsDialog(win);
        },
      })
      .addButton(getString("pref-agentMail-verify"), "verify-agent-mail", {
        noClose: true,
        callback: async () => {
          const win = dialog.window;
          this.saveSettingsDialogPrefs(win);
          await this.verifyAgentMailFromSettingsDialog(win);
        },
      })
      .addButton(getString("pref-open-login"), "login", {
        noClose: true,
        callback: () => Zotero.launchURL("https://www.metstr.com/"),
      })
      .addButton(getString("pref-open-login-helper"), "login-helper", {
        noClose: true,
        callback: () => {
          void addon.hooks.runMailSync(false);
          void FmrsFetcher.openLoginHelper();
        },
      })
      .addButton(getString("login-helper-close"), "close")
      .open(getString("prefs-title"), {
        fitContent: false,
        width: 760,
        height: 620,
        centerscreen: true,
        resizable: true,
      });

    this.syncSettingsDialogInputs(dialog.window);
    return dialog;
  }

  static defaultAgentMailCliPath() {
    return Zotero.isWin
      ? "D:\\program\\MyAgents\\nodejs\\agently-cli.cmd"
      : "agently-cli";
  }

  private static createSettingsDialogContent() {
    return {
      tag: "vbox",
      styles: {
        padding: "12px",
        gap: "10px",
        width: "min(760px, calc(100vw - 48px))",
        maxWidth: "100%",
        minHeight: "560px",
        overflow: "auto",
      },
      children: [
        this.createDialogSection(getString("pref-title"), [
          this.createDialogInputRow("apiBase", getString("pref-apiBase-label")),
          this.createDialogInputRow("uid", getString("pref-uid-label")),
          this.createDialogInputRow("token", getString("pref-token-label"), "password"),
          this.createDialogInputRow(
            "accessMode",
            getString("pref-accessMode-label"),
          ),
          this.createDialogInputRow(
            "defaultEmail",
            getString("pref-defaultEmail-label"),
          ),
          this.createDialogCheckboxRow(
            "autoRequest",
            getString("pref-autoRequest"),
          ),
          this.createDialogStatus("status", getString("pref-status")),
        ]),
        this.createDialogSection(getString("pref-download-title"), [
          this.createDialogCheckboxRow(
            "autoDownloadOnAdd",
            getString("pref-download-autoOnAdd"),
          ),
          this.createDialogSelectRow("downloadEngine", getString("pref-download-engine-label"), [
            ["scihub-first", getString("pref-download-engine-scihub-first")],
            ["fmrs-first", getString("pref-download-engine-fmrs-first")],
            ["scihub-only", getString("pref-download-engine-scihub-only")],
            ["fmrs-only", getString("pref-download-engine-fmrs-only")],
          ]),
          this.createDialogInputRow(
            "scihubUrls",
            getString("pref-download-scihubUrls-label"),
          ),
          this.createDialogDescription(getString("pref-download-help")),
        ]),
        this.createDialogSection(getString("pref-agentMail-title"), [
          this.createDialogCheckboxRow(
            "agentMailEnabled",
            getString("pref-agentMail-enabled"),
          ),
          this.createDialogDescription(getString("pref-agentMail-help")),
          this.createDialogHeading(getString("pref-agentMail-section-account")),
          this.createDialogInputRow(
            "pop3Username",
            getString("pref-pop3-username-label"),
          ),
          this.createDialogInputRow(
            "pop3Password",
            getString("pref-pop3-password-label"),
            "password",
          ),
          this.createDialogInputRow(
            "pop3Host",
            getString("pref-pop3-host-label"),
          ),
          this.createDialogInputRow(
            "pop3Port",
            getString("pref-pop3-port-label"),
            "number",
          ),
          this.createDialogCheckboxRow(
            "pop3UseSSL",
            getString("pref-pop3-ssl"),
          ),
          this.createDialogHeading(getString("pref-agentMail-section-automation")),
          this.createDialogInputRow(
            "agentMailRefreshMinutes",
            getString("pref-agentMail-refreshMinutes-label"),
            "number",
          ),
          this.createDialogInputRow(
            "agentMailPollLimit",
            getString("pref-agentMail-pollLimit-label"),
            "number",
          ),
          this.createDialogInputRow(
            "agentMailSenderFilter",
            getString("pref-agentMail-senderFilter-label"),
          ),
          this.createDialogHeading(getString("pref-agentMail-section-advanced")),
          this.createDialogSelectRow("mailBackend", getString("pref-mail-backend-label"), [
            ["pop3", getString("pref-mail-backend-pop3")],
            ["agently", getString("pref-mail-backend-agently")],
          ]),
          this.createDialogInputRow(
            "agentMailCliPath",
            getString("pref-agentMail-cliPath-label"),
          ),
          this.createDialogStatus("agentMailStatus", getString("pref-agentMail-status")),
        ]),
      ],
    };
  }

  private static createDialogSection(title: string, children: object[]) {
    return {
      tag: "groupbox",
      styles: { padding: "8px", gap: "6px" },
      children: [
        {
          tag: "label",
          children: [
            {
              tag: "h2",
              namespace: "html",
              properties: { textContent: title },
              styles: { margin: "0 0 6px 0" },
            },
          ],
        },
        ...children,
      ],
    };
  }

  private static createDialogInputRow(
    id: string,
    label: string,
    type = "text",
  ) {
    return {
      tag: "hbox",
      attributes: { align: "center" },
      styles: { gap: "8px", flexWrap: "wrap", maxWidth: "100%" },
      children: [
        {
          tag: "label",
          properties: { textContent: label },
          styles: { minWidth: "140px", maxWidth: "190px" },
        },
        {
          tag: "input",
          namespace: "html",
          id: `fmrs-settings-${id}`,
          attributes: { type },
          styles: { flex: "1", minWidth: "220px", maxWidth: "100%" },
        },
      ],
    };
  }

  private static createDialogCheckboxRow(id: string, label: string) {
    return {
      tag: "checkbox",
      id: `fmrs-settings-${id}`,
      properties: { label },
    };
  }

  private static createDialogSelectRow(
    id: string,
    label: string,
    options: Array<[string, string]>,
  ) {
    return {
      tag: "hbox",
      attributes: { align: "center" },
      styles: { gap: "8px", flexWrap: "wrap", maxWidth: "100%" },
      children: [
        {
          tag: "label",
          properties: { textContent: label },
          styles: { minWidth: "140px", maxWidth: "190px" },
        },
        {
          tag: "select",
          namespace: "html",
          id: `fmrs-settings-${id}`,
          styles: { flex: "1", minWidth: "220px", maxWidth: "100%" },
          children: options.map(([value, textContent]) => ({
            tag: "option",
            namespace: "html",
            attributes: { value },
            properties: { textContent },
          })),
        },
      ],
    };
  }

  private static createDialogHeading(textContent: string) {
    return {
      tag: "label",
      properties: { textContent },
      styles: {
        marginTop: "8px",
        fontWeight: "bold",
        color: "var(--fill-primary)",
      },
    };
  }

  private static createDialogDescription(textContent: string) {
    return {
      tag: "description",
      properties: { textContent },
      styles: { color: "gray" },
    };
  }

  private static createDialogStatus(id: string, textContent: string) {
    return {
      tag: "description",
      id: `fmrs-settings-${id}`,
      properties: { textContent },
    };
  }

  private static syncSettingsDialogInputs(win: Window) {
    this.dialogInput(win, "apiBase").value = String(
      getPref("apiBase") || "https://openapi.metstr.com",
    );
    this.dialogInput(win, "uid").value = String(getPref("uid") || "");
    this.dialogInput(win, "token").value = String(getPref("token") || "");
    this.dialogInput(win, "accessMode").value = String(
      getPref("accessMode") || "1",
    );
    this.dialogInput(win, "defaultEmail").value = String(
      getPref("defaultEmail") || "surehlin10@163.com",
    );
    this.dialogCheckbox(win, "autoRequest").checked = Boolean(
      getPref("autoRequestFullText"),
    );

    this.dialogCheckbox(win, "autoDownloadOnAdd").checked =
      getPref("autoDownloadOnAdd") === undefined
        ? true
        : Boolean(getPref("autoDownloadOnAdd"));
    this.dialogSelect(win, "downloadEngine").value = String(
      getPref("downloadEngine") || "scihub-first",
    );
    this.dialogInput(win, "scihubUrls").value = String(
      getPref("scihubUrls") || defaultSciHubUrlsString(),
    );

    this.dialogCheckbox(win, "agentMailEnabled").checked = Boolean(
      getPref("agentMailEnabled"),
    );
    this.dialogSelect(win, "mailBackend").value = String(
      getPref("mailBackend") || "pop3",
    );
    this.dialogInput(win, "pop3Username").value = String(
      getPref("pop3Username") || "",
    );
    this.dialogInput(win, "pop3Password").value = String(
      getPref("pop3Password") || "",
    );
    this.dialogInput(win, "pop3Host").value = String(
      getPref("pop3Host") || "pop.163.com",
    );
    this.dialogInput(win, "pop3Port").value = String(getPref("pop3Port") || 995);
    this.dialogCheckbox(win, "pop3UseSSL").checked =
      getPref("pop3UseSSL") === undefined ? true : Boolean(getPref("pop3UseSSL"));
    this.dialogInput(win, "agentMailCliPath").value = String(
      getPref("agentMailCliPath") || this.defaultAgentMailCliPath(),
    );
    this.dialogInput(win, "agentMailSenderFilter").value = String(
      getPref("agentMailSenderFilter") || "",
    );
    this.dialogInput(win, "agentMailPollLimit").value = String(
      getPref("agentMailPollLimit") || 10,
    );
    this.dialogInput(win, "agentMailRefreshMinutes").value = String(
      getPref("agentMailRefreshMinutes") || 10,
    );
  }

  private static saveSettingsDialogPrefs(win: Window) {
    setPref(
      "apiBase",
      this.dialogInput(win, "apiBase").value.trim() ||
        "https://openapi.metstr.com",
    );
    setPref("uid", this.dialogInput(win, "uid").value.trim());
    setPref("token", this.dialogInput(win, "token").value.trim());
    setPref(
      "accessMode",
      this.dialogInput(win, "accessMode").value.trim() || "1",
    );
    setPref(
      "defaultEmail",
      this.dialogInput(win, "defaultEmail").value.trim() || "surehlin10@163.com",
    );
    setPref("autoRequestFullText", this.dialogCheckbox(win, "autoRequest").checked);

    setPref(
      "autoDownloadOnAdd",
      this.dialogCheckbox(win, "autoDownloadOnAdd").checked,
    );
    setPref(
      "downloadEngine",
      this.dialogSelect(win, "downloadEngine").value || "scihub-first",
    );
    setPref(
      "scihubUrls",
      this.dialogInput(win, "scihubUrls").value.trim() ||
        defaultSciHubUrlsString(),
    );

    setPref(
      "agentMailEnabled",
      this.dialogCheckbox(win, "agentMailEnabled").checked,
    );
    setPref("mailBackend", this.dialogSelect(win, "mailBackend").value || "pop3");
    setPref(
      "pop3Username",
      this.dialogInput(win, "pop3Username").value.trim() || "",
    );
    setPref(
      "pop3Password",
      this.dialogInput(win, "pop3Password").value.trim() || "",
    );
    setPref("pop3Host", this.dialogInput(win, "pop3Host").value.trim() || "pop.163.com");
    setPref("pop3Port", Number(this.dialogInput(win, "pop3Port").value || 995));
    setPref("pop3UseSSL", this.dialogCheckbox(win, "pop3UseSSL").checked);
    setPref(
      "agentMailCliPath",
      this.dialogInput(win, "agentMailCliPath").value.trim() ||
        this.defaultAgentMailCliPath(),
    );
    setPref(
      "agentMailSenderFilter",
      this.dialogInput(win, "agentMailSenderFilter").value.trim(),
    );
    setPref(
      "agentMailPollLimit",
      Number(this.dialogInput(win, "agentMailPollLimit").value || 10),
    );
    setPref(
      "agentMailRefreshMinutes",
      Number(this.dialogInput(win, "agentMailRefreshMinutes").value || 10),
    );
  }

  private static async verifyFmrsFromSettingsDialog(win: Window) {
    const client = FmrsClient.fromPrefs();
    const result = await client.verify();
    if (result.ok) {
      if (result.email && !this.dialogInput(win, "defaultEmail").value.trim()) {
        this.dialogInput(win, "defaultEmail").value = result.email;
        setPref("defaultEmail", result.email);
      }
      this.setSettingsDialogStatus(
        win,
        getString("pref-status"),
        `OK${result.email ? ` / ${result.email}` : ""}`,
      );
      return;
    }
    this.setSettingsDialogStatus(
      win,
      getString("pref-status"),
      `FAIL / ${
        result.message === "missing-token"
          ? getString("popwin-no-token")
          : result.message
      }`,
    );
  }

  private static async verifyAgentMailFromSettingsDialog(win: Window) {
    const result = await AgentMailBridge.status();
    if (result.ok) {
      this.setSettingsDialogStatus(
        win,
        getString("pref-agentMail-status"),
        `OK${result.email ? ` / ${result.email}` : ""}`,
        "agentMailStatus",
      );
      return;
    }
    this.setSettingsDialogStatus(
      win,
      getString("pref-agentMail-status"),
      `FAIL / ${result.message}`,
      "agentMailStatus",
    );
  }

  private static setSettingsDialogStatus(
    win: Window,
    label: string,
    message: string,
    id = "status",
  ) {
    const status = win.document.querySelector(
      `#fmrs-settings-${id}`,
    ) as HTMLElement | null;
    if (status) {
      status.textContent = `${label}: ${message}`;
    }
  }

  private static dialogInput(win: Window, id: string) {
    return win.document.querySelector(
      `#fmrs-settings-${id}`,
    ) as HTMLInputElement;
  }

  private static dialogSelect(win: Window, id: string) {
    return win.document.querySelector(
      `#fmrs-settings-${id}`,
    ) as HTMLSelectElement;
  }

  private static dialogCheckbox(win: Window, id: string) {
    return win.document.querySelector(`#fmrs-settings-${id}`) as XUL.Checkbox;
  }

  static registerPrefObservers() {
    const observers: symbol[] = [];
    const addObserver = (key: string, callback: () => void) => {
      observers.push(
        Zotero.Prefs.registerObserver(`${config.prefsPrefix}.${key}`, callback, true),
      );
    };

    addObserver("agentMailEnabled", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("agentMailSenderFilter", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("agentMailRefreshMinutes", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("agentMailDir", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("agentMailCliPath", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("mailBackend", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("pop3Username", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("pop3Password", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("pop3Host", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("pop3Port", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("pop3UseSSL", () => {
      void addon.hooks.refreshMailSync();
    });
    addObserver("autoDownloadOnAdd", () => {
      void addon.hooks.refreshDownloadSetup();
    });
    addObserver("downloadEngine", () => {
      void addon.hooks.refreshDownloadSetup();
    });
    addObserver("scihubUrls", () => {
      void addon.hooks.refreshDownloadSetup();
    });

    addon.data.prefObserverIDs = observers;
  }

  static unregisterPrefObservers() {
    const ids = addon.data.prefObserverIDs || [];
    for (const id of ids) {
      Zotero.Prefs.unregisterObserver(id);
    }
    addon.data.prefObserverIDs = [];
  }

  static registerRightClickMenuItem() {
    const menuIcon = `chrome://${config.addonRef}/content/icons/fmrs.svg`;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-itemmenu-fmrs-fetch",
      label: getString("menuitem-fetch"),
      isHidden: () =>
        !Zotero.getActiveZoteroPane()
          .getSelectedItems()
          .some((item) => item.isRegularItem()),
      commandListener: () => {
        const items = Zotero.getActiveZoteroPane().getSelectedItems();
        void DownloadCoordinator.downloadItems(items, {
          notify: true,
          skipIfExists: true,
        });
      },
      icon: menuIcon,
    });

    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-itemmenu-fmrs-request",
      label: getString("menuitem-request"),
      isHidden: () =>
        !Zotero.getActiveZoteroPane()
          .getSelectedItems()
          .some((item) => item.isRegularItem()),
      commandListener: () => {
        const items = Zotero.getActiveZoteroPane().getSelectedItems();
        void DownloadCoordinator.requestFullText(items);
      },
      icon: menuIcon,
    });
  }

  static registerToolsMenuItems(win: _ZoteroTypes.MainWindow) {
    const toolsPopup = win.document.querySelector(
      "#menu_ToolsPopup",
    ) as XUL.MenuPopup | null;
    if (!toolsPopup) {
      return;
    }
    ztoolkit.Menu.register("menuTools", {
      tag: "menuitem",
      id: "zotero-toolsmenu-fmrs-mail-sync",
      label: getString("menuitem-mail-sync"),
      commandListener: () => {
        void addon.hooks.runMailSync(true);
      },
    });
    ztoolkit.Menu.register("menuTools", {
      tag: "menuitem",
      id: "zotero-toolsmenu-fmrs-login-helper",
      label: getString("menuitem-login-helper"),
      commandListener: () => {
        void FmrsFetcher.openLoginHelper();
      },
    });
    ztoolkit.Menu.register("menuTools", {
      tag: "menuitem",
      id: "zotero-toolsmenu-fmrs-open-settings-window",
      label: `${getString("menuitem-open-settings")} (窗口)`,
      commandListener: () => {
        Common.openSettingsDialog();
      },
    });
  }
}
