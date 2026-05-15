// 得物首页频道 Tab 坐标配置 (1080x1920 分辨率)
// 基于 2026-05-15 截图校准

const CHANNEL_TABS = {
  '推荐':     { x: 70,  y: 155 },
  '搞点好东西': { x: 220, y: 155 },
  '灵感':     { x: 390, y: 155 },
  '关注':     { x: 530, y: 155 },
  '视频':     { x: 640, y: 155 },
  '穿搭':     { x: 750, y: 155 },
  // 以下 Tab 需要先点击 ▼ 展开或左滑才可见
  '潮玩':     { x: 200, y: 210 },  // 展开后的第二行位置（估算）
  '数码':     { x: 400, y: 210 },
  '篮球':     { x: 600, y: 210 },
};

// ▼ 展开按钮坐标（点击后显示更多 Tab）
const EXPAND_ARROW = { x: 935, y: 155 };

// 默认抓取的频道
const DEFAULT_CHANNELS = ['穿搭', '潮玩'];

module.exports = { CHANNEL_TABS, DEFAULT_CHANNELS, EXPAND_ARROW };
