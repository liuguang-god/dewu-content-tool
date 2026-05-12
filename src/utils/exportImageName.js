'use strict';

/** 文件名中不允许的字符（含 Windows 保留字符） */
const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 生成导出图片的下载文件名：@image 前缀 + 商品名（单段文件名，避免跨域直链时 download 属性无效、以及 Content-Disposition 中斜杠兼容问题）。
 * @param {string | null | undefined} productName
 * @returns {string} 例如 @image_Labubu花之精灵红色.png
 */
function buildAtImageDownloadName(productName) {
  let base = productName != null && String(productName).trim() ? String(productName).trim() : '商品';
  base = base.replace(ILLEGAL_FILE_CHARS, '_').replace(/\s+/g, ' ').trim();
  if (!base) base = '商品';
  if (base.length > 120) base = base.slice(0, 120).trim();
  return `@image_${base}.png`;
}

module.exports = { buildAtImageDownloadName };
