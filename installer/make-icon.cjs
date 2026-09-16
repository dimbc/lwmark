/*
 * 生成安装程序用的 icon.ico。
 *
 * 为什么需要它：exe 自己的图标由 neu build 打进去（读 modes.window.icon），
 * 但 Inno Setup 的 SetupIconFile 只吃 .ico，所以这里把 icon.png 转一份。
 * png2icons 是 neu 的依赖（已随 @neutralinojs/neu 装上），不额外引三方包；
 * 万一哪天 npm 不再提升它，就从 neu 自己的 node_modules 里找。
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");

function loadPng2Icons() {
  try {
    return require("png2icons");
  } catch {
    const nested = createRequire(
      path.join(root, "node_modules", "@neutralinojs", "neu", "index.js"),
    );
    return nested("png2icons");
  }
}

function main() {
  const png2icons = loadPng2Icons();
  const src = path.join(root, "icon.png");
  const out = path.join(__dirname, "icon.ico");

  if (!fs.existsSync(src)) {
    console.error(`缺少源图标：${src}`);
    process.exit(1);
  }

  // 与 neu 打 exe 图标时用的是同一套参数，保证两处图标观感一致
  const ico = png2icons.createICO(
    fs.readFileSync(src),
    png2icons.HERMITE,
    0,
    true,
    true,
  );
  if (!ico || !ico.length) {
    console.error("图标转换失败");
    process.exit(1);
  }
  fs.writeFileSync(out, ico);
  console.log(`icon.ico 已生成：${out}（${(ico.length / 1024).toFixed(1)} KB）`);
}

main();
