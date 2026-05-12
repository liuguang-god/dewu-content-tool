const axios = require('axios');

const DASHSCOPE_API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';

// 种草风格 Prompt 模板：优先模拟真实买家随手拍，降低 AI 棚拍和插画感
const PROMPT_TEMPLATES = {
  sneakers: [
    '{productName}球鞋摆在普通家用书桌上，旁边有鞋盒和说明卡片，手机实拍照片，自然光，真实开箱场景，鞋面材质纹理清晰',
    '真实买家晒单，{productName}球鞋放在地板上，旁边有日常穿搭的裤子和袜子，手机拍摄视角，自然室内光，生活感十足',
    '{productName}球鞋穿在脚上的真实照片，站在普通地砖或木地板上，手机俯拍角度，自然光，日常穿搭实拍',
    '手持{productName}球鞋的细节展示，背景为家中衣柜或鞋架，手机近距离拍摄，鞋面缝线和材质清晰可见，真实光线'
  ],
  clothing: [
    '{productName}衣服挂在普通家用衣架上，背景有衣柜和生活杂物，手机实拍，自然光，真实家居环境',
    '真实买家试穿{productName}的镜子自拍，背景为普通卧室或试衣间，手机拍摄，自然光，穿搭分享风格',
    '{productName}衣服平铺在床上，旁边搭配了裤子和配饰，手机俯拍，自然光，真实搭配展示',
    '穿着{productName}的日常出街照，背景为普通街道或咖啡店，手机拍摄，自然光，生活穿搭实拍'
  ],
  beauty: [
    '{productName}化妆品摆在普通梳妆台上，旁边有化妆镜和其他日用品，手机实拍，自然光，真实使用场景',
    '手持{productName}的特写照片，背景为家中窗户自然光，手机近距离拍摄，产品细节清晰，真实质感',
    '{productName}化妆品平铺在白色桌面上，旁边有化妆刷和收纳盒，手机俯拍，自然光，美妆博主晒单风格',
    '{productName}试色或试用效果展示，手臂/嘴唇试色，手机近距离拍摄，自然光，真实肤色和质感'
  ],
  plush: [
    '{productName}毛绒玩偶放在真实卧室窗边的木质床头柜上，旁边有日常使用的水杯、纸巾和几本书，手机实拍照片，自然晨光，轻微阴影，背景略微杂乱但干净',
    '真实买家晒单照片，{productName}毛绒玩偶靠在布艺沙发角落，旁边有抱枕和毯子，室内自然光，手机拍摄视角，毛绒材质细节真实，有轻微景深',
    '{productName}毛绒玩偶摆在普通家用书桌上，桌面有充电线、便签、马克杯等生活物品，得物社区真实种草实拍，非专业棚拍，光线来自窗户',
    '手持{productName}毛绒玩偶的真实生活照片，只露出自然手部和部分桌面，背景为家中卧室或客厅，手机摄影，构图略随意，真实毛绒纹理'
  ],
  blindbox: [
    '真实买家开箱照片，{productName}盲盒和拆开的包装盒放在普通桌面上，旁边有说明卡、塑料内托和纸屑，手机实拍，自然室内光，开箱现场感',
    '{productName}系列手办摆在家中书桌或展示架上，背景有键盘、书本和生活杂物，得物晒单风格，真实环境光，非商业摄影',
    '手拿刚拆出的{productName}盲盒手办，桌面保留外盒和包装袋，手机近距离实拍，画面有轻微噪点和自然阴影，真实开箱瞬间',
    '{productName}手办放在普通家用桌面上做细节展示，旁边有日常小物作为比例参照，手机拍摄，真实材质反光，背景自然虚化'
  ]
};

const REAL_PHOTO_SUFFIX = [
  '整体像普通用户用手机拍下的真实商品照片',
  '不要卡通插画',
  '不要 3D 渲染',
  '不要 CG 质感',
  '不要过度磨皮',
  '不要完美广告大片构图',
  '不要塑料玩具般的虚假光泽',
  '画面允许轻微噪点、轻微曝光不均和真实生活痕迹'
].join('，');

function getRandomPrompt(category, productName) {
  const templates = PROMPT_TEMPLATES[category] || PROMPT_TEMPLATES.plush;
  const template = templates[Math.floor(Math.random() * templates.length)];
  return `${template.replace(/{productName}/g, productName)}，${REAL_PHOTO_SUFFIX}`;
}

/**
 * @param {string} productName
 * @param {string} category
 * @param {(msg: string) => void} [log]
 */
async function generateImage(productName, category, log) {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey || apiKey === 'sk-xxxxxxxxxxxxxxxxxxxxxxxx') {
    throw new Error('请先配置 DASHSCOPE_API_KEY 环境变量');
  }

  const L = typeof log === 'function' ? log : (msg) => console.log(msg);

  const prompt = getRandomPrompt(category, productName);

  try {
    // 提交任务
    const submitResponse = await axios.post(DASHSCOPE_API_URL, {
      model: 'wanx-v1',
      input: {
        prompt: prompt
      },
      parameters: {
        size: '1024*1024',
        n: 1
      }
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable'
      }
    });

    const taskId = submitResponse.data.output?.task_id;

    if (!taskId) {
      throw new Error('提交生图任务失败: ' + JSON.stringify(submitResponse.data));
    }

    L(`生图任务已提交，任务ID: ${taskId}`);

    // 轮询等待结果
    let result = null;
    let attempts = 0;
    const maxAttempts = 60; // 最多等待5分钟

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // 每5秒查询一次

      const queryResponse = await axios.get(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        }
      );

      const status = queryResponse.data.output?.task_status;

      if (status === 'SUCCEEDED') {
        result = queryResponse.data.output.results[0]?.url;
        break;
      } else if (status === 'FAILED') {
        throw new Error('生图任务失败: ' + JSON.stringify(queryResponse.data));
      }

      attempts++;
      L(`等待生图完成... (${attempts}/${maxAttempts})`);
    }

    if (!result) {
      throw new Error('生图任务超时');
    }

    return {
      imageUrl: result,
      prompt: prompt
    };

  } catch (err) {
    console.error('AI 生图失败:', err.message);
    throw err;
  }
}

module.exports = { generateImage };
