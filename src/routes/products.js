const express = require('express');
const router = express.Router();
const { productQueries, contentQueries } = require('../db/queries');
const { scrapeAll: emulatorScrapeAll } = require('../scraper/emulator');
const { scrapeProgress } = require('../scraper/progress');

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
    const channels = req.body?.channels || ['穿搭', '潮玩'];

    // 如果已有爬虫在运行，拒绝
    if (scrapeProgress.active) {
      return res.json({
        success: false,
        message: '已有爬虫任务正在运行，请等待完成'
      });
    }

    console.log(`爬虫任务启动，频道: ${channels.join(', ')}`);

    // 初始化进度
    scrapeProgress.start('emulator');

    // 异步执行爬虫
    emulatorScrapeAll({
      keepDays: 7,
      maxItems: 200,
      downloadImages: true,
      imageConcurrency: 4,
      imageTimeoutMs: 12000,
      progress: scrapeProgress,
      channels
    }).catch(err => {
      console.error('爬虫错误:', err);
      scrapeProgress.fail('爬虫异常: ' + err.message);
    });

    res.json({
      success: true,
      message: `频道爬取任务已启动: ${channels.join(', ')}`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: '爬虫启动失败: ' + err.message
    });
  }
});

// SSE 实时进度流
router.get('/scrape/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // 发送当前状态
  res.write(`data: ${JSON.stringify(scrapeProgress.toJSON())}\n\n`);

  // 如果已完成，直接关闭
  if (!scrapeProgress.active && scrapeProgress.status !== 'idle') {
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  // 监听事件
  const onLog = (entry) => {
    res.write(`data: ${JSON.stringify({ type: 'log', ...entry })}\n\n`);
  };
  const onStep = (step) => {
    res.write(`data: ${JSON.stringify({ type: 'step', ...step })}\n\n`);
  };
  const onProgress = (p) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', ...p })}\n\n`);
  };
  const onDone = (result) => {
    res.write(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`);
    cleanup();
  };
  const onError = (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', ...err })}\n\n`);
    cleanup();
  };

  function cleanup() {
    scrapeProgress.removeListener('log', onLog);
    scrapeProgress.removeListener('step', onStep);
    scrapeProgress.removeListener('progress', onProgress);
    scrapeProgress.removeListener('done', onDone);
    scrapeProgress.removeListener('error', onError);
    res.end();
  }

  scrapeProgress.on('log', onLog);
  scrapeProgress.on('step', onStep);
  scrapeProgress.on('progress', onProgress);
  scrapeProgress.on('done', onDone);
  scrapeProgress.on('error', onError);

  // 客户端断开时清理
  req.on('close', cleanup);
});

// 获取当前爬虫状态
router.get('/scrape/status', (req, res) => {
  res.json(scrapeProgress.toJSON());
});

module.exports = router;
