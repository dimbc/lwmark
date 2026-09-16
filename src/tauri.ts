/**
 * Tauri 桥接层：浏览器预览时自动降级（input file / blob 下载）。
 */
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { getCurrentWindow } from "@tauri-apps/api/window";

export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openMarkdown(): Promise<{ path: string; text: string } | null> {
  if (inTauri) {
    const path = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (!path || typeof path !== "string") return null;
    const text = await readTextFile(path);
    return { path, text };
  }
  // 浏览器降级
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ path: file.name, text: String(reader.result ?? "") });
      reader.readAsText(file);
    };
    input.click();
  });
}

export async function saveMarkdown(
  path: string | null,
  text: string,
): Promise<string | null> {
  if (inTauri) {
    let target = path;
    if (!target) {
      target = await save({
        defaultPath: "未命名.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!target) return null;
    }
    await writeTextFile(target, text);
    return target;
  }
  // 浏览器降级：触发下载
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = path ?? "未命名.md";
  a.click();
  URL.revokeObjectURL(a.href);
  return path ?? "未命名.md";
}
