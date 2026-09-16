/*
 * 一键编译 Windows 安装程序：npm run installer
 *
 * 前提：先跑过 `npm run release`（vite build + neu build --release），
 * 产物在 release/litemark/ 下。本脚本只负责生成图标 + 调 ISCC 编译 .iss。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "release", "litemark");
const outDir = path.join(root, "release", "installer");
const issFile = path.join(__dirname, "litemark.iss");

/** 从 neutralino.config.json 取版本号，免得版本写两处 */
function appVersion() {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(root, "neutralino.config.json"), "utf8"),
  );
  return cfg.version || "1.0.0";
}

function findIscc() {
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.ISCC,
    path.join(local, "Programs", "Inno Setup 6", "ISCC.exe"),
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function main() {
  for (const f of ["litemark-win_x64.exe", "resources.neu"]) {
    if (!fs.existsSync(path.join(srcDir, f))) {
      console.error(`缺少发布产物 ${f}，请先运行：npm run release`);
      process.exit(1);
    }
  }

  const iscc = findIscc();
  if (!iscc) {
    console.error(
      "找不到 ISCC.exe（Inno Setup 6 的编译器）。\n" +
        "装一下：winget install -e --id JRSoftware.InnoSetup --scope user\n" +
        '或把已有安装的路径写进环境变量 ISCC。',
    );
    process.exit(1);
  }

  // 图标：SetupIconFile 只认 .ico
  const icon = spawnSync(
    process.execPath,
    [path.join(__dirname, "make-icon.cjs")],
    { stdio: "inherit" },
  );
  if (icon.status !== 0) process.exit(icon.status ?? 1);

  const version = appVersion();
  fs.mkdirSync(outDir, { recursive: true });

  const args = [
    `/DAppVersion=${version}`,
    `/DSrcDir=${srcDir}`,
    `/DOutDir=${outDir}`,
    issFile,
  ];
  console.log(`\n编译安装程序：ISCC ${args.join(" ")}\n`);
  const r = spawnSync(iscc, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);

  const setup = path.join(outDir, `LiteMark-Setup-${version}.exe`);
  if (!fs.existsSync(setup)) {
    console.error("编译结束但没找到输出文件，检查 .iss 的 OutputDir");
    process.exit(1);
  }
  const mb = (fs.statSync(setup).size / 1024 / 1024).toFixed(2);
  console.log(`\n安装程序已生成：${setup}（${mb} MB）`);
}

main();
