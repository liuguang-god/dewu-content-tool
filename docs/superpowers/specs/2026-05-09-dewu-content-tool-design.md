# 得物种草自动化工具 - 设计文档

## 项目概述

一个自动化工具，用于抓取得物平台热门潮玩商品，通过 AI 生成种草图片和文案，帮助用户快速产出得物社区种草内容，获取创作收益。

## 目标用户

得物社区创作者，希望通过批量产出优质种草内容获取平台创作收益。

## 核心功能

1. **商品抓取** - 自动抓取得物热门毛绒玩偶和盲盒系列商品
2. **AI 生图** - 使用通义万相生成种草风格图片
3. **文案生成** - 使用通义千问生成得物社区种草文案
4. **内容预览** - Web 界面预览和编辑生成内容
5. **一键导出** - 下载图片、复制文案，准备发布素材

## 目标品类

- **毛绒玩偶**：Labubu、Jellycat、黄油小熊、chiikawa 等
- **盲盒系列**：Molly、Dimoo、SKULLPANDA、小野 HIRONO 等

## 技术架构

### 整体架构

单体 Node.js 应用，Express 服务 + EJS 模板 + SQLite 数据库。

```
┌─────────────────────────────────────────────────┐
│                   Web 前端 (EJS/HTML)            │
│         商品浏览 │ 内容预览 │ 一键导出            │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              Express.js 服务 (后端)               │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 商品爬虫  │ │ AI 生图   │ │  文案生成        │ │
│  │ 模块     │ │ 模块      │ │  模块            │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │          SQLite 数据库 (商品+内容)            ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### 技术栈

| 组件 | 技术选型 | 说明 |
|------|---------|------|
| 后端框架 | Node.js + Express | 轻量高效 |
| 前端模板 | EJS + Bootstrap | 无需构建，快速开发 |
| 数据库 | SQLite | 零配置，本地存储 |
| 爬虫 | Puppeteer | 处理 SPA 动态渲染 |
| AI 生图 | 通义万相 API | 国内免费额度 |
| AI 文案 | 通义千问 API | 中文效果好 |
| 配置管理 | dotenv | API Key 管理 |

## 核心模块设计

### 模块 1：商品爬虫

**功能描述：**
抓取得物网页版热门商品信息，存储到本地数据库。

**抓取字段：**
- 商品名称
- 商品价格
- 商品图片 URL
- 商品详情页链接
- 热度/销量指标
- 所属品类

**抓取策略：**
- 数据源：得物网页版商品列表页
- 触发方式：手动触发 / 定时任务
- 请求间隔：随机 2-5 秒
- User-Agent 轮换
- 代理池支持（可选）

**输出：**
商品数据存入 SQLite `products` 表，图片下载到 `public/images/products/`。

### 模块 2：AI 生图

**功能描述：**
基于商品信息，调用通义万相 API 生成种草风格图片。

**生成流程：**
1. 用户选择商品
2. 系统根据商品信息构建 Prompt
3. 调用通义万相 API
4. 返回图片预览
5. 用户可重新生成

**Prompt 模板：**
```
一个可爱的{商品名}毛绒玩偶，放在温馨的书桌上，
旁边有小花瓶和书本，自然光，ins风格，种草氛围感
```

**API 配置：**
- 服务：阿里云 DashScope
- 模型：wanx-v1
- 图片尺寸：1024x1024
- 免费额度：每月一定次数

### 模块 3：文案生成

**功能描述：**
基于商品信息，调用通义千问 API 生成得物社区种草文案。

**文案风格：**
- 得物/小红书种草风格
- 带 emoji，口语化
- 有感染力，突出商品亮点
- 包含使用场景和个人感受

**生成内容：**
- 标题（吸引眼球，15-20字）
- 正文（种草文案，200字左右）
- 标签（#潮玩 #Labubu 等）

**Prompt 模板：**
```
请为以下商品写一篇得物社区种草笔记：
商品：{商品名}
品类：{品类}
价格：{价格}
要求：200字左右，带emoji，种草风格，包含商品亮点、使用场景、个人感受
输出格式JSON：{"title": "标题", "body": "正文", "tags": ["标签1", "标签2"]}
```

### 模块 4：Web 界面

**页面结构：**

| 页面 | 路由 | 功能 |
|------|------|------|
| 首页/商品列表 | GET / | 浏览抓取的热门商品，按品类筛选 |
| 商品详情 | GET /product/:id | 查看商品信息，触发AI生图和文案生成 |
| 内容预览 | GET /preview/:id | 预览生成的种草图+文案，可编辑调整 |
| 导出中心 | GET /export/:id | 复制文案、下载图片，准备发布素材 |

**交互流程：**
1. 首页浏览商品列表 → 点击商品进入详情
2. 商品详情页 → 点击"生成内容"按钮
3. 系统同时调用 AI 生图和文案生成
4. 跳转到预览页 → 查看生成结果
5. 可重新生成图片/文案，或手动编辑文案
6. 确认后 → 导出页面下载图片 + 复制文案

## 数据库设计

### products 表

```sql
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,        -- 'plush' 或 'blindbox'
  price REAL,
  image_url TEXT,                -- 得物原始图片URL
  local_image_path TEXT,         -- 本地下载的图片路径
  product_url TEXT,              -- 得物商品详情页链接
  hot_score INTEGER DEFAULT 0,   -- 热度分数
  status TEXT DEFAULT 'pending', -- pending/processed/published
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### contents 表

```sql
CREATE TABLE contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  ai_image_url TEXT,             -- AI生成的图片URL/路径
  ai_text_title TEXT,            -- AI生成的标题
  ai_text_body TEXT,             -- AI生成的正文
  ai_text_tags TEXT,             -- AI生成的标签(JSON数组)
  status TEXT DEFAULT 'draft',   -- draft/ready/exported
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

## 项目目录结构

```
dewu-content-tool/
├── server.js                    # Express 入口
├── package.json
├── .env                         # 环境变量(API Key)
├── .env.example                 # 环境变量示例
├── src/
│   ├── scraper/
│   │   └── dewu.js             # 得物爬虫
│   ├── ai/
│   │   ├── image.js            # 通义万相生图
│   │   └── text.js             # 通义千问文案
│   ├── routes/
│   │   ├── products.js         # 商品路由
│   │   └── contents.js         # 内容路由
│   ├── services/
│   │   └── contentGenerator.js # 内容生成服务(整合AI调用)
│   └── db/
│       ├── init.js             # 数据库初始化
│       └── queries.js          # 数据库查询封装
├── views/                       # EJS 模板
│   ├── layout.ejs              # 布局模板
│   ├── index.ejs               # 商品列表页
│   ├── product.ejs             # 商品详情页
│   ├── preview.ejs             # 内容预览页
│   └── export.ejs              # 导出页面
├── public/                      # 静态资源
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── main.js
│   └── images/
│       └── products/           # 下载的商品图片
└── data/
    └── app.db                  # SQLite 数据库文件
```

## API 接口设计

### 商品相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/products | 获取商品列表（支持分页、筛选） |
| GET | /api/products/:id | 获取商品详情 |
| POST | /api/products/scrape | 触发爬虫抓取新商品 |

### 内容相关

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/contents/generate/:productId | 生成商品的种草内容 |
| GET | /api/contents/:id | 获取生成的内容 |
| PUT | /api/contents/:id | 更新/编辑内容 |
| POST | /api/contents/:id/regenerate-image | 重新生成图片 |
| POST | /api/contents/:id/regenerate-text | 重新生成文案 |

## 环境配置

### .env 文件

```env
# 阿里云 DashScope API Key（通义万相 + 通义千问共用）
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# 服务配置
PORT=3000
NODE_ENV=development

# 爬虫配置
SCRAPE_INTERVAL=5000        # 请求间隔(ms)
MAX_PRODUCTS_PER_RUN=50     # 每次抓取最大商品数
```

## 风险与对策

| 风险 | 对策 |
|------|------|
| 得物反爬 | 请求间隔、UA轮换、代理池 |
| AI 生图质量不稳定 | 多次生成、Prompt 优化 |
| API 免费额度用完 | 监控调用次数、缓存结果 |
| 内容重复度过高 | 多样化 Prompt 模板 |

## MVP 范围

第一版优先实现：
1. ✅ 基础爬虫（手动触发）
2. ✅ AI 生图（通义万相）
3. ✅ AI 文案（通义千问）
4. ✅ Web 界面（商品列表 + 预览 + 导出）
5. ✅ SQLite 数据存储

后续迭代：
- 定时自动抓取
- 批量生成内容
- 更多品类支持
- 发布状态追踪
