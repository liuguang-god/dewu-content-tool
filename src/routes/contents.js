const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();
const { contentQueries, productQueries } = require('../db/queries');
const { generateContent, regenerateImage, regenerateText } = require('../services/contentGenerator');
const generationJob = require('../services/generationJob');
const { buildAtImageDownloadName } = require('../utils/exportImageName');

/** RFC 5987 + ASCII 回退，便于中文文件名 */
function contentDispositionAttachment(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  const star = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

// 同源代理下载 AI 图（跨域 OSS 时浏览器会忽略 <a download>，需服务端带 Content-Disposition）
router.get('/:id/download-image', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ success: false, message: '无效内容 ID' });
    }
    const content = await contentQueries.getById(id);
    if (!content) {
      return res.status(404).json({ success: false, message: '内容不存在' });
    }
    const imageUrl = content.ai_image_url && String(content.ai_image_url).trim();
    if (!imageUrl) {
      return res.status(404).json({ success: false, message: '暂无图片' });
    }
    if (!/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({ success: false, message: '无效图片地址' });
    }

    const product = await productQueries.getById(content.product_id);
    const downloadName = buildAtImageDownloadName(product?.name || '商品');

    const upstream = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 120000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400
    });

    const ct = upstream.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', contentDispositionAttachment(downloadName));
    upstream.data.pipe(res);
  } catch (err) {
    console.error('download-image', err.message);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: '下载图片失败: ' + err.message });
    } else {
      res.end();
    }
  }
});

// 异步生成内容：立即返回 jobId，供前端轮询 /generate-job/:jobId 展示与服务端一致的运行日志
router.post('/generate/:productId', (req, res) => {
  const productId = Number.parseInt(req.params.productId, 10);
  if (!Number.isFinite(productId) || productId < 1) {
    return res.status(400).json({ success: false, message: '无效商品 ID' });
  }

  const jobId = crypto.randomUUID();
  generationJob.create(jobId, { productId });

  res.json({
    success: true,
    jobId,
    message: '生成任务已启动'
  });

  (async () => {
    try {
      const content = await generateContent(productId, { jobId });
      generationJob.complete(jobId, content);
    } catch (err) {
      console.error('内容生成失败:', err);
      const message = err instanceof Error ? err.message : String(err);
      generationJob.append(jobId, `错误: ${message}`);
      generationJob.fail(jobId, message);
    }
  })();
});

// 查询生成任务状态与日志（需在动态 :id 路由之前注册）
router.get('/generate-job/:jobId', (req, res) => {
  const job = generationJob.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      message: '任务不存在或已过期'
    });
  }
  res.json({
    success: true,
    status: job.status,
    logs: job.logs,
    data: job.result,
    error: job.error
  });
});

// 获取内容详情
router.get('/:id', async (req, res) => {
  try {
    const content = await contentQueries.getById(parseInt(req.params.id));

    if (!content) {
      return res.status(404).json({ success: false, message: '内容不存在' });
    }

    const product = await productQueries.getById(content.product_id);

    res.json({
      success: true,
      data: { ...content, product }
    });
  } catch (err) {
    console.error('获取内容详情失败:', err);
    res.status(500).json({ success: false, message: '获取内容详情失败: ' + err.message });
  }
});

// 更新内容
router.put('/:id', async (req, res) => {
  try {
    const { aiTextTitle, aiTextBody, aiTextTags } = req.body;

    await contentQueries.update(parseInt(req.params.id), {
      aiTextTitle,
      aiTextBody,
      aiTextTags: aiTextTags ? JSON.stringify(aiTextTags) : undefined
    });

    res.json({
      success: true,
      message: '内容更新成功'
    });
  } catch (err) {
    console.error('更新内容失败:', err);
    res.status(500).json({ success: false, message: '更新内容失败: ' + err.message });
  }
});

// 重新生成图片
router.post('/:id/regenerate-image', async (req, res) => {
  try {
    const result = await regenerateImage(parseInt(req.params.id));
    res.json({
      success: true,
      data: result,
      message: '图片重新生成成功'
    });
  } catch (err) {
    console.error('图片重新生成失败:', err);
    res.status(500).json({
      success: false,
      message: '图片重新生成失败: ' + err.message
    });
  }
});

// 重新生成文案
router.post('/:id/regenerate-text', async (req, res) => {
  try {
    const result = await regenerateText(parseInt(req.params.id));
    res.json({
      success: true,
      data: result,
      message: '文案重新生成成功'
    });
  } catch (err) {
    console.error('文案重新生成失败:', err);
    res.status(500).json({
      success: false,
      message: '文案重新生成失败: ' + err.message
    });
  }
});

module.exports = router;
