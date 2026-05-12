const { generateImage } = require('../ai/image');
const { generateText } = require('../ai/text');
const { contentQueries, productQueries } = require('../db/queries');
const generationJob = require('./generationJob');

/**
 * @param {number} productId
 * @param {{ jobId?: string }} [options]
 */
async function generateContent(productId, options = {}) {
  const { jobId } = options;

  const log = (msg) => {
    console.log(msg);
    if (jobId) {
      generationJob.append(jobId, msg);
    }
  };

  const product = await productQueries.getById(productId);

  if (!product) {
    throw new Error('商品不存在');
  }

  log(`开始为商品 "${product.name}" 生成内容...`);

  // 并行调用AI生图和文案（日志可能交错，属正常现象）
  const [imageResult, textResult] = await Promise.allSettled([
    generateImage(product.name, product.category, log),
    generateText(product.name, product.category, product.price, log)
  ]);

  const content = {
    productId: product.id,
    aiImageUrl: null,
    aiTextTitle: null,
    aiTextBody: null,
    aiTextTags: null
  };

  // 处理生图结果
  if (imageResult.status === 'fulfilled') {
    content.aiImageUrl = imageResult.value.imageUrl;
    log('AI 生图完成');
  } else {
    const msg = imageResult.reason?.message || String(imageResult.reason);
    console.error('AI 生图失败:', msg);
    log(`AI 生图失败: ${msg}`);
  }

  // 处理文案结果
  if (textResult.status === 'fulfilled') {
    content.aiTextTitle = textResult.value.title;
    content.aiTextBody = textResult.value.body;
    content.aiTextTags = JSON.stringify(textResult.value.tags);
    log('种草文案已就绪');
  } else {
    const msg = textResult.reason?.message || String(textResult.reason);
    console.error('AI 文案生成失败:', msg);
    log(`AI 文案生成失败: ${msg}`);
  }

  // 存入数据库
  const result = contentQueries.insert(content);

  // 更新商品状态
  await productQueries.updateStatus(product.id, 'processed');

  log('内容已保存，商品状态已更新。');

  return {
    id: (await result).lastInsertRowid,
    ...content,
    product
  };
}

async function regenerateImage(contentId) {
  const content = await contentQueries.getById(contentId);
  if (!content) {
    throw new Error('内容不存在');
  }

  const product = await productQueries.getById(content.product_id);
  if (!product) {
    throw new Error('商品不存在');
  }

  const imageResult = await generateImage(product.name, product.category);

  await contentQueries.update(contentId, {
    aiImageUrl: imageResult.imageUrl
  });

  return {
    imageUrl: imageResult.imageUrl,
    prompt: imageResult.prompt
  };
}

async function regenerateText(contentId) {
  const content = await contentQueries.getById(contentId);
  if (!content) {
    throw new Error('内容不存在');
  }

  const product = await productQueries.getById(content.product_id);
  if (!product) {
    throw new Error('商品不存在');
  }

  const textResult = await generateText(product.name, product.category, product.price);

  await contentQueries.update(contentId, {
    aiTextTitle: textResult.title,
    aiTextBody: textResult.body,
    aiTextTags: JSON.stringify(textResult.tags)
  });

  return {
    title: textResult.title,
    body: textResult.body,
    tags: textResult.tags
  };
}

module.exports = { generateContent, regenerateImage, regenerateText };
