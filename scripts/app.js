// 启动 Neutralino 壳（加载 dist 构建产物）
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exe = path.join(root, "bin", "neutralino-win_x64.exe");

const child = spawn(exe, ["--load-dir-res", "--path=.", "--export-auth-info"], { cwd: root, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
