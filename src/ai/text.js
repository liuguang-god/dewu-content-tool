const axios = require('axios');
const { getCategoryLabel } = require('../config/categories');

const DASHSCOPE_API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

// 文案生成 Prompt
function getCopywritingPrompt(productName, category, price) {
  const categoryName = getCategoryLabel(category);

  return `你是一个专业的得物社区种草博主，擅长写吸引人的种草笔记。

请为以下商品写一篇得物社区种草笔记：

商品名称：${productName}
商品品类：${categoryName}
${price ? `参考价格：¥${price}` : ''}

要求：
1. 标题：15-20字，吸引眼球，可以用emoji
2. 正文：200字左右，口语化，有感染力
3. 内容包含：商品亮点、使用场景、个人感受
4. 适当使用emoji增加可读性
5. 标签：3-5个相关标签

请严格按照以下JSON格式输出，不要输出其他内容：
{
  "title": "标题内容",
  "body": "正文内容",
  "tags": ["标签1", "标签2", "标签3"]
}`;
}

/**
 * @param {string} productName
 * @param {string} category
 * @param {number|string|null|undefined} price
 * @param {(msg: string) => void} [log]
 */
async function generateText(productName, category, price, log) {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey || apiKey === 'sk-xxxxxxxxxxxxxxxxxxxxxxxx') {
    throw new Error('请先配置 DASHSCOPE_API_KEY 环境变量');
  }

  const L = typeof log === 'function' ? log : (msg) => console.log(msg);

  const prompt = getCopywritingPrompt(productName, category, price);

  try {
    L('[文案] 正在调用通义千问生成种草文案…');

    const response = await axios.post(DASHSCOPE_API_URL, {
      model: 'qwen-turbo',
      input: {
        messages: [
          {
            role: 'system',
            content: '你是一个专业的得物社区种草博主，擅长写吸引人的种草笔记。请始终用中文回复。'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      parameters: {
        temperature: 0.8,
        top_p: 0.9
      }
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const content = response.data.output?.text || response.data.output?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('文案生成失败: ' + JSON.stringify(response.data));
    }

    // 解析JSON
    let parsed;
    try {
      // 尝试提取JSON部分
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('无法解析JSON');
      }
    } catch (parseErr) {
      // 如果解析失败，返回默认格式
      parsed = {
        title: `${productName} 种草推荐`,
        body: content,
        tags: ['#潮玩', '#种草', '#好物推荐']
      };
    }

    L('[文案] AI 文案生成完成');

    return {
      title: parsed.title || `${productName} 种草推荐`,
      body: parsed.body || content,
      tags: Array.isArray(parsed.tags) ? parsed.tags : ['#潮玩', '#种草'],
      prompt: prompt
    };

  } catch (err) {
    console.error('AI 文案生成失败:', err.message);
    throw err;
  }
}

module.exports = { generateText };
