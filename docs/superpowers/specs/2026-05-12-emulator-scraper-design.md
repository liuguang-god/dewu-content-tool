# 模拟器爬虫设计方案

## 背景

得物网站是 SPA（客户端渲染），普通 HTTP 请求无法获取商品数据。用户已在 MuMu 模拟器中安装了得物 App。本方案通过 mitmproxy 拦截 App API 请求 + ADB 自动化操控 App，实现真实商品数据抓取。

## 目标

1. 抓取得物热搜商品数据（名称、价格、图片URL、商品链接）
2. 抓取得物社区种草帖子数据（标题、图片、内容、互动数据）
3. 数据自动写入现有 SQLite 数据库，与现有 AI 生成流程无缝衔接
4. 手动触发，后续可扩展为定时任务

## 架构

```
┌──────────────────────────────────────────────────┐
│              Node.js 主应用                        │
│  POST /api/products/scrape → emulator.js          │
│                                                    │
│  ┌─────────┐    ┌──────────┐    ┌──────────────┐ │
│  │ adb.js  │───→│ 模拟器    │───→│ 得物 App     │ │
│  │ (控制)  │    │ MuMu     │    │ (被操控)     │ │
│  └─────────┘    └────┬─────┘    └──────┬───────┘ │
│                      │ 代理             │ API 请求 │
│                      ↓                  ↓         │
│               ┌──────────┐    ┌─────────────────┐│
│               │mitmproxy │←───│ 得物 API 服务器  ││
│               │(拦截)    │    └─────────────────┘│
│               └────┬─────┘                       │
│                    ↓ JSON                         │
│              ┌──────────┐                        │
│              │parser.js │                        │
│              │(解析)    │                        │
│              └────┬─────┘                        │
│                   ↓                              │
│              ┌──────────┐                        │
│              │ SQLite   │                        │
│              └──────────┘                        │
└──────────────────────────────────────────────────┘
```

## 新增文件

| 文件 | 职责 |
|------|------|
| `src/scraper/emulator.js` | 主入口，编排整个抓取流程 |
| `src/scraper/proxy.py` | mitmproxy 脚本，拦截并解析得物 API |
| `src/scraper/adb.js` | ADB 命令封装（连接、截图、点击、滑动、代理设置） |
| `src/scraper/parser.js` | API JSON 数据解析，映射到数据库字段 |

## 详细设计

### 1. adb.js — ADB 命令封装

```js
// 核心函数
connect()                    // 连接模拟器 adb connect 127.0.0.1:7555
setProxy(host, port)         // 设置代理 adb shell settings put global http_proxy
clearProxy()                 // 清除代理
tap(x, y)                    // 点击坐标
swipe(x1, y1, x2, y2, ms)   // 滑动
screenshot() → Buffer        // 截图返回 Buffer
getCurrentActivity() → string // 获取当前 Activity
launchApp(packageName)       // 启动得物 App
```

**关键实现细节**：
- MuMu 模拟器默认 ADB 端口：`127.0.0.1:7555`
- 截图命令：`adb exec-out screencap -p`（返回 PNG 二进制）
- 代理设置：`adb shell settings put global http_proxy 10.0.2.2:8080`（10.0.2.2 是模拟器访问宿主机的地址）
- 坐标需要根据模拟器分辨率适配（默认 1080x1920）

### 2. proxy.py — mitmproxy 拦截脚本

```python
# mitmproxy 启动命令：mitmproxy -s proxy.py -p 8080
# 拦截得物 API 请求，解析 JSON 并写入文件供 Node.js 读取

import json, os, time

CAPTURED_DATA = []  # 内存缓冲
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '../data/captured.json')

def response(flow):
    """拦截所有响应"""
    url = flow.request.pretty_url
    # 只处理得物 API 响应
    if 'dewu.com' not in url:
        return
    if not any(kw in url for kw in ['search', 'goods', 'spu', 'community', 'note', 'feed', 'home']):
        return

    try:
        data = json.loads(flow.response.text)
        CAPTURED_DATA.append({
            'url': url,
            'timestamp': time.time(),
            'data': data
        })
        # 实时写入文件
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(CAPTURED_DATA, f, ensure_ascii=False)
    except:
        pass
```

**拦截的 API 关键词**：
- 商品搜索：`search`, `goods`, `spu`, `product`
- 社区内容：`community`, `note`, `feed`, `home`
- 排除静态资源：只处理 JSON 响应

### 3. parser.js — 数据解析

将拦截到的 JSON 数据映射到数据库 schema：

```js
// 商品数据解析
function parseProducts(apiResponses) {
  // 得物 API 响应格式可能有多种结构，需要适配：
  // 1. { data: { list: [...] } }
  // 2. { data: { goodsList: [...] } }
  // 3. { data: { spuList: [...] } }

  const products = [];
  for (const resp of apiResponses) {
    const items = extractItems(resp.data);
    for (const item of items) {
      products.push({
        name: item.spuName || item.name || item.title,
        category: inferCategoryFromName(item.spuName || item.name || '') || 'plush',
        price: parsePrice(item.price || item.minPrice),
        imageUrl: item.mainPic || item.image || item.picUrl,
        productUrl: buildProductUrl(item.spuId || item.id),
        hotScore: item.hotScore || item.likeCount || 80
      });
    }
  }
  return deduplicate(products);
}
```

**得物 API 响应格式适配**：
- 需要先手动抓包确认实际格式
- 支持多种可能的数据结构
- 价格字段通常以「分」为单位，需要除以 100

### 4. emulator.js — 主流程编排

```js
async function scrapeAll(options) {
  // 1. 启动 mitmproxy 子进程
  const proxyProcess = spawn('mitmproxy', ['-s', 'proxy.py', '-p', '8080']);

  // 2. 连接模拟器，设置代理
  await adb.connect();
  await adb.setProxy('10.0.2.2', '8080');

  // 3. 启动得物 App
  await adb.launchApp('com.shizhuang.duapp');
  await sleep(5000); // 等待 App 启动

  // 4. 自动浏览不同品类页面
  const categories = ['球鞋', '服饰', '美妆', '潮玩'];
  for (const cat of categories) {
    await navigateToCategory(cat);
    await sleep(3000);
    await scrollDown(3); // 滑动加载更多
  }

  // 5. 浏览社区推荐页
  await navigateToCommunity();
  await sleep(3000);
  await scrollDown(5);

  // 6. 读取拦截到的数据
  const captured = readCapturedData();
  const products = parser.parseProducts(captured);

  // 7. 清理：清除代理，关闭 mitmproxy
  await adb.clearProxy();
  proxyProcess.kill();

  // 8. 下载图片，写入数据库
  await downloadAndSave(products, options);
}
```

**ADB 自动化导航流程**：
1. 启动得物 App
2. 点击搜索框 → 输入品类关键词 → 搜索
3. 等待结果加载 → 截图确认
4. 向下滑动 3 次（加载更多商品）
5. 返回首页 → 点击「社区」Tab
6. 向下滑动 5 次（加载更多帖子）
7. 完成

### 5. 与现有系统集成

**修改 `src/routes/products.js`**：
- `POST /api/products/scrape` 路由根据配置选择爬虫：
  - `source=web` → 使用现有 `dewu.js`（Puppeteer 方式）
  - `source=emulator` → 使用新 `emulator.js`（模拟器方式，默认）

**修改 `server.js`**：
- 首页路由传递 `scrapeSource` 配置给模板
- 前端抓取按钮可选择数据源

**数据库**：无需修改，`products` 表的 `category TEXT` 字段已支持任意品类。

### 6. 错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| 模拟器未连接 | 提示用户启动 MuMu 并开启 ADB |
| ADB 连接失败 | 自动重试 3 次，失败后报错 |
| mitmproxy 启动失败 | 检查 Python 环境，提示安装 |
| 代理设置失败 | 尝试手动设置，失败后降级到 Puppeteer |
| App 未安装 | 检查包名，提示用户安装得物 App |
| API 无数据 | 等待 5 秒重试，最多 3 次 |
| 证书固定（HTTPS 拦截失败） | 提示用户安装 CA 证书，或降级到截图 OCR |
| 数据解析失败 | 跳过当前条目，继续处理下一条 |

### 7. 环境依赖

```
Python 3.8+          # mitmproxy 运行环境
mitmproxy            # pip install mitmproxy
ADB                  # 已安装（Android SDK Platform Tools）
MuMu 模拟器          # 已安装，已开启 ADB 调试
得物 App             # 已安装在模拟器中
```

**首次配置步骤**：
1. 启动 mitmproxy：`mitmproxy -p 8080`
2. 模拟器设置代理：`adb shell settings put global http_proxy 10.0.2.2:8080`
3. 浏览器访问 `mitm.it`，安装 CA 证书到模拟器
4. 验证：打开得物 App，mitmproxy 应能看到 API 请求

### 8. 测试验证

1. 手动启动 mitmproxy，确认能拦截得物 API 请求
2. 运行 `npm run scrape`，确认 ADB 能操控模拟器
3. 检查数据库中是否有真实商品数据（带图片URL）
4. 检查商品详情页链接是否指向真实得物页面
5. 对抓取到的商品执行 AI 生成，确认流程正常
