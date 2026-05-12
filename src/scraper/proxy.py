"""
mitmproxy 脚本：拦截得物 App 的 API 请求，解析 JSON 并保存到文件
启动命令：mitmproxy -s proxy.py -p 8080
"""

import json
import os
import time
import re

# 数据存储
captured_data = {
    "products": [],     # 商品数据
    "community": [],    # 社区帖子数据
    "raw": []           # 所有拦截到的 API 响应
}

# 输出文件路径（Node.js 会读取此文件）
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OUTPUT_FILE = os.path.join(OUTPUT_DIR, 'captured.json')

# 得物 API URL 关键词匹配
PRODUCT_KEYWORDS = ['search', 'goods', 'spu', 'product', 'detail']
COMMUNITY_KEYWORDS = ['community', 'note', 'feed', 'home', 'recommend']
EXCLUDE_KEYWORDS = ['.css', '.js', '.png', '.jpg', '.webp', '.gif', '.svg', '.ico', 'log', 'report', 'stat']


def should_capture(url):
    """判断是否需要拦截此 URL"""
    url_lower = url.lower()
    # 排除静态资源和统计上报
    for kw in EXCLUDE_KEYWORDS:
        if kw in url_lower:
            return False
    # 只处理得物域名
    if 'dewu.com' not in url_lower and 'duapp' not in url_lower:
        return False
    return True


def is_product_api(url):
    """判断是否为商品相关 API"""
    url_lower = url.lower()
    return any(kw in url_lower for kw in PRODUCT_KEYWORDS)


def is_community_api(url):
    """判断是否为社区相关 API"""
    url_lower = url.lower()
    return any(kw in url_lower for kw in COMMUNITY_KEYWORDS)


def extract_products_from_json(data, url):
    """从 API 响应中提取商品数据"""
    products = []

    # 得物 API 响应可能有多种结构，逐层尝试提取
    items = []

    # 常见结构 1: { code: 0, data: { list: [...] } }
    if isinstance(data, dict):
        d = data.get('data', data)
        if isinstance(d, dict):
            for key in ['list', 'goodsList', 'spuList', 'items', 'resultList', 'goodsInfoList']:
                if key in d and isinstance(d[key], list):
                    items = d[key]
                    break

        # 常见结构 2: { data: { result: { goodsList: [...] } } }
        if not items and isinstance(d, dict):
            result = d.get('result', {})
            if isinstance(result, dict):
                for key in ['goodsList', 'list', 'spuList']:
                    if key in result and isinstance(result[key], list):
                        items = result[key]
                        break

        # 常见结构 3: data 本身是数组
        if not items and isinstance(d, list):
            items = d

    for item in items:
        if not isinstance(item, dict):
            continue
        name = (item.get('spuName') or item.get('name') or
                item.get('title') or item.get('goodsName') or '')
        if not name:
            continue

        # 价格：得物 API 通常以「分」为单位
        price_raw = item.get('price') or item.get('minPrice') or item.get('activityPrice') or 0
        price = float(price_raw) / 100 if price_raw and price_raw > 100 else float(price_raw)

        # 图片
        image = (item.get('mainPic') or item.get('image') or
                 item.get('picUrl') or item.get('coverUrl') or
                 item.get('logoUrl') or '')

        # 商品 ID 和链接
        spu_id = item.get('spuId') or item.get('id') or item.get('goodsId') or ''
        product_url = f'https://www.dewu.com/product/detail/{spu_id}' if spu_id else ''

        # 品牌
        brand = item.get('brandName') or item.get('brand') or ''

        # 热度/点赞
        hot_score = (item.get('hotScore') or item.get('likeCount') or
                     item.get('sales') or 80)

        products.append({
            'name': name.strip(),
            'price': round(price, 2) if price else None,
            'imageUrl': image,
            'productUrl': product_url,
            'brand': brand,
            'hotScore': int(hot_score) if hot_score else 80,
            'sourceUrl': url
        })

    return products


def extract_community_from_json(data, url):
    """从 API 响应中提取社区帖子数据"""
    posts = []

    items = []
    if isinstance(data, dict):
        d = data.get('data', data)
        if isinstance(d, dict):
            for key in ['list', 'noteList', 'feedList', 'items']:
                if key in d and isinstance(d[key], list):
                    items = d[key]
                    break

    for item in items:
        if not isinstance(item, dict):
            continue
        title = (item.get('title') or item.get('noteTitle') or
                 item.get('content') or '')[:100]
        if not title:
            continue

        # 图片列表
        images = []
        for img_key in ['images', 'pics', 'imageList', 'noteImages']:
            if img_key in item and isinstance(item[img_key], list):
                for img in item[img_key]:
                    if isinstance(img, dict):
                        images.append(img.get('url') or img.get('picUrl') or '')
                    elif isinstance(img, str):
                        images.append(img)
                break

        note_id = item.get('noteId') or item.get('id') or ''
        note_url = f'https://www.dewu.com/community/note/{note_id}' if note_id else ''

        likes = item.get('likeCount') or item.get('likes') or 0
        comments = item.get('commentCount') or item.get('comments') or 0

        posts.append({
            'title': title.strip(),
            'images': [img for img in images if img],
            'noteUrl': note_url,
            'likes': int(likes) if likes else 0,
            'comments': int(comments) if comments else 0,
            'sourceUrl': url
        })

    return posts


def response(flow):
    """mitmproxy 响应拦截钩子"""
    url = flow.request.pretty_url

    if not should_capture(url):
        return

    # 只处理 JSON 响应
    content_type = flow.response.headers.get('content-type', '')
    if 'json' not in content_type and 'javascript' not in content_type:
        return

    try:
        text = flow.response.text
        # 有些 API 返回 JSONP 或带前缀的 JSON
        text = text.strip()
        if text.startswith('(') and text.endswith(')'):
            text = text[1:-1]
        if text.startswith('callback('):
            text = text[9:-1]

        data = json.loads(text)

        # 保存原始数据
        captured_data['raw'].append({
            'url': url,
            'timestamp': time.time(),
            'data': data
        })

        # 提取商品数据
        if is_product_api(url):
            products = extract_products_from_json(data, url)
            captured_data['products'].extend(products)
            if products:
                print(f'[proxy] 捕获 {len(products)} 个商品: {url}')

        # 提取社区数据
        if is_community_api(url):
            posts = extract_community_from_json(data, url)
            captured_data['community'].extend(posts)
            if posts:
                print(f'[proxy] 捕获 {len(posts)} 条社区内容: {url}')

        # 实时写入文件
        save_to_file()

    except json.JSONDecodeError:
        pass
    except Exception as e:
        print(f'[proxy] 处理响应出错: {e}')


def save_to_file():
    """保存捕获数据到文件"""
    try:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(captured_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f'[proxy] 写入文件失败: {e}')


def done():
    """脚本结束时的清理"""
    save_to_file()
    print(f'[proxy] 会话结束，共捕获 {len(captured_data["products"])} 个商品，'
          f'{len(captured_data["community"])} 条社区内容')
