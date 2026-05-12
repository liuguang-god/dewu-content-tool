const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/app.db');

let db;

async function getDb() {
  if (!db) {
    const SQL = await initSqlJs();

    // 如果数据库文件存在，读取它
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    initTables();
  }
  return db;
}

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL,
      image_url TEXT,
      local_image_path TEXT,
      product_url TEXT,
      hot_score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 用于去重：同一商品链接只保留一条记录（允许 NULL 重复）。
  // 兼容旧数据：如果历史数据里已有重复链接，先清理再建唯一索引。
  try {
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_product_url_unique
      ON products(product_url)
    `);
  } catch (err) {
    // 为什么：旧库可能在无唯一约束下累积了重复 product_url，直接建索引会失败。
    // 处理策略：保留同一 product_url 的最新一条记录（按 id 最大），删除其余重复项。
    db.run(`
      DELETE FROM products
      WHERE product_url IS NOT NULL
        AND id NOT IN (
          SELECT MAX(id) FROM products
          WHERE product_url IS NOT NULL
          GROUP BY product_url
        )
    `);
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_product_url_unique
      ON products(product_url)
    `);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      ai_image_url TEXT,
      ai_text_title TEXT,
      ai_text_body TEXT,
      ai_text_tags TEXT,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // 保存数据库
  saveDb();
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

module.exports = { getDb, saveDb };
