const { getDb, saveDb } = require('./init');

// 数据库初始化标志
let dbInitialized = false;

// 辅助函数：等待数据库初始化
async function getReadyDb() {
  const db = await getDb();
  if (!dbInitialized) {
    // 数据库已初始化
    dbInitialized = true;
  }
  return db;
}

// 辅助函数：将查询结果转为对象数组
async function queryAll(sql, params = []) {
  const db = await getReadyDb();
  if (!db) return [];

  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

async function queryOne(sql, params = []) {
  const results = await queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

// 商品相关查询
const productQueries = {
  // 插入商品
  async insert(product) {
    const db = await getReadyDb();
    db.run(
      `INSERT INTO products (name, category, price, image_url, local_image_path, product_url, hot_score, source_channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [product.name, product.category, product.price, product.imageUrl, product.localImagePath, product.productUrl, product.hotScore, product.sourceChannel || '']
    );
    const id = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
    saveDb();
    return { lastInsertRowid: id };
  },

  // 批量插入（忽略重复）
  async insertMany(products) {
    const db = await getReadyDb();
    for (const product of products) {
      try {
        // 为什么：我们用 product_url 去重；重复抓取时需要更新价格/热度/图片路径，而不是忽略写入
        db.run(
          `INSERT INTO products (name, category, price, image_url, local_image_path, product_url, hot_score, source_channel)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(product_url) DO UPDATE SET
             name = excluded.name,
             category = excluded.category,
             price = excluded.price,
             image_url = excluded.image_url,
             local_image_path = COALESCE(excluded.local_image_path, products.local_image_path),
             hot_score = excluded.hot_score,
             source_channel = CASE WHEN excluded.source_channel != '' THEN excluded.source_channel ELSE products.source_channel END,
             updated_at = CURRENT_TIMESTAMP`,
          [product.name, product.category, product.price, product.imageUrl, product.localImagePath || null, product.productUrl, product.hotScore, product.sourceChannel || '']
        );
      } catch (e) {
        // 忽略重复
      }
    }
    saveDb();
  },

  // 只保留最近 N 天的商品，避免越抓越多导致页面/资源请求风暴
  async deleteOlderThanDays(days) {
    const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 7;
    const db = await getReadyDb();
    db.run(
      `DELETE FROM products
       WHERE datetime(created_at) < datetime('now', ?)`,
      [`-${safeDays} days`]
    );
    saveDb();
  },

  // 获取所有商品（支持分页和筛选）
  async getAll({ category, status, sourceChannel, page = 1, limit = 20 } = {}) {
    const db = await getReadyDb();
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (sourceChannel) {
      sql += ' AND source_channel = ?';
      params.push(sourceChannel);
    }

    sql += ' ORDER BY hot_score DESC, created_at DESC';
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    return await queryAll(sql, params);
  },

  // 获取单个商品
  async getById(id) {
    return await queryOne('SELECT * FROM products WHERE id = ?', [id]);
  },

  // 获取商品数量
  async count({ category, status, sourceChannel } = {}) {
    const db = await getReadyDb();
    let sql = 'SELECT COUNT(*) as count FROM products WHERE 1=1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (sourceChannel) {
      sql += ' AND source_channel = ?';
      params.push(sourceChannel);
    }

    const result = await queryOne(sql, params);
    return result ? result.count : 0;
  },

  // 按来源频道分组计数
  async channelCounts() {
    const results = await queryAll(
      `SELECT source_channel, COUNT(*) as count FROM products
       WHERE source_channel != '' GROUP BY source_channel`
    );
    const counts = {};
    for (const r of results) {
      counts[r.source_channel] = r.count;
    }
    return counts;
  },

  // 更新商品状态
  async updateStatus(id, status) {
    const db = await getReadyDb();
    db.run('UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);
    saveDb();
  }
};

// 内容相关查询
const contentQueries = {
  // 插入内容
  async insert(content) {
    const db = await getReadyDb();
    db.run(
      `INSERT INTO contents (product_id, ai_image_url, ai_text_title, ai_text_body, ai_text_tags)
       VALUES (?, ?, ?, ?, ?)`,
      [content.productId, content.aiImageUrl, content.aiTextTitle, content.aiTextBody, content.aiTextTags]
    );
    const id = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
    saveDb();
    return { lastInsertRowid: id };
  },

  // 获取商品的内容
  async getByProductId(productId) {
    return await queryAll('SELECT * FROM contents WHERE product_id = ? ORDER BY created_at DESC', [productId]);
  },

  // 获取最新内容
  async getLatestByProductId(productId) {
    return await queryOne('SELECT * FROM contents WHERE product_id = ? ORDER BY created_at DESC LIMIT 1', [productId]);
  },

  // 获取单个内容
  async getById(id) {
    return await queryOne('SELECT * FROM contents WHERE id = ?', [id]);
  },

  /** 最近内容（用于 /preview、/export 入口列表） */
  async listRecentWithProduct(limit = 30) {
    const n = Math.min(100, Math.max(1, Number(limit) || 30));
    return await queryAll(
      `SELECT c.id, c.product_id, c.ai_text_title, c.updated_at, c.created_at, p.name AS product_name
       FROM contents c
       LEFT JOIN products p ON p.id = c.product_id
       ORDER BY datetime(COALESCE(c.updated_at, c.created_at)) DESC
       LIMIT ?`,
      [n]
    );
  },

  // 更新内容
  async update(id, content) {
    const db = await getReadyDb();
    const fields = [];
    const params = [];

    if (content.aiImageUrl !== undefined) {
      fields.push('ai_image_url = ?');
      params.push(content.aiImageUrl);
    }
    if (content.aiTextTitle !== undefined) {
      fields.push('ai_text_title = ?');
      params.push(content.aiTextTitle);
    }
    if (content.aiTextBody !== undefined) {
      fields.push('ai_text_body = ?');
      params.push(content.aiTextBody);
    }
    if (content.aiTextTags !== undefined) {
      fields.push('ai_text_tags = ?');
      params.push(content.aiTextTags);
    }
    if (content.status !== undefined) {
      fields.push('status = ?');
      params.push(content.status);
    }

    if (fields.length === 0) return null;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const sql = `UPDATE contents SET ${fields.join(', ')} WHERE id = ?`;
    db.run(sql, params);
    saveDb();
  }
};

module.exports = { productQueries, contentQueries };