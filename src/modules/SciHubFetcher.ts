import { getString } from "../utils/locale";
import { extractIdentifiersFromTexts } from "./Identifiers";
import { showNotice } from "./Notifications";

export interface SciHubDownloadResult {
  attached: boolean;
  skipped: boolean;
  reason?: string;
}

interface SciHubDownloadOptions {
  notify?: boolean;
  skipIfExists?: boolean;
}

export class SciHubFetcher {
  static notify = showNotice;

  static async download(items: Zotero.Item[], skipIfExists = true) {
    for (const item of items) {
      await this.tryDownloadItem(item, {
        notify: true,
        skipIfExists,
      });
    }
  }

  static async tryDownloadItem(
    item: Zotero.Item,
    options: SciHubDownloadOptions = {},
  ): Promise<SciHubDownloadResult> {
    const notify = options.notify !== false;
    const skipIfExists = options.skipIfExists !== false;

    if (!item.isRegularItem()) {
      return { attached: false, skipped: true, reason: "not-regular-item" };
    }

    const itemTitle = item.getDisplayTitle() || String(item.getField("title") || "");
    const bestAttachment = await item.getBestAttachment();
    if (skipIfExists && bestAttachment && bestAttachment.isPDFAttachment()) {
      return { attached: false, skipped: true, reason: "already-has-pdf" };
    }

    const identifiers = extractIdentifiersFromTexts([
      String(item.getField("DOI") || ""),
      String(item.getField("url") || ""),
      String(item.getField("title") || ""),
      String(item.getField("extra") || ""),
    ]);
    if (!identifiers.doi) {
      if (notify) {
        this.notify(getString("popwin-noidentifier"), itemTitle, "fail");
      }
      return { attached: false, skipped: true, reason: "missing-doi" };
    }

    try {
      const attached = await Zotero.Attachments.addAvailableFile(item, {
        methods: ["custom"],
      });
      if (attached) {
        if (notify) {
          this.notify(getString("popwin-success"), itemTitle, "success");
        }
        return { attached: true, skipped: false };
      }
      if (notify) {
        this.notify(getString("popwin-download-failed"), itemTitle, "fail");
      }
      return { attached: false, skipped: false, reason: "resolver-failed" };
    } catch (error) {
      ztoolkit.log(`[SciHub] addAvailableFile failed: ${error}`);
      if (notify) {
        this.notify(getString("popwin-download-failed"), itemTitle, "fail");
      }
      return {
        attached: false,
        skipped: false,
        reason: String(error),
      };
    }
  }
}
