require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 路由
const productsRouter = require('./src/routes/products');
const contentsRouter = require('./src/routes/contents');
const { buildAtImageDownloadName } = require('./src/utils/exportImageName');
const { getAllCategories, getAllCategoryKeys, getCategoryLabel, getCategoryMap } = require('./src/config/categories');

// 页面路由（SSR）
app.get('/', async (req, res) => {
  try {
    const { productQueries } = require('./src/db/queries');

    const { category, status, page = 1 } = req.query;
    const limit = 20;

    const pageNum = Number.parseInt(String(page), 10);
    const products = await productQueries.getAll({
      category,
      status,
      page: pageNum,
      limit
    });

    const total = await productQueries.count({ category, status });
    const totalPages = Math.ceil(total / limit);

    // 侧边栏数量：品类在「当前状态」下的件数；状态在「当前品类」下的件数；全部商品为全局总数
    const statusOpt = status || undefined;
    const categoryOpt = category || undefined;
    const categoryKeys = getAllCategoryKeys();

    const countQueries = [
      productQueries.count({}),
      ...categoryKeys.map(key => productQueries.count({ category: key, status: statusOpt })),
      productQueries.count({ category: categoryOpt }),
      productQueries.count({ category: categoryOpt, status: 'pending' }),
      productQueries.count({ category: categoryOpt, status: 'processed' }),
      productQueries.count({ category: categoryOpt, status: 'published' })
    ];

    const countResults = await Promise.all(countQueries);

    const totalAllProducts = countResults[0];
    const categoryCounts = {};
    categoryKeys.forEach((key, i) => {
      categoryCounts[key] = countResults[1 + i];
    });
    const countStatusAll = countResults[1 + categoryKeys.length];
    const countPending = countResults[2 + categoryKeys.length];
    const countProcessed = countResults[3 + categoryKeys.length];
    const countPublished = countResults[4 + categoryKeys.length];

    res.render('index', {
      products: products || [],
      currentCategory: category || '',
      currentStatus: status || '',
      currentPage: pageNum,
      totalPages,
      total,
      totalAllProducts,
      categories: getAllCategories(),
      categoryCounts,
      categoryMap: getCategoryMap(),
      countStatusAll,
      countPending,
      countProcessed,
      countPublished
    });
  } catch (err) {
    console.error('获取商品列表失败:', err);
    res.status(500).render('error', { message: '获取商品列表失败: ' + err.message });
  }
});

app.get('/:id(\\d+)', async (req, res) => {
  try {
    const { productQueries, contentQueries } = require('./src/db/queries');
    const productId = Number.parseInt(req.params.id, 10);
    const product = await productQueries.getById(productId);
    if (!product) {
      return res.status(404).render('error', { message: '商品不存在' });
    }

    const contents = await contentQueries.getByProductId(product.id);
    res.render('product', {
      product,
      contents: contents || [],
      exportImageDownloadFilename: buildAtImageDownloadName(product.name),
      categoryMap: getCategoryMap()
    });
  } catch (err) {
    console.error('获取商品详情失败:', err);
    res.status(500).render('error', { message: '获取商品详情失败: ' + err.message });
  }
});

app.get('/preview/:id(\\d+)', async (req, res) => {
  try {
    const { contentQueries, productQueries } = require('./src/db/queries');
    const contentId = Number.parseInt(req.params.id, 10);
    const content = await contentQueries.getById(contentId);
    if (!content) {
      return res.status(404).render('error', { message: '内容不存在' });
    }
    const product = await productQueries.getById(content.product_id);

    let tags = [];
    try {
      tags = JSON.parse(content.ai_text_tags || '[]');
      if (!Array.isArray(tags)) tags = [];
    } catch {
      tags = [];
    }

    res.render('preview', {
      contentId,
      content,
      product,
      tags
    });
  } catch (err) {
    console.error('获取内容预览失败:', err);
    res.status(500).render('error', { message: '获取内容预览失败: ' + err.message });
  }
});

app.get('/export/:id(\\d+)', async (req, res) => {
  try {
    const { contentQueries, productQueries } = require('./src/db/queries');
    const contentId = Number.parseInt(req.params.id, 10);
    const content = await contentQueries.getById(contentId);
    if (!content) {
      return res.status(404).render('error', { message: '内容不存在' });
    }
    const product = await productQueries.getById(content.product_id);

    let tags = [];
    try {
      tags = JSON.parse(content.ai_text_tags || '[]');
      if (!Array.isArray(tags)) tags = [];
    } catch {
      tags = [];
    }

    const titleText = content.ai_text_title || '';
    const bodyText = content.ai_text_body || '';
    const tagsText = tags.join(' ');
    const fullText = [titleText, bodyText, tagsText].filter(Boolean).join('\n\n');
    const formattedText = fullText;

    const exportHistory = [
      {
        thumbUrl: content.ai_image_url || null,
        title: titleText || '无标题',
        meta: `${product?.price ? '¥' + product.price : '价格待定'} · ${getCategoryLabel(product?.category)}`,
        format: (content.ai_image_url ? '图片 + 文案' : '纯文案'),
        time: new Date(content.updated_at || content.created_at || Date.now()).toLocaleString('zh-CN')
      }
    ];

    const exportImageDownloadFilename = buildAtImageDownloadName(
      (product && product.name) || titleText || '商品'
    );

    res.render('export', {
      contentId,
      content,
      product,
      tags,
      titleText,
      bodyText,
      fullText,
      formattedText,
      exportImageDownloadFilename,
      stats: { exported: 0, pending: 0, monthNew: 0, exposure: 0, exposureDelta: 0 },
      exportHistory
    });
  } catch (err) {
    console.error('获取导出中心失败:', err);
    res.status(500).render('error', { message: '获取导出中心失败: ' + err.message });
  }
});

// 无内容 ID 时：展示最近内容列表，避免裸链 /preview、/export 报错
app.get('/preview', async (req, res) => {
  try {
    const { contentQueries } = require('./src/db/queries');
    const recentContents = await contentQueries.listRecentWithProduct(30);
    res.render('flow-hub', {
      hubKind: 'preview',
      hubTitle: '内容预览',
      hubSubtitle: '选择一条已生成的内容进行编辑、重新生成或确认导出',
      targetBase: '/preview',
      recentContents
    });
  } catch (err) {
    console.error('预览入口失败:', err);
    res.status(500).render('error', { message: '加载预览列表失败: ' + err.message });
  }
});

app.get('/export', async (req, res) => {
  try {
    const { contentQueries } = require('./src/db/queries');
    const recentContents = await contentQueries.listRecentWithProduct(30);
    res.render('flow-hub', {
      hubKind: 'export',
      hubTitle: '导出中心',
      hubSubtitle: '选择内容以下载图片、复制文案并准备发布',
      targetBase: '/export',
      recentContents
    });
  } catch (err) {
    console.error('导出入口失败:', err);
    res.status(500).render('error', { message: '加载导出列表失败: ' + err.message });
  }
});

// API 路由
app.use('/api/products', productsRouter);
app.use('/api/contents', contentsRouter);

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { message: '服务器内部错误' });
});

// 404
app.use((req, res) => {
  res.status(404).render('error', { message: '页面不存在' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
  ====================================
    得物种草自动化工具已启动
    访问地址: http://localhost:${PORT}
  ====================================
  `);
});

module.exports = app;