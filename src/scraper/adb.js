const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// MuMu 模拟器默认 ADB 地址
const DEFAULT_ADB_HOST = '127.0.0.1';
const DEFAULT_ADB_PORT = 7555;

// 得物 App 包名
const DEWU_PACKAGE = 'com.shizhuang.duapp';
const DEWU_MAIN_ACTIVITY = 'com.shizhuang.duapp/.feature.main.MainActivity';

class ADBController {
  constructor(options = {}) {
    this.host = options.host || DEFAULT_ADB_HOST;
    this.port = options.port || DEFAULT_ADB_PORT;
    this.target = `${this.host}:${this.port}`;
    this.connected = false;
  }

  /**
   * 执行 ADB 命令
   */
  exec(cmd, options = {}) {
    const fullCmd = `adb -s ${this.target} ${cmd}`;
    try {
      return execSync(fullCmd, {
        encoding: options.encoding || 'utf-8',
        timeout: options.timeout || 15000,
        maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
        ...options
      });
    } catch (err) {
      throw new Error(`ADB 命令失败: ${fullCmd}\n${err.message}`);
    }
  }

  /**
   * 执行 ADB 命令并返回 Buffer（用于截图等二进制输出）
   */
  execBuffer(cmd) {
    const fullCmd = `adb -s ${this.target} ${cmd}`;
    return execSync(fullCmd, {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024
    });
  }

  /**
   * 连接模拟器
   */
  async connect() {
    try {
      // 先尝试连接
      this.exec(`connect ${this.target}`);
      // 验证连接
      const output = this.exec('shell echo ok');
      if (output.trim() === 'ok') {
        this.connected = true;
        console.log(`ADB 已连接: ${this.target}`);
        return true;
      }
    } catch (err) {
      console.log(`ADB 连接失败: ${err.message}`);
      return false;
    }
    return false;
  }

  /**
   * 检查连接状态
   */
  isConnected() {
    try {
      const output = this.exec('shell echo ok');
      return output.trim() === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * 获取当前前台 Activity
   */
  getCurrentActivity() {
    try {
      const output = this.exec('shell dumpsys activity activities');
      // 在 Windows 上不能用 grep，用 JS 过滤
      const lines = output.split('\n').filter(l => l.includes('mResumedActivity'));
      return lines.join('\n').trim();
    } catch {
      return '';
    }
  }

  /**
   * 启动得物 App
   */
  launchDewu() {
    console.log('启动得物 App...');
    // 优先用 monkey 启动（不需要知道具体 Activity 名称）
    try {
      this.exec(`shell monkey -p ${DEWU_PACKAGE} -c android.intent.category.LAUNCHER 1`);
      return true;
    } catch {
      // 备选：am start
      try {
        this.exec(`shell am start -n ${DEWU_MAIN_ACTIVITY}`);
        return true;
      } catch (err) {
        console.log(`启动得物失败: ${err.message}`);
        return false;
      }
    }
  }

  /**
   * 强制停止得物 App
   */
  stopDewu() {
    try {
      this.exec(`shell am force-stop ${DEWU_PACKAGE}`);
    } catch (_) { /* ignore */ }
  }

  /**
   * 设置代理
   * @param {string} host - 代理主机（模拟器中访问宿主机用 10.0.2.2）
   * @param {number} port - 代理端口
   */
  setProxy(host, port) {
    const proxy = `${host}:${port}`;
    console.log(`设置代理: ${proxy}`);
    this.exec(`shell settings put global http_proxy ${proxy}`);
  }

  /**
   * 清除代理
   */
  clearProxy() {
    console.log('清除代理...');
    try {
      this.exec('shell settings put global http_proxy :0');
    } catch (_) {
      try {
        this.exec('shell settings delete global http_proxy');
      } catch (_) { /* ignore */ }
    }
  }

  /**
   * 点击坐标
   */
  tap(x, y) {
    this.exec(`shell input tap ${x} ${y}`);
  }

  /**
   * 长按坐标
   */
  longPress(x, y, durationMs = 1000) {
    this.exec(`shell input swipe ${x} ${y} ${x} ${y} ${durationMs}`);
  }

  /**
   * 滑动
   */
  swipe(x1, y1, x2, y2, durationMs = 300) {
    this.exec(`shell input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`);
  }

  /**
   * 向下滑动（从屏幕中下部向上滑）
   */
  scrollDown(distance = 500) {
    // 从屏幕 70% 高度滑到 30% 高度
    this.swipe(540, 1344, 540, 1344 - distance, 400);
  }

  /**
   * 向上滑动
   */
  scrollUp(distance = 500) {
    this.swipe(540, 576, 540, 576 + distance, 400);
  }

  /**
   * 返回键
   */
  pressBack() {
    this.exec('shell input keyevent 4');
  }

  /**
   * Home 键
   */
  pressHome() {
    this.exec('shell input keyevent 3');
  }

  /**
   * 清空输入框：Ctrl+A 全选 + Delete 删除
   * 不内部 sleep，由调用方通过 await sleep 控制时序
   */
  clearInput() {
    this.exec('shell input keyevent 29 --longpress'); // Ctrl+A
    this.exec('shell input keyevent 67'); // Delete
  }

  /**
   * 输入文本到搜索框（仅 ASCII）
   * 调用前必须先清空输入框，调用后需要 await sleep
   */
  inputText(text) {
    this.exec(`shell input text "${text}"`);
  }

  /**
   * 截图并返回 PNG Buffer
   */
  screenshot() {
    return this.execBuffer('exec-out screencap -p');
  }

  /**
   * 截图并保存到文件
   */
  screenshotToFile(filePath) {
    const buffer = this.screenshot();
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  /**
   * 获取屏幕分辨率
   */
  getScreenSize() {
    try {
      const output = this.exec('shell wm size');
      const match = output.match(/(\d+)x(\d+)/);
      if (match) {
        return { width: parseInt(match[1]), height: parseInt(match[2]) };
      }
    } catch (_) { /* ignore */ }
    return { width: 1080, height: 1920 }; // 默认 MuMu 分辨率
  }

  /**
   * 获取当前打开的 App 包名
   */
  getForegroundPackage() {
    try {
      const output = this.exec('shell dumpsys window');
      // 在 Windows 上不能用 grep，用 JS 过滤
      const line = output.split('\n').find(l => l.includes('mCurrentFocus'));
      if (!line) return '';
      const match = line.match(/([a-zA-Z0-9_.]+)\/([a-zA-Z0-9_.]+)/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  /**
   * 等待指定 App 到前台
   */
  async waitForApp(packageName, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const foreground = this.getForegroundPackage();
      if (foreground === packageName) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }
}

module.exports = { ADBController, DEWU_PACKAGE };
