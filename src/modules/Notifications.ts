import { getString } from "../utils/locale";

export type NoticeType = "fail" | "success" | "default";

export function showNotice(
  title: string,
  message: string,
  type: NoticeType = "default",
  closeTime = 3500,
) {
  const win = new ztoolkit.ProgressWindow(title, {
    closeOnClick: true,
    closeTime,
  }).createLine({
    text: message,
    type,
    progress: 0,
  });
  win.show(closeTime);
  return win;
}

export function showEngineNotice(engine: string, message: string) {
  return showNotice(`${getString("prefs-title")} / ${engine}`, message);
}
