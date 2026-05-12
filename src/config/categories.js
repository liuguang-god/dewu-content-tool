// 集中品类配置 —— 新增品类只需在此文件注册
// 所有消费品类信息的地方（爬虫、AI、路由、模板）从此文件读取

const CATEGORIES = {
  sneakers: {
    key: 'sneakers',
    label: '球鞋',
    badge: '球鞋',
    icon: '👟',
    keywords: ['Nike', 'Air Jordan', 'Dunk', 'Yeezy', 'New Balance', 'AJ1', 'Adidas', 'Converse']
  },
  clothing: {
    key: 'clothing',
    label: '服饰',
    badge: '服饰',
    icon: '👔',
    keywords: ['Supreme', 'Stussy', 'Essentials', '潮牌卫衣', '北面', 'Fear of God', 'OFF-WHITE']
  },
  beauty: {
    key: 'beauty',
    label: '美妆',
    badge: '美妆',
    icon: '💄',
    keywords: ['MAC口红', 'YSL', '雅诗兰黛', '兰蔻', '迪奥', 'Tom Ford', 'Chanel']
  },
  plush: {
    key: 'plush',
    label: '毛绒玩偶',
    badge: '毛绒',
    icon: '🧸',
    keywords: ['Labubu', 'Jellycat', '黄油小熊', 'chiikawa']
  },
  blindbox: {
    key: 'blindbox',
    label: '盲盒系列',
    badge: '盲盒',
    icon: '📦',
    keywords: ['Molly', 'Dimoo', 'SKULLPANDA', '盲盒']
  }
};

const CATEGORY_ORDER = ['sneakers', 'clothing', 'beauty', 'plush', 'blindbox'];

function getCategoryByKey(key) {
  return CATEGORIES[key] || null;
}

function getCategoryLabel(key) {
  const cat = CATEGORIES[key];
  return cat ? cat.label : '未知品类';
}

function getCategoryBadge(key) {
  const cat = CATEGORIES[key];
  return cat ? cat.badge : '';
}

function getCategoryIcon(key) {
  const cat = CATEGORIES[key];
  return cat ? cat.icon : '🏷️';
}

function getAllCategories() {
  return CATEGORY_ORDER.map(key => CATEGORIES[key]);
}

function getAllCategoryKeys() {
  return [...CATEGORY_ORDER];
}

function getCategoryKeywords(key) {
  const cat = CATEGORIES[key];
  return cat ? [...cat.keywords] : [];
}

// 返回 { sneakers: [...keywords], clothing: [...], ... } 供爬虫使用
function getAllKeywords() {
  const result = {};
  for (const key of CATEGORY_ORDER) {
    result[key] = [...CATEGORIES[key].keywords];
  }
  return result;
}

// 根据商品名称反向匹配品类（遍历所有关键词）
function inferCategoryFromName(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  for (const key of CATEGORY_ORDER) {
    const keywords = CATEGORIES[key].keywords;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return key;
      }
    }
  }
  return null;
}

// 构建 { key -> categoryObj } 映射，供模板使用
function getCategoryMap() {
  const map = {};
  for (const key of CATEGORY_ORDER) {
    map[key] = CATEGORIES[key];
  }
  return map;
}

module.exports = {
  CATEGORIES,
  CATEGORY_ORDER,
  getCategoryByKey,
  getCategoryLabel,
  getCategoryBadge,
  getCategoryIcon,
  getAllCategories,
  getAllCategoryKeys,
  getCategoryKeywords,
  getAllKeywords,
  inferCategoryFromName,
  getCategoryMap
};
