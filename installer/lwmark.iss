; LWmark Windows 安装程序（Inno Setup 6）
;
; 编译入口：npm run installer（installer/build.js 会带上版本号与产物路径）
; 也可以手动：ISCC.exe /DSrcDir="<绝对路径>\release\lwmark" lwmark.iss
;
; 打包形态来自 `neu build --release`：release/lwmark/lwmark-win_x64.exe + resources.neu，
; 安装时把 exe 改名成 LWmark.exe（Neutralino 不在乎叫什么，只要 resources.neu 在它旁边）。

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SrcDir
  #define SrcDir "..\release\lwmark"
#endif
#ifndef OutDir
  #define OutDir "..\release\installer"
#endif

[Setup]
; AppId 用于识别「同一次安装」，升级/卸载都靠它 —— 定下来之后不要再改
AppId={{8F3B27C1-5A4E-4D9B-9E6A-2C7D1F0B8A34}
AppName=LWmark
AppVersion={#AppVersion}
AppVerName=LWmark {#AppVersion}
AppPublisher=LWmark
VersionInfoDescription=LWmark 安装程序
VersionInfoProductName=LWmark
VersionInfoProductVersion={#AppVersion}
; 默认给当前用户装（不需要管理员）；用户在向导里可以选「为所有用户安装」
; 选区在向导首页，选完 {autopf} 会自动切到 Program Files 或 %LOCALAPPDATA%\Programs
DefaultDirName={autopf}\LWmark
DefaultGroupName=LWmark
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
AllowNoIcons=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutDir}
OutputBaseFilename=LWmark-Setup-{#AppVersion}
SetupIconFile={#SourcePath}\icon.ico
UninstallDisplayIcon={app}\LWmark.exe
UninstallDisplayName=LWmark
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UsePreviousAppDir=yes
DisableDirPage=no
DisableReadyPage=no

[Languages]
Name: "cn"; MessagesFile: "{#SourcePath}\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
Source: "{#SrcDir}\lwmark-win_x64.exe"; DestDir: "{app}"; DestName: "LWmark.exe"; Flags: ignoreversion
Source: "{#SrcDir}\resources.neu"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\LWmark"; Filename: "{app}\LWmark.exe"; IconFilename: "{app}\LWmark.exe"; Comment: "轻量简约的本地 Markdown 编辑器"
Name: "{group}\卸载 LWmark"; Filename: "{uninstallexe}"
Name: "{autodesktop}\LWmark"; Filename: "{app}\LWmark.exe"; IconFilename: "{app}\LWmark.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\LWmark.exe"; Description: "立即运行 LWmark"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 只清安装目录里的残留（Neutralino 的日志），用户配置在 %APPDATA%\LWmark，卸载不动
Type: files; Name: "{app}\neutralinojs.log"

[Code]
const
  WebView2Guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Url = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

{ Neutralino 在 Windows 上跑在 WebView2 里：Win11 和较新的 Win10 自带，老系统要另装 }
function WebView2Ready(): Boolean;
begin
  Result :=
    RegKeyExists(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2Guid) or
    RegKeyExists(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WebView2Guid) or
    RegKeyExists(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2Guid);
end;

function InitializeSetup(): Boolean;
var
  Answer: Integer;
  ErrorCode: Integer;
begin
  Result := True;
  if WebView2Ready() then
    Exit;

  Answer := MsgBox(
    '没有检测到 Microsoft Edge WebView2 运行时，LWmark 的界面依赖它。' + #13#10#13#10 +
    'Win11 和较新的 Win10 都自带；如果这台机器确实没有，装完可能打不开窗口。' + #13#10#13#10 +
    '「是」继续安装' + #13#10 +
    '「否」打开官方下载页，装好运行时再运行本安装程序' + #13#10 +
    '「取消」退出安装',
    mbConfirmation, MB_YESNOCANCEL);

  if Answer = IDNO then
  begin
    ShellExec('open', WebView2Url, '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
    Result := False;
  end
  else if Answer = IDCANCEL then
    Result := False;
end;
