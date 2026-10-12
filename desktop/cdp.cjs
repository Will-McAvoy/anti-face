function localURL(value, protocol, port) {
  const url = new URL(value);
  if (url.protocol !== protocol || url.hostname !== '127.0.0.1' || Number(url.port) !== port || url.username || url.password) throw new Error('拒绝非本机调试连接');
  return url;
}
async function getJSON(port, pathname) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('调试端口无效');
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error('无法读取 Antigravity 调试端口');
  return response.json();
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map();
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
    const fail = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Antigravity 连接已断开')); } this.pending.clear(); };
    socket.addEventListener('close', fail); socket.addEventListener('error', fail);
  }
  static async connect(address, port) {
    localURL(address, 'ws:', port);
    const socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('连接 Antigravity 超时')); }, 3000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接 Antigravity')); }, { once: true });
    });
    return new CDP(socket);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Antigravity 响应超时')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('目标页面无法执行主题操作');
    return result.result?.value;
  }
  async captureScreenshot(options = {}) {
    const params = { format: 'png', fromSurface: true };
    if (options.clip) {
      params.clip = {
        x: options.clip.x,
        y: options.clip.y,
        width: options.clip.width,
        height: options.clip.height,
        scale: options.clip.scale === 2 ? 2 : 1
      };
    }
    const result = await this.send('Page.captureScreenshot', params);
    if (!result?.data || typeof result.data !== 'string') {
      const error = new Error('没有拿到窗口图像');
      error.code = 'CAPTURE_UNAVAILABLE';
      throw error;
    }
    const png = Buffer.from(result.data, 'base64');
    if (png.length > 16 * 1024 * 1024) {
      const error = new Error('截图超过大小限制');
      error.code = 'CAPTURE_UNAVAILABLE';
      throw error;
    }
    const size = png.length >= 24 ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } : { width: null, height: null };
    return { png, width: size.width, height: size.height };
  }
  close() { this.socket.close(); }
}
module.exports = { CDP, getJSON, localURL };
