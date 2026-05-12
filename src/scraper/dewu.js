const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { productQueries } = require('../db/queries');
const { getAllKeywords, inferCategoryFromName, getAllCategoryKeys } = require('../config/categories');
const { scrapeProgress } = require('./progress');

// User-Agent 列表
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDirSync(dirPath) {
  if (fs.existsSync(dirPath)) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function sha1(text) {
  return crypto.createHash('sha1').update(String(text), 'utf8').digest('hex');
}

function inferImageExt(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('image/png')) return 'png';
  if (ct.includes('image/webp')) return 'webp';
  if (ct.includes('image/gif')) return 'gif';
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return 'jpg';

  const cleanUrl = String(url || '').split('?')[0].split('#')[0];
  const ext = path.extname(cleanUrl).replace('.', '').toLowerCase();
  if (ext === 'png' || ext === 'webp' || ext === 'gif' || ext === 'jpg' || ext === 'jpeg') {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'jpg';
}

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

// 品类占位图配色方案
const CATEGORY_PLACEHOLDER = {
  sneakers: { bg: '#FFF3E0', accent: '#E65100', icon: '👟', label: '球鞋' },
  clothing: { bg: '#E8F5E9', accent: '#2E7D32', icon: '👔', label: '服饰' },
  beauty:   { bg: '#FCE4EC', accent: '#C62828', icon: '💄', label: '美妆' },
  plush:    { bg: '#F3E5F5', accent: '#6A1B9A', icon: '🧸', label: '毛绒' },
  blindbox: { bg: '#E3F2FD', accent: '#1565C0', icon: '📦', label: '盲盒' },
};
const DEFAULT_PLACEHOLDER = { bg: '#F5F5F5', accent: '#616161', icon: '🏷️', label: '商品' };

function buildPlaceholderSvg(productName, category) {
  const title = escapeXml(productName || 'Product');
  const ph = CATEGORY_PLACEHOLDER[category] || DEFAULT_PLACEHOLDER;
  const icon = ph.icon;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="${ph.bg}"/>
  <rect x="80" y="80" width="440" height="400" rx="20" fill="white" opacity="0.6"/>
  <text x="300" y="300" text-anchor="middle" dominant-baseline="central" font-size="120">${icon}</text>
  <text x="300" y="520" text-anchor="middle" font-family="'PingFang SC','Microsoft YaHei',Arial,sans-serif" font-size="20" font-weight="600" fill="${ph.accent}">${title}</text>
  <text x="300" y="555" text-anchor="middle" font-family="'PingFang SC','Microsoft YaHei',Arial,sans-serif" font-size="14" fill="#999">${ph.label} · 得物</text>
</svg>`;
}

async function downloadProductImage({ imageUrl, productUrl, productName, category, userAgent, timeoutMs, outputDirAbs }) {
  if (!productUrl) return null;

  ensureDirSync(outputDirAbs);

  // 如果没有图片 URL，直接生成本地占位图
  if (!imageUrl) {
    const fileName = `${sha1(productUrl)}.svg`;
    const filePathAbs = path.join(outputDirAbs, fileName);
    try {
      fs.writeFileSync(filePathAbs, buildPlaceholderSvg(productName, category));
      return `/images/products/${fileName}`;
    } catch (writeErr) {
      console.log('占位图写入失败:', writeErr?.message || writeErr);
      return null;
    }
  }

  try {

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      },
      timeout: timeoutMs,
      maxRedirects: 3,
      validateStatus: (status) => status >= 200 && status < 300
    });

    const ext = inferImageExt(response.headers?.['content-type'], imageUrl);
    const fileName = `${sha1(productUrl)}.${ext}`;
    const filePathAbs = path.join(outputDirAbs, fileName);
    fs.writeFileSync(filePathAbs, Buffer.from(response.data));

    // 返回对外可访问的静态路径（Express static: public/）
    return `/images/products/${fileName}`;
  } catch (err) {
    console.log('图片下载失败，改用本地占位图:', err?.message || err);
    const fileName = `${sha1(productUrl)}.svg`;
    const filePathAbs = path.join(outputDirAbs, fileName);
    try {
      fs.writeFileSync(filePathAbs, buildPlaceholderSvg(productName, category));
      return `/images/products/${fileName}`;
    } catch (writeErr) {
      console.log('占位图写入失败:', writeErr?.message || writeErr);
      return null;
    }
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const safeConcurrency = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 4;
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// 品类对应的搜索关键词（从集中配置读取）
const CATEGORY_KEYWORDS = getAllKeywords();

/**
 * 使用 Puppeteer 从得物搜索页面抓取商品数据
 * 得物是 SPA，普通 HTTP 请求拿不到数据，需要浏览器渲染
 */
async function scrapeWithPuppeteer(keyword, maxItems = 20) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(getRandomUA());
    await page.setViewport({ width: 1440, height: 900 });

    // 反检测：隐藏 webdriver 标识
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // 拦截 API 请求，直接获取 JSON 数据
    const apiProducts = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/') && url.includes('search') || url.includes('goods') || url.includes('spu')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            // 尝试从各种可能的数据结构中提取商品
            const items = json?.data?.list || json?.data?.goodsList || json?.data?.items ||
                         json?.data?.spuList || json?.data?.resultList || [];
            for (const item of items) {
              const name = item.spuName || item.name || item.title || '';
              const price = Number(item.price || item.minPrice || item.activityPrice || 0) / 100 || 0;
              const imageUrl = item.mainPic || item.image || item.picUrl || item.coverUrl || '';
              const id = item.spuId || item.id || item.goodsId || '';
              const brandName = item.brandName || item.brand || '';

              if (name) {
                apiProducts.push({
                  name,
                  category: inferCategoryFromName(name + ' ' + brandName) || 'plush',
                  price: price || null,
                  imageUrl,
                  productUrl: id ? `https://www.dewu.com/product/detail/${id}` : '',
                  hotScore: 80 + Math.floor(Math.random() * 20)
                });
              }
            }
          }
        } catch (_) { /* ignore parse errors */ }
      }
    });

    // 访问得物搜索页面
    const searchUrl = `https://www.dewu.com/search/result?keyword=${encodeURIComponent(keyword)}`;
    console.log(`  打开搜索页面: ${searchUrl}`);
    let captchaDetected = false;
    page.on('response', (response) => {
      if (response.url().includes('captcha')) {
        captchaDetected = true;
      }
    });
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // 等待页面渲染
    await sleep(3000);

    // 检测验证码
    if (captchaDetected) {
      console.log('检测到验证码，跳过此关键词');
      return [];
    }

    // 如果拦截 API 没拿到数据，尝试从页面 DOM 提取
    if (apiProducts.length === 0) {
      console.log('  API 拦截未获取数据，尝试从页面 DOM 提取...');
      const domProducts = await page.evaluate(() => {
        const items = [];
        // 尝试多种选择器
        const cards = document.querySelectorAll('[class*="goods-card"], [class*="product-card"], [class*="spu-card"], a[href*="/product/"]');
        cards.forEach(card => {
          const nameEl = card.querySelector('[class*="name"], [class*="title"], h3, h4');
          const priceEl = card.querySelector('[class*="price"]');
          const imgEl = card.querySelector('img');
          const linkEl = card.closest('a') || card.querySelector('a');

          const name = nameEl?.textContent?.trim() || '';
          const priceText = priceEl?.textContent?.trim() || '';
          const price = Number(priceText.replace(/[^0-9.]/g, '')) || null;
          const imageUrl = imgEl?.src || imgEl?.getAttribute('data-src') || '';
          const href = linkEl?.href || '';

          if (name) {
            items.push({ name, price, imageUrl, href });
          }
        });
        return items;
      });

      for (const item of domProducts) {
        apiProducts.push({
          name: item.name,
          category: inferCategoryFromName(item.name) || 'plush',
          price: item.price,
          imageUrl: item.imageUrl,
          productUrl: item.href || '',
          hotScore: 80 + Math.floor(Math.random() * 20)
        });
      }
    }

    // 如果还是没有，截个图方便调试
    if (apiProducts.length === 0) {
      const screenshotPath = path.join(__dirname, '../../debug-dewu.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`  未能提取商品数据，已保存截图到 ${screenshotPath}`);
    }

    return apiProducts.slice(0, maxItems);
  } catch (err) {
    console.log(`  Puppeteer 抓取失败: ${err.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * 尝试通过得物移动端 H5 API 搜索
 */
async function scrapeWithMobileApi(keyword, maxItems = 10) {
  try {
    const response = await axios.get('https://app.dewu.com/api/v1/h5/search/goods/search', {
      params: { keyword, page: 1, pageSize: maxItems },
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Accept': 'application/json',
        'Referer': 'https://www.dewu.com/'
      },
      timeout: 8000
    });

    const data = response.data;
    if (!data) return [];

    const items = data?.data?.list || data?.data?.goodsList || data?.data?.items ||
                  data?.data?.spuList || data?.data?.resultList || [];
    if (!Array.isArray(items) || items.length === 0) return [];

    return items.slice(0, maxItems).map(item => ({
      name: item.spuName || item.name || item.title || '',
      category: inferCategoryFromName(item.spuName || item.name || '') || 'plush',
      price: Number(item.price || item.minPrice || item.activityPrice || 0) / 100 || null,
      imageUrl: item.mainPic || item.image || item.picUrl || item.coverUrl || '',
      productUrl: item.spuId ? `https://www.dewu.com/product/detail/${item.spuId}` : '',
      hotScore: 80 + Math.floor(Math.random() * 20)
    })).filter(p => p.name);
  } catch (_) {
    return [];
  }
}

/**
 * 尝试通过得物 API 直接搜索（不依赖 Puppeteer）
 */
async function scrapeWithApi(keyword, maxItems = 20) {
  try {
    // 得物搜索 API
    const response = await axios.get('https://www.dewu.com/search/result', {
      params: { keyword },
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      timeout: 10000
    });

    // 尝试从 HTML 中提取 JSON 数据（Next.js SSR）
    const html = String(response.data || '');
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (nextDataMatch) {
      const nextData = JSON.parse(nextDataMatch[1]);
      const goodsList = nextData?.props?.pageProps?.goodsList ||
                       nextData?.props?.pageProps?.searchResult?.list || [];
      return goodsList.slice(0, maxItems).map(item => ({
        name: item.spuName || item.name || '',
        category: inferCategoryFromName(item.spuName || item.name || '') || 'plush',
        price: Number(item.price || 0) / 100 || null,
        imageUrl: item.mainPic || item.image || '',
        productUrl: item.spuId ? `https://www.dewu.com/product/detail/${item.spuId}` : '',
        hotScore: 80 + Math.floor(Math.random() * 20)
      }));
    }
  } catch (_) { /* ignore */ }
  return [];
}

// 模拟商品数据（用于测试）
function generateMockProducts() {
  const mockProducts = [
    // 球鞋
    { name: 'Nike Air Jordan 1 经典黑白', category: 'sneakers', price: 1299, hotScore: 99 },
    { name: 'Nike Dunk Low 熊猫', category: 'sneakers', price: 899, hotScore: 96 },
    { name: 'New Balance 2002R 灰色', category: 'sneakers', price: 799, hotScore: 88 },
    // 服饰
    { name: 'Essentials 卫衣 黑色', category: 'clothing', price: 599, hotScore: 94 },
    { name: 'Stussy 基础T恤 白色', category: 'clothing', price: 399, hotScore: 91 },
    { name: '北面冲锋衣 经典款', category: 'clothing', price: 1499, hotScore: 86 },
    // 美妆
    { name: 'MAC 魅可 子弹头 Chili', category: 'beauty', price: 170, hotScore: 93 },
    { name: 'YSL 小金条 21号', category: 'beauty', price: 320, hotScore: 90 },
    { name: '雅诗兰黛 小棕瓶 50ml', category: 'beauty', price: 590, hotScore: 87 },
    // 毛绒玩偶
    { name: 'Labubu 花之精灵 红色', category: 'plush', price: 599, hotScore: 98 },
    { name: 'Labubu 运动系列 蓝色', category: 'plush', price: 499, hotScore: 95 },
    { name: 'Labubu 圣诞限定 金色', category: 'plush', price: 899, hotScore: 92 },
    { name: 'Jellycat 邦尼兔 白色', category: 'plush', price: 359, hotScore: 90 },
    { name: 'Jellycat 巴塞洛熊 棕色', category: 'plush', price: 429, hotScore: 88 },
    { name: '黄油小熊 限定款', category: 'plush', price: 299, hotScore: 85 },
    { name: 'chiikawa 乌萨拉啦', category: 'plush', price: 199, hotScore: 82 },
    { name: 'chiikawa 小八 玩偶', category: 'plush', price: 249, hotScore: 80 },
    // 盲盒系列
    { name: 'Molly 职业系列 厨师', category: 'blindbox', price: 79, hotScore: 97 },
    { name: 'Molly 职业系列 医生', category: 'blindbox', price: 79, hotScore: 96 },
    { name: 'Molly 职业系列 警察', category: 'blindbox', price: 79, hotScore: 94 },
    { name: 'Dimoo 太空系列 宇航员', category: 'blindbox', price: 89, hotScore: 93 },
    { name: 'Dimoo 太空系列 火箭', category: 'blindbox', price: 89, hotScore: 91 },
    { name: 'SKULLPANDA 夜潮系列', category: 'blindbox', price: 99, hotScore: 89 },
    { name: '小野 HIRONO 一代', category: 'blindbox', price: 69, hotScore: 87 },
    { name: '小野 HIRONO 二代', category: 'blindbox', price: 79, hotScore: 85 },
  ];

  return mockProducts.map((p, i) => ({
    name: p.name,
    category: p.category,
    price: p.price,
    imageUrl: null,
    localImagePath: null,
    productUrl: `https://www.dewu.com/product/${1000 + i}`,
    hotScore: p.hotScore
  }));
}

async function scrapeAll(options = {}) {
  const progress = options.progress || scrapeProgress;
  progress.log('开始获取商品数据...');

  try {
    let products = [];
    const keepDays = Number.isFinite(options.keepDays) ? Math.max(1, Math.floor(options.keepDays)) : 7;
    const maxItems = Number.isFinite(options.maxItems) ? Math.max(1, Math.floor(options.maxItems)) : 200;
    const downloadImages = options.downloadImages !== false;
    const imageConcurrency = Number.isFinite(options.imageConcurrency) ? Math.max(1, Math.floor(options.imageConcurrency)) : 4;
    const imageTimeoutMs = Number.isFinite(options.imageTimeoutMs) ? Math.max(1000, Math.floor(options.imageTimeoutMs)) : 12000;
    const publicImagesDirAbs = path.join(__dirname, '../../public/images/products');

    // 策略：移动端API → Web API（前3关键词）→ Puppeteer（前3关键词）→ 模拟数据
    const allKeywords = [];
    for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of kws.slice(0, 2)) {
        allKeywords.push({ keyword: kw, category: cat });
      }
    }

    progress.log(`将搜索 ${allKeywords.length} 个关键词`);

    // 第一步：尝试移动端 API
    progress.step('移动端 API', '通过 H5 接口搜索商品');
    progress.setProgress(10, 100);
    progress.log('尝试移动端 API 搜索...');
    for (const { keyword } of allKeywords.slice(0, 3)) {
      if (products.length >= maxItems) break;
      progress.log(`  移动端 API 搜索: ${keyword}`);
      const found = await scrapeWithMobileApi(keyword, 10);
      products.push(...found);
      await sleep(500);
    }

    // 第二步：API 数据不足，尝试 Web API
    if (products.length < 3) {
      progress.step('Web API', '通过网页 API 搜索商品');
      progress.setProgress(30, 100);
      progress.log('移动端 API 数据不足，尝试 Web API 搜索...');
      for (const { keyword } of allKeywords.slice(0, 3)) {
        if (products.length >= maxItems) break;
        progress.log(`  Web API 搜索: ${keyword}`);
        const found = await scrapeWithApi(keyword, 10);
        products.push(...found);
        await sleep(500);
      }
    }

    // 第三步：仍然不足，用 Puppeteer 抓取
    if (products.length < 3) {
      progress.step('Puppeteer', '使用浏览器引擎抓取');
      progress.setProgress(50, 100);
      progress.log('Web API 数据不足，尝试使用 Puppeteer 抓取...');
      for (const { keyword } of allKeywords.slice(0, 3)) {
        if (products.length >= maxItems) break;
        progress.log(`  Puppeteer 搜索: ${keyword}`);
        const found = await scrapeWithPuppeteer(keyword, 10);
        products.push(...found);
        await sleep(1000);
      }
    }

    // 去重
    const seen = new Set();
    products = products.filter(p => {
      if (!p.name || seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    }).slice(0, maxItems);

    // 如果获取到的数据太少，使用模拟数据补充
    if (products.length < 3) {
      progress.log('真实数据不足（<3），使用模拟商品数据进行测试...');
      products = generateMockProducts().slice(0, maxItems);
    }

    progress.log(`共获取 ${products.length} 个商品`);

    if (downloadImages) {
      progress.step('下载图片', '下载商品图片到本地');
      progress.setProgress(70, 100);
      progress.log(`开始下载商品图片到本地缓存（并发 ${imageConcurrency}）...`);
      const enriched = await mapWithConcurrency(products, imageConcurrency, async (p) => {
        await sleep(200 + Math.floor(Math.random() * 500));
        const localImagePath = await downloadProductImage({
          imageUrl: p.imageUrl,
          productUrl: p.productUrl,
          productName: p.name,
          category: p.category,
          userAgent: getRandomUA(),
          timeoutMs: imageTimeoutMs,
          outputDirAbs: publicImagesDirAbs
        });
        return { ...p, localImagePath: localImagePath || null };
      });
      products = enriched;
    }

    // 保存到数据库
    progress.step('保存数据', '写入数据库');
    progress.setProgress(90, 100);
    await productQueries.insertMany(products);
    await productQueries.deleteOlderThanDays(keepDays);

    progress.setProgress(100, 100);
    progress.succeed(`成功获取 ${products.length} 个商品`);

    return products;

  } catch (err) {
    progress.fail('抓取失败: ' + err.message);
    throw err;
  }
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

module.exports = { scrapeAll, generateMockProducts };
