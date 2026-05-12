const express = require('express');
const router = express.Router();
const { productQueries, contentQueries } = require('../db/queries');
const { scrapeAll } = require('../scraper/dewu');

// 获取商品列表 (API)
router.get('/', async (req, res) => {
  try {
    const { category, status, page = 1 } = req.query;
    const limit = 20;

    const products = await productQueries.getAll({
      category,
      status,
      page: parseInt(page),
      limit
    });

    const total = await productQueries.count({ category, status });

    // 如果是AJAX请求，返回JSON
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ products: products || [], total });
    }

    // 否则渲染页面
    res.render('index', {
      products: products || [],
      currentCategory: category || '',
      currentStatus: status || '',
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      total
    });
  } catch (err) {
    console.error('获取商品列表失败:', err);
    res.status(500).render('error', { message: '获取商品列表失败: ' + err.message });
  }
});

// 获取商品详情
router.get('/:id', async (req, res) => {
  try {
    const product = await productQueries.getById(parseInt(req.params.id));

    if (!product) {
      return res.status(404).render('error', { message: '商品不存在' });
    }

    const contents = await contentQueries.getByProductId(product.id);

    res.render('product', { product, contents: contents || [] });
  } catch (err) {
    console.error('获取商品详情失败:', err);
    res.status(500).render('error', { message: '获取商品详情失败: ' + err.message });
  }
});

// 触发爬虫
router.post('/scrape', async (req, res) => {
  try {
    // 异步执行爬虫：只保留最近一周，避免一次抓取过多导致页面资源请求风暴
    scrapeAll({
      keepDays: 7,
      maxItems: 200,
      downloadImages: true,
      imageConcurrency: 4,
      imageTimeoutMs: 12000
    }).catch(err => console.error('爬虫错误:', err));

    res.json({
      success: true,
      message: '爬虫任务已启动，请稍后刷新查看结果'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: '爬虫启动失败: ' + err.message
    });
  }
});

module.exports = router;
