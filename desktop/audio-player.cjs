const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const NAMES = new Set(['completed', 'failed', 'waiting_user', 'preview']);

function soundPath(name) {
  const file = `${NAMES.has(name) ? name : 'preview'}.wav`;
  let resolved = path.join(__dirname, '..', 'assets', 'sounds', file);
  if (resolved.includes('app.asar')) {
    const unpacked = resolved.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) {
      return unpacked;
    }
  }
  return resolved;
}

class AudioPlayer {
  constructor(deps = {}) {
    this.spawn = deps.spawn || spawn;
    this.active = new Set();
    this.maxActive = 3;
  }

  play(name, volume = 0.4) {
    const file = soundPath(name);
    if (!fs.existsSync(file)) {
      return Promise.resolve({ ok: false, file, error: '音效文件在文件系统中不存在或不可访问' });
    }
    if (this.active.size >= this.maxActive) {
      return Promise.resolve({ ok: false, file, error: '播放器并发数已达上限' });
    }
    const level = Math.max(0, Math.min(1, Number(volume) || 0));
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName presentationCore',
      '$player = New-Object System.Windows.Media.MediaPlayer',
      `$player.Open([uri]'${file.replace(/'/g, "''")}')`,
      `$player.Volume = ${level}`,
      '$player.Play()',
      'Start-Sleep -Milliseconds 700',
      '$player.Close()'
    ].join('; ');
    return new Promise(resolve => {
      let settled = false;
      let child = null;
      let timer = null;
      const finish = (ok, error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (child) this.active.delete(child);
        resolve({ ok, file, error: error || null });
      };

      try {
        child = this.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
        this.active.add(child);
      } catch (err) {
        return finish(false, err?.message || '无法启动播放进程');
      }

      timer = setTimeout(() => {
        try { child?.kill(); } catch {}
        finish(false, '播放超时');
      }, 3500);

      child.on('error', err => finish(false, err?.message || '进程启动失败'));
      child.on('exit', code => finish(code === 0, code === 0 ? null : `进程异常退出 (${code})`));
    });
  }

  stopAll() {
    for (const child of this.active) {
      try { child.kill(); } catch {}
    }
    this.active.clear();
  }

  get activeCount() {
    return this.active.size;
  }
}

module.exports = { AudioPlayer, soundPath };
