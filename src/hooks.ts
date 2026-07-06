import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { Common } from "./modules/Common";
import { AgentMailBridge } from "./modules/AgentMailBridge";
import { DownloadCoordinator } from "./modules/DownloadCoordinator";
import { FmrsFetcher } from "./modules/FmrsFetcher";
import {
  buildSciHubCustomResolvers,
  defaultSciHubUrlsString,
  parseSciHubUrls,
} from "./modules/CustomResolver";
import { CustomResolverManager } from "./modules/CustomResolverManager";
import { getPref, setPref } from "./utils/prefs";

const downloadObserver = {
  async notify(
    event: _ZoteroTypes.Notifier.Event,
    type: _ZoteroTypes.Notifier.Type,
    ids: Array<string | number>,
  ) {
    if (event !== "add" || type !== "item") {
      return;
    }
    if (!DownloadCoordinator.autoDownloadOnAdd) {
      return;
    }
    const itemIDs = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (!itemIDs.length) {
      return;
    }
    Zotero.setTimeout(async () => {
      try {
        const items = (await Zotero.Items.getAsync(itemIDs)) as Zotero.Item[];
        const regularItems = items.filter((item) => item?.isRegularItem());
        if (!regularItems.length) {
          return;
        }
        await DownloadCoordinator.downloadItems(regularItems, {
          notify: true,
          skipIfExists: true,
        });
      } catch (error) {
        ztoolkit.log(`[FMRS] auto download failed: ${error}`);
      }
    }, 1500);
  },
};

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  await Common.registerPrefs();
  Common.registerPrefObservers();
  refreshSciHubResolvers();
  refreshDownloadNotifier();

  await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));
  addon.data.initialized = true;
  void refreshMailSync();
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  Common.registerRightClickMenuItem();
  Common.registerToolsMenuItems(win);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  clearMailSyncTimer();
  unregisterDownloadNotifier();
  Common.unregisterPrefObservers();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      await registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

function clearMailSyncTimer() {
  if (addon.data.mailSyncTimer) {
    Zotero.clearTimeout(addon.data.mailSyncTimer);
    addon.data.mailSyncTimer = undefined;
  }
}

function mailSyncIntervalMillis() {
  const minutes = Number(getPref("agentMailRefreshMinutes") || 10);
  const boundedMinutes = Number.isFinite(minutes)
    ? Math.min(Math.max(Math.trunc(minutes), 1), 1440)
    : 10;
  return boundedMinutes * 60 * 1000;
}

function scheduleMailSync(delay = mailSyncIntervalMillis()) {
  clearMailSyncTimer();
  if (!addon.data.alive || !AgentMailBridge.enabled) {
    return;
  }
  addon.data.mailSyncTimer = Zotero.setTimeout(() => {
    void runMailSync();
  }, delay);
}

async function runMailSync(force = false) {
  if (!addon.data.alive) {
    return;
  }
  if (addon.data.mailSyncRunning && !force) {
    return;
  }
  addon.data.mailSyncRunning = true;
  try {
    const summary = await FmrsFetcher.pollAgentMail();
    if (summary.imported > 0) {
      FmrsFetcher.notify(
        "FMRS Mail",
        `已从邮箱导入 ${summary.imported} 个 PDF`,
        "success",
      );
    }
  } catch (error) {
    ztoolkit.log(`[FMRS] mail sync failed: ${error}`);
  } finally {
    addon.data.mailSyncRunning = false;
    scheduleMailSync();
  }
}

async function refreshMailSync() {
  if (!AgentMailBridge.enabled) {
    clearMailSyncTimer();
    return;
  }
  await runMailSync(true);
}

function ensureDefaultDownloadPrefs() {
  if (!getPref("downloadEngine")) {
    setPref("downloadEngine", "scihub-first");
  }
  if (getPref("autoDownloadOnAdd") === undefined) {
    setPref("autoDownloadOnAdd", true);
  }
  if (!String(getPref("scihubUrls") || "").trim()) {
    setPref("scihubUrls", defaultSciHubUrlsString());
  }
  if (!String(getPref("agentMailCliPath") || "").trim()) {
    setPref("agentMailCliPath", Common.defaultAgentMailCliPath());
  }
  if (!String(getPref("defaultEmail") || "").trim()) {
    setPref("defaultEmail", "");
  }
  if (!getPref("mailBackend")) {
    setPref("mailBackend", "pop3");
  }
  if (!String(getPref("pop3Username") || "").trim()) {
    setPref("pop3Username", "");
  }
  if (!String(getPref("pop3Password") || "").trim()) {
    setPref("pop3Password", "");
  }
  if (!String(getPref("pop3Host") || "").trim()) {
    setPref("pop3Host", "pop.163.com");
  }
  if (!getPref("pop3Port")) {
    setPref("pop3Port", 995);
  }
  if (getPref("pop3UseSSL") === undefined) {
    setPref("pop3UseSSL", true);
  }
  if (!getPref("agentMailRefreshMinutes")) {
    setPref("agentMailRefreshMinutes", 10);
  }
}

function refreshSciHubResolvers() {
  ensureDefaultDownloadPrefs();
  const configured = String(getPref("scihubUrls") || "").trim();
  const urls = parseSciHubUrls(configured || defaultSciHubUrlsString());
  const engine = DownloadCoordinator.engine;
  const automatic = engine !== "fmrs-only";
  CustomResolverManager.shared.removeAllCustomResolversInZotero();
  CustomResolverManager.shared.appendCustomResolversInZotero(
    buildSciHubCustomResolvers(urls, automatic),
  );
  setPref("scihubUrls", urls.join(","));
}

function unregisterDownloadNotifier() {
  if (addon.data.downloadNotifierID) {
    Zotero.Notifier.unregisterObserver(addon.data.downloadNotifierID);
    addon.data.downloadNotifierID = undefined;
  }
}

function refreshDownloadNotifier() {
  unregisterDownloadNotifier();
  if (!DownloadCoordinator.autoDownloadOnAdd) {
    return;
  }
  addon.data.downloadNotifierID = Zotero.Notifier.registerObserver(
    downloadObserver,
    ["item"],
    "fmrs-auto-download",
  );
}

function refreshDownloadSetup() {
  refreshSciHubResolvers();
  refreshDownloadNotifier();
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  refreshMailSync,
  runMailSync,
  refreshDownloadSetup,
};
