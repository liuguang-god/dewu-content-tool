const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { productQueries } = require('../db/queries');
const { getAllKeywords, inferCategoryFromName, getAllCategoryKeys } = require('../config/categories');

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

function buildPlaceholderSvg(productName) {
  const title = escapeXml(productName || 'Product');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <rect width="600" height="600" fill="#f2f4f7"/>
  <rect x="140" y="160" width="320" height="320" rx="26" fill="#d8dde6"/>
  <path d="M210 350l55-55 35 35 60-60 80 80v55H210z" fill="#b7c0cf"/>
  <circle cx="255" cy="290" r="24" fill="#b7c0cf"/>
  <text x="300" y="510" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#6b7280">${title}</text>
</svg>`;
}

async function downloadProductImage({ imageUrl, productUrl, productName, userAgent, timeoutMs, outputDirAbs }) {
  if (!productUrl) return null;

  ensureDirSync(outputDirAbs);

  try {
    if (!imageUrl) throw new Error('缺少 imageUrl');

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
    // 为什么：外链图片可能被墙/被限流/临时 502；确保列表始终有图，避免前端反复报错。
    console.log('图片下载失败，改用本地占位图:', err?.message || err);
    const fileName = `${sha1(productUrl)}.svg`;
    const filePathAbs = path.join(outputDirAbs, fileName);
    try {
      fs.writeFileSync(filePathAbs, buildPlaceholderSvg(productName));
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
    imageUrl: `https://via.placeholder.com/300x300?text=${encodeURIComponent(p.name)}`,
    localImagePath: null,
    productUrl: `https://www.dewu.com/product/${1000 + i}`,
    hotScore: p.hotScore
  }));
}

async function scrapeAll(options = {}) {
  console.log('开始获取商品数据...');

  try {
    // 尝试从得物API获取数据，如果失败则使用模拟数据
    let products = [];
    const keepDays = Number.isFinite(options.keepDays) ? Math.max(1, Math.floor(options.keepDays)) : 7;
    const maxItems = Number.isFinite(options.maxItems) ? Math.max(1, Math.floor(options.maxItems)) : 200;
    const downloadImages = options.downloadImages !== false;
    const imageConcurrency = Number.isFinite(options.imageConcurrency) ? Math.max(1, Math.floor(options.imageConcurrency)) : 4;
    const imageTimeoutMs = Number.isFinite(options.imageTimeoutMs) ? Math.max(1000, Math.floor(options.imageTimeoutMs)) : 12000;
    const publicImagesDirAbs = path.join(__dirname, '../../public/images/products');

    try {
      // 得物搜索API (可能需要调整)
      const response = await axios.get('https://www.dewu.com/search/hot', {
        headers: { 'User-Agent': getRandomUA() },
        timeout: 10000
      });

      // 如果API成功，解析数据
      if (response.data && response.data.data) {
        products = response.data.data.map(item => ({
          name: item.title || item.name,
          category: inferCategoryFromName(item.title || item.name) || item.category || 'plush',
          price: item.price,
          imageUrl: item.image,
          localImagePath: null,
          productUrl: item.url || `https://www.dewu.com/product/${item.id}`,
          hotScore: item.hot_score || 80
        })).slice(0, maxItems);
      }
    } catch (apiErr) {
      console.log('得物API不可用，使用模拟数据:', apiErr.message);
    }

    // 如果没有获取到数据，使用模拟数据
    if (products.length === 0) {
      console.log('使用模拟商品数据进行测试...');
      products = generateMockProducts().slice(0, maxItems);
    }

    if (downloadImages) {
      console.log(`开始下载商品图片到本地缓存（并发 ${imageConcurrency}）...`);
      const enriched = await mapWithConcurrency(products, imageConcurrency, async (p) => {
        // 控制请求节奏，避免触发目标站点风控（即使是外链图也不要打太猛）
        await sleep(200 + Math.floor(Math.random() * 500));
        const localImagePath = await downloadProductImage({
          imageUrl: p.imageUrl,
          productUrl: p.productUrl,
          productName: p.name,
          userAgent: getRandomUA(),
          timeoutMs: imageTimeoutMs,
          outputDirAbs: publicImagesDirAbs
        });
        return { ...p, localImagePath: localImagePath || null };
      });
      products = enriched;
    }

    // 保存到数据库
    await productQueries.insertMany(products);
    await productQueries.deleteOlderThanDays(keepDays);
    console.log(`\n成功获取 ${products.length} 个商品`);

    return products;

  } catch (err) {
    console.error('抓取失败:', err.message);
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