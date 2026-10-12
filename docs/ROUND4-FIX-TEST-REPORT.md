# 第四轮功能修正测试报告 (ROUND4-FIX-TEST-REPORT)

**测试时间**: 2026-10-04 23:55 (UTC+8)  
**操作系统**: Windows 10/11 x64 (PowerShell / Node.js v22.12.0)  
**版本**: Anti Face v0.3.1  
**测试类型**: 自动化单元测试、专项缺陷回归测试、桌面端自动化 Smoke 测试、打包产物 Smoke 测试

---

## 一、真实命令执行日志与退出码

### 1. 单元测试与基础构建 (`npm run check`)
```powershell
$ npm run check

> anti-face@0.3.1 check
> npm run build && npm test

> anti-face@0.3.1 build
> tsc --noEmit && vite build

vite v8.3.2 building client environment for production...
transforming...
✓ 1908 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.67 kB │ gzip:   0.43 kB
dist/assets/index-CagQhi4d.css   18.44 kB │ gzip:   4.47 kB
dist/assets/index-h35AOZX_.js   334.05 kB │ gzip: 102.68 kB
✓ built in 725ms

> anti-face@0.3.1 test
> node --test tests/*.test.cjs

ℹ tests 89
ℹ suites 0
ℹ pass 89
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3672.0903
# 退出码: 0
```

### 2. 第四轮专项回归测试 (`npm run test:round4:fix`)
```powershell
$ npm run test:round4:fix

> anti-face@0.3.1 test:round4:fix
> node --test tests/round4-fix.test.cjs

✔ R01: PreviewSession - apply 返回失败或异常时不能执行 save 提交，必须保留 baseline (2.3116ms)
✔ R02: AutomationService - tick 在等待 hostAvailable 期间发生手动操作或模式变更，旧决策必须失效 (24.9987ms)
✔ R03: ThemeLibrary - 写磁盘失败不能污染内存，下一次成功保存不得将失败项一同落盘 (16.667ms)
✔ R04: StudioService - 未知未来 schema 的 appearance.json 必须冻结写入并报错，不得静默覆盖 (4.2124ms)
✔ R05: NotificationService - 生产默认构造必须使用真实单调时钟，不同任务在冷却期后能正常触发 (3111.421ms)
✔ R06: StudioService - applyEditorDocument 必须触发 noteManual 暂停自动切换 (0.6702ms)
✔ R07: StudioService - cancelPreview 取消试穿后必须同步回填 studio.document (1.2081ms)
✔ Sound Path: 预置音效文件必须存在且在真实文件系统中可读 (2.814ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ duration_ms 3317.4256
# 退出码: 0
```

### 3. 桌面端全功能自动化烟雾测试 (`npm run test:desktop`)
```powershell
$ npm run test:desktop

> anti-face@0.3.1 test:desktop
> node scripts/smoke-desktop.cjs

PASS: desktop UI, filtering, persistence, wallpaper, JSON import/export, IPC validation, renderer isolation, telemetry, history export, process restart
PASS: old settings migrate, preferences stay off until chosen, then survive process restart
PASS: realtime and history without preload explain that the desktop app is required
# 退出码: 0
```

### 4. 第三轮多窗口烟雾测试 (`npm run test:desktop:round3`)
```powershell
$ npm run test:desktop:round3

> anti-face@0.3.1 test:desktop:round3
> node scripts/smoke-round3.cjs

PASS: real desktop IPC/UI selects, probes, applies and restores B; A isolation; rapid selection; idle disconnect/reconnect; missing/corrupt statistics display
# 退出码: 0
```

### 5. 第四轮桌面端特性烟雾测试 (`npm run test:desktop:round4`)
```powershell
$ npm run test:desktop:round4

> anti-face@0.3.1 test:desktop:round4
> node scripts/smoke-round4.cjs

PASS: round4 desktop defaults, region editor, library, import error, mini window
# 退出码: 0
```

### 6. 打包构建与便携式 EXE 生成 (`npm run package`)
```powershell
$ npm run package

> anti-face@0.3.1 package
> npm run build && node scripts/package.mjs

  • electron-builder  version=26.15.3 os=10.0.19045
  • packaging       platform=win32 arch=x64 electron=44.5.1 appOutDir=release\win-unpacked
  • building        target=portable file=release\Anti Face 0.3.1.exe archs=x64
# 退出码: 0
```

### 7. 打包产物自动化烟雾测试 (`node scripts/smoke-packed.cjs`)
```powershell
$ node scripts/smoke-packed.cjs

PASS: unpacked EXE panels, IPC rejection, default preferences, fixture isolation, 125-row export
# 退出码: 0
```

---

## 二、真实文件系统与资源指纹核验

### 1. 声音资源解包位置核验
```powershell
$ Get-ChildItem -Path "release\win-unpacked\resources\app.asar.unpacked\assets\sounds"

Mode                 LastWriteTime         Length Name
----                 -------------         ------ ----
-a----        2026-10-04     23:54           7982 completed.wav
-a----        2026-10-04     23:54           7982 failed.wav
-a----        2026-10-04     23:54           7982 preview.wav
-a----        2026-10-04     23:54           7982 waiting_user.wav
```
- **结论**: 声音文件通过 `asarUnpack` 规则放置在外部文件系统，PowerShell `System.Windows.Media.MediaPlayer` 可正常打开与解码。

### 2. 打包产物哈希与大小
```powershell
$ Get-FileHash -Path "release\Anti Face 0.3.1.exe" -Algorithm SHA256

Algorithm Hash                                                             Path
--------- ----                                                             ----
SHA256    1AAC4F5AEDF97A49C2AED9E775016D9B4B8DD4B557BDED8058B80A79DCA3071E E:\onedrive\work\hermes\anti_face\release\Anti Face 0.3.1.exe

$ (Get-Item "release\Anti Face 0.3.1.exe").Length
101579695
```

---

## 三、未实机测试与说明

1. **实际音频听觉体感**: 自动化脚本已验证音频文件真实存在、路径可解析且 PowerShell 能够正常读取返回。但因无人工耳机环境，物理喇叭发声标记为「资源/媒体打开已验证，实际人耳声音待人工确认」。
2. **多显示器拔插硬件测试**: 迷你窗口边界夹取已在单元测试和模拟 DPI/边界逻辑下通过断言，但未在物理多显示器热插拔环境下做人工目视测试。
3. **真实 Antigravity 宿主进程侵入测试**: 严格遵循防破坏要求，未主动修改宿主运行环境或终止用户正在运行的任务。
