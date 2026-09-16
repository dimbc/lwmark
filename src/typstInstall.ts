/**
 * Typst 一键安装（走 winget）。
 *
 * 为什么落脚本文件而不是直接拼命令行：安装这件事有「查找 → 判断 → 调 winget → 复查 →
 * 补 PATH」五步，塞进一条命令行必然引号满天飞，而项目约定是**命令行里不出现引号、
 * 空格和用户路径**（见 pandoc.ts 模块头）。所以按老套路来：
 *   1. 把脚本写进 %TEMP%/LWmark/lm-install-typst.ps1（固定 ASCII 名）
 *   2. cwd 指到该目录，命令行只剩
 *        powershell -NoProfile -ExecutionPolicy Bypass -File lm-install-typst.ps1
 *   3. 脚本用 LM_xxx|... 行回话（LM_WINGET 永远排在最前，因为 winget 是装 Typst 的
 *      前置条件，缺了得先补它），中文提示由这里生成
 *
 * ⚠️ 脚本内容刻意保持**纯 ASCII**：PowerShell 5.1 读没有 BOM 的 UTF-8 脚本会按 ANSI
 * 解码，脚本里的中文会变乱码。所以脚本只输出代码，文案留在 TS 这边。
 *
 * ⚠️ 补 PATH 走注册表 API 而不是 [Environment]::SetEnvironmentVariable：后者会把
 * REG_EXPAND_SZ 的 Path 展开成字面量并降级成 REG_SZ，用户 PATH 里若有 %USERPROFILE%
 * 这类变量就被永久写死了。改前还会逐段比对，已经含目标目录就直接跳过。
 */
import {
  execIn,
  fileExists,
  inNL,
  joinPath,
  liteTempDir,
  readFileText,
  toPosixPath,
  writeFileText,
} from "./bridge";

/** winget 包 ID（Typst GmbH 官方发布，portable zip 版） */
export const TYPST_WINGET_ID = "Typst.Typst";

/** 展示给用户的命令：手动复制到终端也能装（只是不含 PATH 修正那步） */
export const TYPST_SHOW_CMD =
  `winget install --id ${TYPST_WINGET_ID} --exact ` +
  `--accept-source-agreements --accept-package-agreements`;

/**
 * winget 自己的安装方式。
 *
 * Typst 只有 winget 一条安装路径，winget 缺了整条链路就断了 —— 脚本会明确报
 * LM_WINGET|NO，这里给几条能直接粘进终端补上。
 *
 * 第 1 条是标准做法（走商店）。第 2、3 条给装不了商店的精简系统 / LTSC：
 * 实测 https://aka.ms/getwinget 会 301 到 GitHub releases 的
 * Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle（v1.29.290，约 207 MB），
 * 是**直接下载**而不是网页，而且这个 bundle 自带依赖，Add-AppxPackage 一把过。
 */
export const WINGET_CMDS: { label: string; cmd: string }[] = [
  {
    label: "微软商店",
    cmd: "start ms-windows-store://pdp/?productid=9NBLGGH4NNS1",
  },
  {
    label: "下载",
    cmd: 'iwr -UseBasicParsing "https://aka.ms/getwinget" -OutFile "$env:TEMP\\winget.msixbundle"',
  },
  {
    label: "安装",
    cmd: 'Add-AppxPackage "$env:TEMP\\winget.msixbundle"',
  },
];

/** 脚本文件名：纯 ASCII，落在临时工作目录里 */
const PS_FILE = "lm-install-typst.ps1";

/** winget 自己的安装日志（脚本里写，失败时读回给用户看） */
const INSTALL_LOG = "lm-typst-install.log";

/** 落盘的 PowerShell 脚本，纯 ASCII */
const PS_SCRIPT = `# LWmark: install / locate Typst via winget  (ASCII only, on purpose)
param([switch]$Probe)

$ErrorActionPreference = 'Continue'
$links = Join-Path $env:LOCALAPPDATA 'Microsoft\\WinGet\\Links'
$tv = Join-Path $links 'typst.exe'

function Find-Winget {
  try {
    $c = Get-Command winget -ErrorAction SilentlyContinue
    if ($c) {
      $p = ''
      if ($c.Source) { $p = [string]$c.Source }
      if (-not $p -and $c.Path) { $p = [string]$c.Path }
      if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
  } catch { }
  $alias = Join-Path $env:LOCALAPPDATA 'Microsoft\\WindowsApps\\winget.exe'
  if (Test-Path -LiteralPath $alias) { return $alias }
  return $null
}

function Ver-Winget($exe) {
  try {
    $o = & $exe --version 2>$null
    if ($o) { return ([string]$o).Trim() }
  } catch { }
  return ''
}

function Find-Typst {
  $c = Get-Command typst -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and (Test-Path -LiteralPath $c.Source)) { return $c.Source }
  if (Test-Path -LiteralPath $tv) { return $tv }
  $root = Join-Path $env:LOCALAPPDATA 'Microsoft\\WinGet\\Packages'
  if (Test-Path -LiteralPath $root) {
    $hit = Get-ChildItem -LiteralPath $root -Recurse -Filter typst.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

function Ver-Of($exe) {
  try {
    $o = & $exe --version 2>$null
    if ($o) { return ([string]$o).Trim() }
  } catch { }
  return ''
}

function Fix-Path($exe) {
  $dir = Split-Path -Parent $exe
  if (-not $dir) { Write-Output 'LM_PATH|NO_DIR'; return }
  if (-not (Test-Path -LiteralPath $dir)) { Write-Output 'LM_PATH|NO_DIR'; return }
  try {
    $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if (-not $k) { Write-Output 'LM_PATH|NO_KEY'; return }
    $cur = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $items = @($cur.Split(';') | Where-Object { $_.Trim() -ne '' })
    foreach ($i in $items) {
      if ($i.Trim().TrimEnd('\\') -ieq $dir.TrimEnd('\\')) { $k.Close(); Write-Output 'LM_PATH|OK'; return }
    }
    $new = $dir
    if ($items.Count -gt 0) { $new = (($items -join ';') + ';' + $dir) }
    $k.SetValue('Path', $new, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    $k.Close()
    Write-Output 'LM_PATH|ADDED'
  } catch {
    Write-Output ('LM_PATH|FAIL|' + $_.Exception.Message)
  }
}

# winget is a prerequisite for installing Typst, so report it even if Typst is present
$wg = Find-Winget
if ($wg) { Write-Output ('LM_WINGET|OK|' + $wg + '|' + (Ver-Winget $wg)) }
else { Write-Output 'LM_WINGET|NO|' }

$exe = Find-Typst

# PDF engines: report every one that is actually reachable. typst is taken from
# Find-Typst (a winget portable install is not on PATH until the shell restarts),
# the rest are looked up in PATH. Existence only -- no --version probe, that would
# cost a full process start per engine and the dropdown does not need it.
$eng = @(
  @('typst', 'typst'),
  @('xelatex', 'xelatex'),
  @('lualatex', 'lualatex'),
  @('pdflatex', 'pdflatex'),
  @('tectonic', 'tectonic'),
  @('wkhtmltopdf', 'wkhtmltopdf'),
  @('weasyprint', 'weasyprint'),
  @('prince', 'prince'),
  @('context', 'context')
)
foreach ($pair in $eng) {
  $name = $pair[0]
  $bin = $pair[1]
  $path = ''
  if ($name -eq 'typst') {
    $path = $exe
  } else {
    $c = Get-Command $bin -ErrorAction SilentlyContinue
    if ($c -and $c.Source -and (Test-Path -LiteralPath $c.Source)) { $path = $c.Source }
  }
  if ($path) { Write-Output ('LM_ENG|' + $name + '|' + $path) }
}

if ($exe) {
  Write-Output ('LM_OK|' + $exe + '|' + (Ver-Of $exe) + '|PRESENT')
  Fix-Path $exe
  exit 0
}
if ($Probe) { Write-Output 'LM_NO|'; exit 2 }

if (-not $wg) { Write-Output 'LM_ERR|NO_WINGET|'; exit 1 }

$log = Join-Path $env:TEMP '${INSTALL_LOG}'
& $wg install --id ${TYPST_WINGET_ID} --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-File -LiteralPath $log -Encoding utf8
$rc = $LASTEXITCODE

$exe = Find-Typst
if ($exe) {
  Write-Output ('LM_OK|' + $exe + '|' + (Ver-Of $exe) + '|INSTALLED')
  Fix-Path $exe
  exit 0
}
Write-Output ('LM_ERR|WINGET_FAIL|' + $rc)
exit 1
`;

export interface TypstResult {
  /** 找到（或刚装上）typst.exe */
  ok: boolean;
  /** typst.exe 的绝对路径（原生反斜杠）；没找到时为空 */
  exe: string;
  /** 版本行，如 "typst 0.15.1 (abc1234)" */
  version: string;
  /** 本次调用之前就已经装好了 */
  present: boolean;
  /** winget 能不能用：true 有 / false 脚本明确报没有 / null 没测到（脚本本身没跑起来） */
  winget: boolean | null;
  /** winget 的一行说明：版本 · 路径，或「未安装」 */
  wingetNote: string;
  /** 本机可用的 PDF 引擎（脚本扫出来的，顺序同 pdfEngines.ts 的候选表） */
  engines: { id: string; exe: string }[];
  /** PATH 处理结果的人话说明（可为空） */
  pathNote: string;
  /** 失败原因（已翻译成中文） */
  message: string;
  /** 原始输出，排错用 */
  log: string;
}

const EMPTY: TypstResult = {
  ok: false,
  exe: "",
  version: "",
  present: false,
  winget: null,
  wingetNote: "",
  engines: [],
  pathNote: "",
  message: "",
  log: "",
};

/** 去掉 ANSI 转义与回车进度条，只留文本行 */
function tidy(raw: string): string {
  return raw
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const tailLines = (s: string, n: number) => {
  const ls = s.split("\n").map((l) => l.trim()).filter(Boolean);
  return ls.slice(-n).join("\n");
};

/**
 * 跑一次脚本。`probe` = true 时只查不装。
 *
 * ⚠️ execCommand 是同步阻塞的：winget 要下 21 MB，国内还得过代理，
 * 界面会僵住一两分钟是正常的，调用方务必先给「安装中…」提示。
 */
export async function runTypst(
  op: "probe" | "install" = "probe",
): Promise<TypstResult> {
  if (!inNL) {
    return { ...EMPTY, message: "浏览器预览模式无法装 Typst，请用 npm run app 启动" };
  }
  const dir = await liteTempDir();
  if (!dir) return { ...EMPTY, message: "找不到系统临时目录" };

  try {
    await writeFileText(joinPath(dir, PS_FILE), PS_SCRIPT);
  } catch (e) {
    return { ...EMPTY, message: `准备安装脚本失败：${String(e)}` };
  }

  let res;
  try {
    res = await execIn(
      `powershell -NoProfile -ExecutionPolicy Bypass -File ${PS_FILE}` +
        (op === "probe" ? " -Probe" : ""),
      dir,
    );
  } catch (e) {
    return { ...EMPTY, message: `调用 PowerShell 失败：${String(e)}` };
  }

  const out = tidy(res.stdOut || "");
  const err = tidy(res.stdErr || "");
  const all = [out, err].filter(Boolean).join("\n");

  // engines 必须给新数组：EMPTY 是模块级常量，浅拷贝后 push 会污染它
  let r: TypstResult = { ...EMPTY, log: all, engines: [] };

  for (const line of all.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const seg = t.split("|");
    if (seg[0] === "LM_WINGET") {
      const kind = seg[1] ?? "";
      r.winget = kind === "OK";
      r.wingetNote =
        kind === "OK"
          ? [seg[3] || "已安装", seg[2] ?? ""].filter(Boolean).join(" · ")
          : "未安装";
    } else if (seg[0] === "LM_ENG") {
      const id = seg[1] ?? "";
      const exe = seg[2] ?? "";
      if (id && exe) r.engines.push({ id, exe: toPosixPath(exe) });
    } else if (seg[0] === "LM_OK") {
      r = {
        ...r,
        ok: true,
        exe: seg[1] ?? "",
        version: seg[2] ?? "",
        present: seg[3] === "PRESENT",
      };
    } else if (seg[0] === "LM_PATH") {
      const kind = seg[1] ?? "";
      r.pathNote =
        kind === "ADDED"
          ? "已把 typst.exe 所在目录加进用户 PATH（对已运行的程序要重启才生效）"
          : kind === "OK"
            ? "用户 PATH 里已经有 typst.exe 所在目录"
            : `PATH 未改动（${kind}${seg[2] ? "：" + seg[2] : ""}）`;
    } else if (seg[0] === "LM_ERR") {
      const kind = seg[1] ?? "";
      const code = seg[2] ?? "";
      r.message =
        kind === "NO_WINGET"
          ? "这台机器上没有 winget（Windows 的「应用安装程序」），Typst 只能经它安装。" +
            "先用下面给出的命令装上 winget，再回来点「一键安装」"
          : `winget 安装失败（退出码 ${code || "未知"}）${tailLines(r.log, 6) ? "\n" + tailLines(r.log, 6) : ""}`;
    } else if (seg[0] === "LM_NO") {
      r.message =
        r.winget === false
          ? "还没装 Typst，而且这台机器上没有 winget —— 先按下面的命令装上 winget"
          : "还没装 Typst";
    }
  }

  // 读回 winget 自己的日志：它的中文报错比退出码有用得多
  if (!r.ok && op === "install") {
    const lp = joinPath(dir, INSTALL_LOG);
    if (await fileExists(lp)) {
      try {
        const log = tidy(await readFileText(lp));
        if (log) r.log = [all, tailLines(log, 14)].filter(Boolean).join("\n");
      } catch {
        /* 日志读不到就算了，不影响主流程 */
      }
    }
  }

  if (!r.ok && !r.message) {
    r.message = op === "probe" ? "还没装 Typst" : "安装没有完成，且脚本没有给出原因";
  }
  if (r.ok) r.exe = toPosixPath(r.exe);
  return r;
}
