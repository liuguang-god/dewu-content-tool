const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ADBController, DEWU_PACKAGE } = require('./adb');
const parser = require('./parser');
const { productQueries } = require('../db/queries');
const { getAllKeywords, inferCategoryFromName } = require('../config/categories');
const { scrapeAll: webScrapeAll } = require('./dewu');
const { scrapeProgress } = require('./progress');

const PROXY_SCRIPT = path.join(__dirname, 'proxy.py');
const PROXY_PORT = 8080;
const CAPTURED_FILE = path.join(__dirname, '../data/captured.json');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检查 Python 和 mitmproxy 是否可用
 */
function checkEnvironment() {
  const issues = [];

  try {
    execSync('python --version', { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    try {
      execSync('python3 --version', { encoding: 'utf-8', stdio: 'pipe' });
    } catch {
      issues.push('Python 未安装或不在 PATH 中');
    }
  }

  try {
    execSync('mitmproxy --version', { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    try {
      execSync('mitmdump --version', { encoding: 'utf-8', stdio: 'pipe' });
    } catch {
      issues.push('mitmproxy 未安装，请运行: pip install mitmproxy');
    }
  }

  try {
    execSync('adb version', { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    issues.push('ADB 未安装或不在 PATH 中');
  }

  return issues;
}

/**
 * 检查 mitmdump 是否可用
 */
function isMitmdumpAvailable() {
  try {
    execSync('mitmdump --version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动 mitmproxy 进程
 */
function startProxy() {
  console.log(`启动 mitmproxy (端口 ${PROXY_PORT})...`);

  // 清空之前的拦截数据
  parser.clearCapturedData();

  // 确保 data 目录存在
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 提前检查 mitmdump 是否可用
  if (!isMitmdumpAvailable()) {
    throw new Error('mitmdump 未找到，请先安装: pip install mitmproxy');
  }

  const proc = spawn('mitmdump', [
    '-s', PROXY_SCRIPT,
    '-p', String(PROXY_PORT),
    '--set', 'connection_strategy=lazy',
    '--set', 'keep_detail=false'
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false
  });

  proc.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[proxy] ${msg}`);
  });

  proc.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('HTTP') && !msg.includes('Loading')) {
      console.log(`[proxy] ${msg}`);
    }
  });

  proc.on('error', (err) => {
    console.log(`[代理错误] mitmproxy 启动失败: ${err.message}`);
    if (err.code === 'ENOENT') {
      console.log('[代理错误] mitmdump 可执行文件未找到，请确认已安装 mitmproxy: pip install mitmproxy');
    }
  });

  return proc;
}

/**
 * ADB 自动化导航得物 App
 * @param {ADBController} adb
 * @returns {{ screenshots: Array<{keyword: string, filePath: string}> }}
 */
async function automateDewuApp(adb) {
  const progress = scrapeProgress;
  progress.log('=== 开始自动化操控得物 App ===');

  // 截图存储目录
  const screenshotDir = path.join(__dirname, '../../public/images/products');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  const screenshots = []; // { keyword, filePath }

  // 1. 启动得物 App
  progress.log('启动得物 App...');
  adb.launchDewu();
  await sleep(5000);

  // 2. 等待 App 到前台
  const appReady = await adb.waitForApp(DEWU_PACKAGE, 15000);
  if (!appReady) {
    progress.log('得物 App 未到前台，尝试继续...');
  }

  // 3. 搜索各品类关键词（只用 ASCII 关键词，避免中文输入问题）
  const keywords = [];
  const allKw = getAllKeywords();
  for (const [cat, kws] of Object.entries(allKw)) {
    for (const kw of kws) {
      // 只使用纯 ASCII 关键词
      if (/^[\x20-\x7E]+$/.test(kw)) {
        keywords.push(kw);
      }
    }
  }

  progress.log(`将搜索 ${keywords.length} 个关键词`);
  const totalKeywords = keywords.length;

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    progress.log(`[${i + 1}/${totalKeywords}] 搜索: ${kw}`);
    // 更新进度：25% ~ 65% 之间按关键词进度分配
    const kwProgress = 25 + Math.round((i / totalKeywords) * 40);
    progress.setProgress(kwProgress, 100);

    try {
      // 先按 Home 回到桌面，再重新打开 App，确保状态干净
      adb.pressHome();
      await sleep(1000);
      adb.launchDewu();
      await sleep(4000);

      // 点击搜索框（得物首页顶部搜索栏）
      adb.tap(350, 120);
      await sleep(2000);

      // 清空搜索框（Ctrl+A 全选 → Delete 删除）
      adb.clearInput();
      await sleep(500);

      // 输入关键词
      adb.inputText(kw);
      await sleep(1000);

      // 点击搜索按钮
      adb.tap(980, 120);
      await sleep(4000);

      // 向下滑动 3 次加载更多
      for (let j = 0; j < 3; j++) {
        adb.scrollDown(600);
        await sleep(2000);
      }

      // --- 截图：回到顶部，点击第一个商品，截详情页 ---
      try {
        // 滑回顶部
        for (let j = 0; j < 3; j++) {
          adb.scrollUp(600);
          await sleep(500);
        }
        await sleep(1000);

        // 点击第一个商品卡片（搜索结果第一行中间位置，1080x1920）
        adb.tap(290, 430);
        await sleep(3000);

        // 截图保存
        const sha1 = require('crypto').createHash('sha1').update(kw + Date.now()).digest('hex');
        const filePath = path.join(screenshotDir, `detail_${sha1}.jpg`);
        adb.screenshotToFile(filePath);
        screenshots.push({ keyword: kw, filePath: `/images/products/detail_${sha1}.jpg` });
        progress.log(`  截图已保存: ${kw}`);

        // 返回搜索结果
        adb.pressBack();
        await sleep(1500);
      } catch (sErr) {
        progress.log(`  截图失败: ${sErr.message}`);
      }

    } catch (err) {
      progress.log(`  搜索 ${kw} 出错: ${err.message}`);
    }

    // 前 2 个关键词后检查是否拦截到了数据，验证代理是否正常工作
    if (i === 1) {
      const earlyCheck = parser.readCapturedData();
      const interceptedCount = (earlyCheck.products?.length || 0) + (earlyCheck.raw?.length || 0);
      if (interceptedCount === 0) {
        progress.log('[警告] 前 2 个关键词搜索后未拦截到任何 API 数据，代理可能未正常工作');
      } else {
        progress.log(`  已拦截到 ${interceptedCount} 条数据，代理工作正常`);
      }
    }
  }

  // 4. 浏览社区推荐页（点击底部「探索」Tab）
  progress.log('浏览社区/探索页...');
  try {
    // 得物底部 Tab（1080x1920）：得物(135) 购买(405) 探索(675) 我(945)
    adb.tap(675, 1870);
    await sleep(4000);

    // 向下滑动 5 次加载更多内容
    for (let j = 0; j < 5; j++) {
      adb.scrollDown(600);
      await sleep(2000);
    }
  } catch (err) {
    progress.log(`浏览探索页出错: ${err.message}`);
  }

  // 5. 回到首页浏览推荐
  progress.log('回到得物首页...');
  try {
    adb.tap(135, 1870); // 左侧「得物」Tab
    await sleep(3000);

    for (let j = 0; j < 3; j++) {
      adb.scrollDown(600);
      await sleep(2000);
    }
  } catch (err) {
    progress.log(`浏览首页出错: ${err.message}`);
  }

  progress.log('=== 自动化操控完成 ===');

  return { screenshots };
}

/**
 * 下载商品图片到本地
 */
async function downloadImages(products, options) {
  const axios = require('axios');
  const crypto = require('crypto');
  const { buildPlaceholderSvg } = require('./dewu');
  const progress = scrapeProgress;

  const publicImagesDir = path.join(__dirname, '../../public/images/products');
  if (!fs.existsSync(publicImagesDir)) {
    fs.mkdirSync(publicImagesDir, { recursive: true });
  }

  const concurrency = options.imageConcurrency || 4;
  const timeoutMs = options.imageTimeoutMs || 12000;

  progress.log(`下载商品图片（并发 ${concurrency}）...`);

  for (let i = 0; i < products.length; i++) {
    const p = products[i];

    // 没有图片 URL 时，生成品类专属占位图
    if (!p.imageUrl) {
      const fileName = `${crypto.createHash('sha1').update(p.productUrl || p.name).digest('hex')}.svg`;
      const filePath = path.join(publicImagesDir, fileName);
      try {
        fs.writeFileSync(filePath, buildPlaceholderSvg(p.name, p.category));
        p.localImagePath = `/images/products/${fileName}`;
      } catch (_) { /* ignore */ }
      continue;
    }

    try {
      const response = await axios.get(p.imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        },
        timeout: timeoutMs,
        maxRedirects: 3
      });

      const ct = String(response.headers?.['content-type'] || '').toLowerCase();
      let ext = 'jpg';
      if (ct.includes('png')) ext = 'png';
      else if (ct.includes('webp')) ext = 'webp';

      const fileName = `${crypto.createHash('sha1').update(p.productUrl || p.name).digest('hex')}.${ext}`;
      const filePath = path.join(publicImagesDir, fileName);
      fs.writeFileSync(filePath, Buffer.from(response.data));
      p.localImagePath = `/images/products/${fileName}`;
    } catch (err) {
      progress.log(`  图片下载失败 [${p.name || p.productUrl || 'unknown'}]: ${err.message}`);
    }

    // 控制节奏
    if (i % concurrency === 0) {
      await sleep(300);
    }
  }

  return products;
}

/**
 * 模拟器爬虫主入口
 * @param {Object} options
 * @param {number} options.keepDays - 保留天数
 * @param {number} options.maxItems - 最大商品数
 * @param {boolean} options.downloadImages - 是否下载图片
 * @param {number} options.imageConcurrency - 图片下载并发数
 * @param {number} options.imageTimeoutMs - 图片下载超时
 */
async function scrapeAll(options = {}) {
  const progress = options.progress || scrapeProgress;

  console.log('\n====================================');
  console.log('  得物模拟器爬虫启动');
  console.log('====================================\n');

  const keepDays = options.keepDays || 7;
  const maxItems = options.maxItems || 200;
  const downloadImagesFlag = options.downloadImages !== false;

  // 1. 检查环境
  progress.step('环境检查', '检查 Python / mitmproxy / ADB');
  progress.log('检查运行环境...');
  progress.setProgress(5, 100);
  const issues = checkEnvironment();
  if (issues.length > 0) {
    progress.log('环境检查失败:');
    issues.forEach(i => progress.log(`  - ${i}`));
    progress.log('降级到网页爬虫...');
    return webScrapeAll(options);
  }
  progress.log('环境检查通过');

  // 2. 连接模拟器
  progress.step('连接模拟器', 'ADB 连接 MuMu 模拟器');
  progress.setProgress(10, 100);
  progress.log('连接模拟器...');
  const adb = new ADBController();
  const connected = await adb.connect();
  if (!connected) {
    progress.log('无法连接模拟器，降级到网页爬虫...');
    return webScrapeAll(options);
  }

  if (!adb.isConnected()) {
    progress.log('ADB 连接验证失败，降级到网页爬虫...');
    return webScrapeAll(options);
  }
  progress.log('ADB 连接验证通过');

  // 3. 启动 mitmproxy
  progress.step('启动代理', 'mitmproxy 拦截 API 数据');
  progress.setProgress(15, 100);
  progress.log('启动 mitmproxy 代理...');
  let proxyProc = null;
  try {
    proxyProc = startProxy();
    await sleep(3000);
  } catch (err) {
    progress.log(`mitmproxy 启动失败: ${err.message}`);
    progress.log('降级到网页爬虫...');
    return webScrapeAll(options);
  }
  progress.log('mitmproxy 启动成功');

  // 4. 设置代理
  progress.step('配置代理', '设置模拟器 HTTP 代理');
  progress.setProgress(20, 100);
  try {
    adb.setProxy('10.0.2.2', PROXY_PORT);
    await sleep(1000);
  } catch (err) {
    progress.log(`设置代理失败: ${err.message}`);
    if (proxyProc) proxyProc.kill();
    progress.log('降级到网页爬虫...');
    return webScrapeAll(options);
  }
  progress.log('代理配置完成');

  // 5. 注册进程清理（Ctrl+C / SIGINT 时清理代理和 ADB 设置）
  const cleanup = () => {
    console.log('\n[清理] 正在中断，清理资源...');
    try { adb.clearProxy(); } catch (_) { /* ignore */ }
    if (proxyProc) {
      try { proxyProc.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }
    console.log('[清理] 资源已释放');
  };

  const sigintHandler = () => {
    cleanup();
    process.exit(1);
  };
  process.on('SIGINT', sigintHandler);

  let products = [];

  try {
    // 5. 自动化操控 App（3 分钟超时保护）
    progress.step('自动化操控', '启动得物 App，搜索关键词并截图');
    progress.setProgress(25, 100);
    progress.log('启动得物 App，开始自动化搜索...');

    const AUTOMATION_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
    const automationTask = automateDewuApp(adb);
    const timeoutTask = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('自动化操控超时（超过 3 分钟），强制终止')), AUTOMATION_TIMEOUT_MS);
    });

    let automationResult = { screenshots: [] };
    try {
      automationResult = await Promise.race([automationTask, timeoutTask]);
    } catch (timeoutErr) {
      progress.log(`[超时] ${timeoutErr.message}`);
      progress.log('继续尝试读取已拦截的数据...');
    }

    const { screenshots } = automationResult;
    progress.log(`自动化操控完成，截图 ${screenshots.length} 张`);

    // 6. 读取拦截到的数据
    progress.step('解析数据', '读取 mitmproxy 拦截的 API 响应');
    progress.setProgress(65, 100);
    progress.log('读取拦截数据...');
    const captured = parser.readCapturedData();
    progress.log(`  拦截到 ${captured.raw?.length || 0} 条 API 响应`);
    progress.log(`  拦截到 ${captured.products?.length || 0} 个商品`);
    progress.log(`  拦截到 ${captured.community?.length || 0} 条社区内容`);

    // 7. 解析数据
    products = parser.parseProducts(captured.products || []);

    // 如果 proxy.py 的规则没匹配到，从原始响应中尝试提取
    if (products.length === 0 && captured.raw?.length > 0) {
      progress.log('从原始 API 响应中提取商品数据...');
      products = parser.extractFromRawResponses(captured.raw);
    }

    progress.log(`解析得到 ${products.length} 个商品`);

    // 将模拟器截图匹配到商品
    if (screenshots.length > 0) {
      progress.log(`匹配 ${screenshots.length} 张模拟器截图到商品...`);
      const keywordToImage = new Map();
      for (const s of screenshots) {
        keywordToImage.set(s.keyword.toLowerCase(), s.filePath);
      }
      let matched = 0;
      for (const p of products) {
        const nameLower = (p.name || '').toLowerCase();
        for (const [kw, imgPath] of keywordToImage) {
          if (nameLower.includes(kw) || kw.includes(nameLower.split(' ')[0])) {
            p.localImagePath = imgPath;
            matched++;
            break;
          }
        }
      }
      progress.log(`  成功匹配 ${matched} 个商品的截图`);
    }

  } finally {
    // 8. 清理：移除 SIGINT 监听器并释放资源
    process.removeListener('SIGINT', sigintHandler);
    cleanup();
  }

  // 9. 如果没拿到数据，降级
  if (products.length === 0) {
    progress.log('模拟器未拦截到有效数据，降级到网页爬虫...');
    return webScrapeAll(options);
  }

  // 限制数量
  products = products.slice(0, maxItems);

  // 10. 下载图片
  if (downloadImagesFlag) {
    progress.step('下载图片', '下载商品图片到本地');
    progress.setProgress(80, 100);
    progress.log(`开始下载 ${products.length} 张商品图片...`);
    products = await downloadImages(products, options);
    progress.log('图片下载完成');
  }

  // 11. 保存到数据库
  progress.step('保存数据', '写入数据库');
  progress.setProgress(95, 100);
  progress.log('保存到数据库...');
  await productQueries.insertMany(products);
  await productQueries.deleteOlderThanDays(keepDays);

  progress.setProgress(100, 100);
  progress.succeed(`成功获取 ${products.length} 个商品`);
  return products;
}

// 如果直接运行此文件
if (require.main === module) {
  scrapeAll()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('抓取失败:', err);
      process.exit(1);
    });
}

module.exports = { scrapeAll };
