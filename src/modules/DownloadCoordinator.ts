import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { FmrsFetcher } from "./FmrsFetcher";
import { SciHubFetcher } from "./SciHubFetcher";

export type DownloadEngine =
  | "scihub-first"
  | "fmrs-first"
  | "scihub-only"
  | "fmrs-only";

interface CoordinatorOptions {
  notify?: boolean;
  skipIfExists?: boolean;
}

export class DownloadCoordinator {
  static get engine(): DownloadEngine {
    const value = String(getPref("downloadEngine") || "scihub-first");
    if (
      value === "scihub-first" ||
      value === "fmrs-first" ||
      value === "scihub-only" ||
      value === "fmrs-only"
    ) {
      return value;
    }
    return "scihub-first";
  }

  static get autoDownloadOnAdd() {
    return Boolean(getPref("autoDownloadOnAdd"));
  }

  static async downloadItems(items: Zotero.Item[], options: CoordinatorOptions = {}) {
    const notify = options.notify !== false;
    const skipIfExists = options.skipIfExists !== false;
    const engine = this.engine;
    const useFmrs = engine !== "scihub-only";
    const fmrsSession = useFmrs
      ? await FmrsFetcher.createSession({ notify: false })
      : null;

    for (const item of items) {
      if (!item.isRegularItem()) {
        continue;
      }

      const bestAttachment = await item.getBestAttachment();
      if (skipIfExists && bestAttachment && bestAttachment.isPDFAttachment()) {
        continue;
      }

      const itemTitle =
        item.getDisplayTitle() || String(item.getField("title") || "");

      if (engine === "scihub-first") {
        const scihub = await SciHubFetcher.tryDownloadItem(item, {
          notify: false,
          skipIfExists,
        });
        if (scihub.attached) {
          if (notify) {
            SciHubFetcher.notify(getString("popwin-success"), itemTitle, "success");
          }
          continue;
        }

        if (fmrsSession) {
          const fmrs = await FmrsFetcher.tryDownloadItemWithSession(
            fmrsSession,
            item,
            {
              notify,
              allowRequestFallback: true,
              skipIfExists,
            },
          );
          if (fmrs.attached || fmrs.requested) {
            continue;
          }
        }

        if (notify) {
          SciHubFetcher.notify(getString("popwin-download-failed"), itemTitle, "fail");
        }
        continue;
      }

      if (engine === "fmrs-first") {
        if (fmrsSession) {
          const fmrs = await FmrsFetcher.tryDownloadItemWithSession(
            fmrsSession,
            item,
            {
              notify,
              allowRequestFallback: false,
              skipIfExists,
            },
          );
          if (fmrs.attached) {
            continue;
          }
        }

        const scihub = await SciHubFetcher.tryDownloadItem(item, {
          notify: false,
          skipIfExists,
        });
        if (scihub.attached) {
          if (notify) {
            SciHubFetcher.notify(getString("popwin-success"), itemTitle, "success");
          }
          continue;
        }

        if (fmrsSession && Boolean(getPref("autoRequestFullText"))) {
          await FmrsFetcher.downloadOrRequest([item], "request");
          continue;
        }

        if (notify) {
          SciHubFetcher.notify(getString("popwin-download-failed"), itemTitle, "fail");
        }
        continue;
      }

      if (engine === "scihub-only") {
        const scihub = await SciHubFetcher.tryDownloadItem(item, {
          notify,
          skipIfExists,
        });
        if (!scihub.attached && notify && !scihub.skipped) {
          SciHubFetcher.notify(getString("popwin-download-failed"), itemTitle, "fail");
        }
        continue;
      }

      if (fmrsSession) {
        await FmrsFetcher.tryDownloadItemWithSession(fmrsSession, item, {
          notify,
          allowRequestFallback: true,
          skipIfExists,
        });
      } else if (notify) {
        FmrsFetcher.notify(getString("popwin-authfail"), itemTitle, "fail");
      }
    }
  }

  static async requestFullText(items: Zotero.Item[]) {
    await FmrsFetcher.downloadOrRequest(items, "request");
  }
}
