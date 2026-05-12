# 模拟器爬虫使用指南

## 一、环境要求

| 组件 | 版本要求 | 安装方式 |
|------|---------|---------|
| Node.js | 16+ | 已有 |
| Python | 3.8+ | [python.org](https://python.org) 下载 |
| mitmproxy | 最新版 | `pip install mitmproxy` |
| ADB | 1.0+ | Android SDK Platform Tools |
| MuMu 模拟器 | 最新版 | [mumu.163.com](https://mumu.163.com) |
| 得物 App | 最新版 | 模拟器内安装 |

## 二、首次配置（5 分钟）

### 2.1 安装 mitmproxy

```bash
pip install mitmproxy
```

验证安装：
```bash
mitmproxy --version
```

### 2.2 配置模拟器 ADB

1. 打开 MuMu 模拟器 → 设置 → 其他设置 → 开启「ADB 调试」
2. 连接 ADB：
```bash
adb connect 127.0.0.1:7555
adb devices
```
应看到 `127.0.0.1:7555 device`

### 2.3 安装得物 CA 证书（关键步骤）

得物使用 HTTPS，需要安装 mitmproxy 的 CA 证书才能解密流量。

**步骤：**

1. 启动 mitmproxy：
```bash
mitmproxy -p 8080
```

2. 在模拟器中设置代理：
```bash
adb shell settings put global http_proxy 10.0.2.2:8080
```

3. 在模拟器浏览器中访问：`http://mitm.it`

4. 点击「Android」下载 CA 证书

5. 进入模拟器 设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书 → 选择下载的文件

6. 验证：打开得物 App，mitmproxy 应能看到 API 请求

7. 清除代理（测试完后）：
```bash
adb shell settings put global http_proxy :0
```

> **注意**：如果得物有证书固定（Certificate Pinning），需要额外安装 Xposed + JustTrustMe 模块，或使用 Magisk + LSPosed 方案绕过。

### 2.4 安装 ADBKeyboard（可选，推荐）

得物搜索框需要输入中文，ADB 原生不支持中文输入。安装 ADBKeyboard 可解决：

1. 下载 ADBKeyboard APK：https://github.com/nicholascao/ADBKeyBoard/releases
2. 安装到模拟器：
```bash
adb install ADBKeyboard.apk
```
3. 设置为默认输入法：
```bash
adb shell ime set com.android.adbkeyboard/.AdbIME
```

## 三、日常使用

### 3.1 启动服务

```bash
cd jiaoben
npm start
```

访问 http://localhost:3008

### 3.2 抓取商品

1. 在首页左侧找到「数据源」下拉框
2. 选择「模拟器 (MuMu + mitmproxy)」
3. 点击「抓取新商品」
4. 等待自动完成（约 2-3 分钟）

### 3.3 抓取流程说明

```
点击抓取
  → 启动 mitmproxy 代理（后台运行）
  → ADB 设置模拟器代理
  → ADB 启动得物 App
  → 自动搜索 5 个品类的关键词（球鞋/服饰/美妆/毛绒/盲盒）
  → 自动浏览社区推荐页
  → mitmproxy 拦截 API 请求并解析 JSON
  → 下载商品图片到本地
  → 数据写入 SQLite 数据库
  → 清除代理，关闭 mitmproxy
  → 页面自动刷新显示新商品
```

### 3.4 切换数据源

如果模拟器抓取失败，可以切换到网页爬虫：

1. 数据源选择「网页 (Puppeteer)」
2. 点击抓取

网页爬虫使用 Puppeteer 渲染得物搜索页，但数据质量不如模拟器方案。

## 四、文件说明

```
src/scraper/
├── emulator.js    # 模拟器爬虫主入口
├── adb.js         # ADB 命令封装
├── proxy.py       # mitmproxy 拦截脚本
├── parser.js      # API 数据解析
├── dewu.js        # 网页爬虫（备选方案）
src/config/
├── categories.js  # 品类配置（新增品类改这里）
src/data/
├── captured.json  # mitmproxy 拦截到的原始数据（临时文件）
```

## 五、故障排查

### 5.1 ADB 连接失败

```
错误：cannot connect to 127.0.0.1:7555
```

**解决**：
1. 确认 MuMu 模拟器已启动
2. 确认 MuMu 设置中「ADB 调试」已开启
3. 尝试：`adb kill-server && adb connect 127.0.0.1:7555`

### 5.2 mitmproxy 启动失败

```
错误：mitmproxy: command not found
```

**解决**：
```bash
pip install mitmproxy
# 或
python -m mitmproxy --version
```

### 5.3 证书固定（抓不到数据）

现象：mitmproxy 启动了但看不到得物 API 请求

**原因**：得物 App 使用了证书固定（Certificate Pinning）

**解决方案（按难度排序）**：

1. **方案 A：Root + Xposed**
   - MuMu 开启 Root
   - 安装 Edxposed/LSPosed
   - 安装 JustTrustMe 模块
   - 重启得物 App

2. **方案 B：Frida 绕过**
   - 安装 Frida Server 到模拟器
   - 使用 Frida 脚本绕过 SSL Pinning
   - 复杂度较高，需要 Frida 经验

3. **方案 C：降级到网页爬虫**
   - 选择「网页」数据源
   - 数据质量较低但可用

### 5.4 中文输入失败

现象：搜索框输入的是乱码或空

**解决**：
1. 安装 ADBKeyboard（见 2.4 节）
2. 或手动在模拟器中输入搜索词

### 5.5 拦截到数据但解析为空

现象：`captured.json` 有数据但解析后商品数为 0

**原因**：得物 API 响应格式与解析规则不匹配

**解决**：
1. 查看 `src/data/captured.json` 中的原始数据结构
2. 修改 `src/scraper/proxy.py` 中的 `extract_products_from_json` 函数
3. 或修改 `src/scraper/parser.js` 中的解析逻辑

### 5.6 页面上看不到「数据源」选择器

**原因**：浏览器缓存了旧的前端文件

**解决**：Ctrl+F5 强制刷新页面

## 六、添加新品类

1. 编辑 `src/config/categories.js`，在 `CATEGORIES` 中添加：
```js
newcategory: {
  key: 'newcategory',
  label: '新分类',
  badge: '新分类',
  icon: '🏷️',
  keywords: ['关键词1', '关键词2']
}
```

2. 在 `CATEGORY_ORDER` 数组中添加 `'newcategory'`

3. 重启服务，新品类自动出现在：
   - 侧边栏筛选
   - 商品卡片 badge
   - 爬虫搜索关键词
   - AI 生图/文案 prompt

## 七、API 接口

### POST /api/products/scrape

触发爬虫任务。

**请求体**：
```json
{
  "source": "emulator"  // 或 "web"
}
```

**响应**：
```json
{
  "success": true,
  "message": "模拟器爬虫任务已启动，请稍后刷新查看结果"
}
```

## 八、性能参考

| 指标 | 模拟器方案 | 网页方案 |
|------|-----------|---------|
| 单次抓取耗时 | 2-3 分钟 | 30-60 秒 |
| 数据质量 | 高（真实 API 数据） | 中（页面解析） |
| 图片质量 | 高（原始图片 URL） | 中（可能被限流） |
| 稳定性 | 中（依赖模拟器） | 低（依赖得物 API） |
| 依赖项 | Python + ADB + 模拟器 | Node.js + Puppeteer |
