const fs = require('fs');
const path = require('path');
const { inferCategoryFromName } = require('../config/categories');

const CAPTURED_FILE = path.join(__dirname, '../data/captured.json');

/**
 * 读取 mitmproxy 拦截到的数据文件
 */
function readCapturedData() {
  if (!fs.existsSync(CAPTURED_FILE)) {
    return { products: [], community: [], raw: [] };
  }
  try {
    const raw = fs.readFileSync(CAPTURED_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.log('读取拦截数据失败:', err.message);
    return { products: [], community: [], raw: [] };
  }
}

/**
 * 清空拦截数据文件（每次抓取前清空）
 */
function clearCapturedData() {
  try {
    fs.writeFileSync(CAPTURED_FILE, JSON.stringify({ products: [], community: [], raw: [] }));
  } catch (_) { /* ignore */ }
}

/**
 * 解析商品数据，映射到数据库字段
 * @param {Array} rawProducts - 从 proxy.py 拦截到的原始商品数据
 * @returns {Array} 标准化的商品对象数组
 */
function parseProducts(rawProducts) {
  const seen = new Set();
  const products = [];

  for (const item of rawProducts) {
    const name = (item.name || '').trim();
    if (!name) continue;

    // 去重：按商品名
    if (seen.has(name)) continue;
    seen.add(name);

    // 推断品类
    const category = inferCategoryFromName(name) || item.category || 'plush';

    // 规范化价格
    let price = item.price;
    if (typeof price === 'string') {
      price = parseFloat(price.replace(/[^0-9.]/g, '')) || null;
    }
    if (price && price > 10000) {
      // 可能是以「分」为单位
      price = price / 100;
    }

    // 规范化图片 URL
    let imageUrl = item.imageUrl || '';
    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = '';
    }

    // 规范化商品链接
    let productUrl = item.productUrl || '';
    if (productUrl && !productUrl.startsWith('http')) {
      productUrl = `https://www.dewu.com${productUrl}`;
    }

    // 热度分数
    let hotScore = parseInt(item.hotScore) || 80;
    if (hotScore > 200) hotScore = Math.min(100, Math.floor(hotScore / 10));

    products.push({
      name,
      category,
      price: price || null,
      imageUrl,
      localImagePath: null,
      productUrl,
      hotScore
    });
  }

  return products;
}

/**
 * 解析社区帖子数据
 * @param {Array} rawPosts - 从 proxy.py 拦截到的原始帖子数据
 * @returns {Array} 标准化的帖子对象数组
 */
function parseCommunityPosts(rawPosts) {
  const seen = new Set();
  const posts = [];

  for (const item of rawPosts) {
    const title = (item.title || '').trim();
    if (!title) continue;

    // 去重：按标题
    if (seen.has(title)) continue;
    seen.add(title);

    posts.push({
      title,
      images: Array.isArray(item.images) ? item.images.filter(Boolean) : [],
      noteUrl: item.noteUrl || '',
      likes: parseInt(item.likes) || 0,
      comments: parseInt(item.comments) || 0
    });
  }

  return posts;
}

/**
 * 从原始 API 响应中提取商品数据（兜底方案）
 * 当 proxy.py 的规则没匹配到时，遍历所有原始响应尝试提取
 */
function extractFromRawResponses(rawResponses) {
  const allProducts = [];

  for (const resp of rawResponses) {
    if (!resp.data || typeof resp.data !== 'object') continue;

    try {
      // 递归搜索嵌套对象中的数组
      const arrays = findArraysInObject(resp.data);
      for (const arr of arrays) {
        for (const item of arr) {
          if (!item || typeof item !== 'object') continue;
          // 尝试提取字段
          const name = item.spuName || item.name || item.title || item.goodsName || '';
          if (!name || name.length < 2) continue;

          const priceRaw = item.price || item.minPrice || 0;
          const price = priceRaw > 100 ? priceRaw / 100 : priceRaw;
          const imageUrl = item.mainPic || item.image || item.picUrl || item.coverUrl || '';
          const spuId = item.spuId || item.id || item.goodsId || '';

          allProducts.push({
            name: name.trim(),
            category: inferCategoryFromName(name) || 'plush',
            price: price || null,
            imageUrl,
            localImagePath: null,
            productUrl: spuId ? `https://www.dewu.com/product/detail/${spuId}` : '',
            hotScore: item.hotScore || item.likeCount || 80
          });
        }
      }
    } catch (_) { /* ignore parse errors */ }
  }

  return allProducts;
}

/**
 * 递归查找对象中的数组（深度优先，最多 3 层）
 */
function findArraysInObject(obj, depth = 0) {
  if (depth > 3) return [];
  const result = [];

  if (Array.isArray(obj)) {
    result.push(obj);
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      result.push(...findArraysInObject(val, depth + 1));
    }
  }

  return result;
}

module.exports = {
  readCapturedData,
  clearCapturedData,
  parseProducts,
  parseCommunityPosts,
  extractFromRawResponses
};
