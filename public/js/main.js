// 主要JavaScript逻辑

document.addEventListener('DOMContentLoaded', function() {
  // 抓取按钮
  const scrapeBtn = document.getElementById('scrapeBtn');
  const scrapeBtnEmpty = document.getElementById('scrapeBtnEmpty');

  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', startScrape);
  }
  if (scrapeBtnEmpty) {
    scrapeBtnEmpty.addEventListener('click', startScrape);
  }

  // 生成按钮
  const generateBtn = document.getElementById('generateBtn');
  if (generateBtn) {
    generateBtn.addEventListener('click', generateContent);
  }

  // 重新生成按钮
  const regenerateImageBtn = document.getElementById('regenerateImageBtn');
  const regenerateTextBtn = document.getElementById('regenerateTextBtn');

  if (regenerateImageBtn) {
    regenerateImageBtn.addEventListener('click', regenerateImage);
  }
  if (regenerateTextBtn) {
    regenerateTextBtn.addEventListener('click', regenerateText);
  }

  // 复制和下载按钮
  const copyTextBtn = document.getElementById('copyTextBtn');
  const downloadImageBtn = document.getElementById('downloadImageBtn');

  if (copyTextBtn) {
    copyTextBtn.addEventListener('click', copyText);
  }
  // 导出页使用 #exportImg 与内联脚本处理下载，勿绑定依赖 #aiImage 的逻辑
  if (downloadImageBtn && document.getElementById('aiImage')) {
    downloadImageBtn.addEventListener('click', downloadImage);
  }

  // 历史记录点击
  const contentItems = document.querySelectorAll('.content-item');
  contentItems.forEach(item => {
    item.addEventListener('click', function() {
      const contentId = this.dataset.contentId;
      loadContent(contentId);
    });
  });
});

function setScrapeStatusVisible(visible) {
  const status = document.getElementById('scrapeStatus');
  if (!status) return;
  status.classList.toggle('visible', visible);
}

// 开始抓取
async function startScrape() {
  const btn = this;
  btn.disabled = true;
  setScrapeStatusVisible(true);

  try {
    const response = await fetch('/api/products/scrape', {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      showToast('success', data.message);
      // 3秒后刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } else {
      showToast('error', data.message);
    }
  } catch (err) {
    showToast('error', '抓取失败: ' + err.message);
  } finally {
    btn.disabled = false;
    setScrapeStatusVisible(false);
  }
}

// 生成内容（异步任务 + 轮询日志）
async function generateContent() {
  const btn = document.getElementById('generateBtn');
  const productId = btn.dataset.productId;
  const statusDiv = document.getElementById('generateStatus');
  const statusLine = document.getElementById('generateStatusLine');
  const consoleWrap = document.getElementById('generateConsole');
  const consoleBody = document.getElementById('generateConsoleBody');
  const consoleOrigin = document.getElementById('generateConsoleOrigin');
  const bodyWrap = document.getElementById('generateConsoleBodyWrap');
  const progressWrap = document.getElementById('generateConsoleProgress');
  const progressBar = document.getElementById('generateConsoleProgressBar');
  const progressLabel = document.getElementById('generateConsoleProgressLabel');
  const resultDiv = document.getElementById('generateResult');

  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 生成中...';
  statusDiv.style.display = 'block';
  if (statusLine) statusLine.style.display = 'block';
  resultDiv.style.display = 'none';

  let lastLogCount = 0;

  if (consoleWrap) {
    consoleWrap.style.display = 'block';
    if (consoleBody) consoleBody.innerHTML = '';
    if (consoleOrigin) consoleOrigin.textContent = window.location.origin || '';
    if (progressWrap) {
      progressWrap.hidden = true;
      progressBar.style.width = '0%';
      progressLabel.textContent = '';
    }
  }

  function appendConsoleLine(text) {
    if (!consoleBody) return;
    const line = document.createElement('div');
    line.className = 'generation-console-log-line';
    line.textContent = text;
    consoleBody.appendChild(line);
    if (bodyWrap) {
      bodyWrap.scrollTop = bodyWrap.scrollHeight;
    }
  }

  function updateProgressFromLogs(logs) {
    if (!progressWrap || !progressBar || !progressLabel) return;
    const joined = logs.map(function (l) { return l.message; }).join('\n');

    // 日志已出现「生图完成」时，进度条应对齐为完成态（避免仍停留在最后一次轮询的 5/60）
    if (joined.indexOf('AI 生图完成') !== -1) {
      progressWrap.hidden = false;
      progressBar.style.width = '100%';
      progressLabel.textContent = '生图已完成';
      return;
    }

    if (joined.indexOf('AI 生图失败') !== -1) {
      progressWrap.hidden = true;
      progressBar.style.width = '0%';
      progressLabel.textContent = '';
      return;
    }

    const re = /等待生图完成\.\.\. \((\d+)\/(\d+)\)/g;
    let m;
    let last = null;
    while ((m = re.exec(joined)) !== null) {
      last = m;
    }
    if (!last) {
      if (joined.indexOf('生图任务已提交') !== -1) {
        progressWrap.hidden = false;
        progressBar.style.width = '0%';
        progressLabel.textContent = '排队中…';
      } else {
        progressWrap.hidden = true;
      }
      return;
    }
    var cur = Number(last[1], 10);
    var max = Number(last[2], 10);
    progressWrap.hidden = false;
    var pct = max ? Math.min(100, Math.round((cur / max) * 100)) : 0;
    progressBar.style.width = pct + '%';
    progressLabel.textContent = cur + '/' + max;
  }

  try {
    var startRes = await fetch('/api/contents/generate/' + productId, {
      method: 'POST'
    });
    var startData = await startRes.json();

    if (!startData.success || !startData.jobId) {
      showToast('error', startData.message || '无法启动生成任务');
      return;
    }

    var jobId = startData.jobId;

    while (true) {
      var pollRes = await fetch('/api/contents/generate-job/' + jobId);
      var pollData = await pollRes.json();

      if (!pollData.success) {
        showToast('error', pollData.message || '任务查询失败');
        break;
      }

      var logs = pollData.logs || [];
      var i;
      for (i = lastLogCount; i < logs.length; i++) {
        appendConsoleLine(logs[i].message);
      }
      lastLogCount = logs.length;
      updateProgressFromLogs(logs);

      if (pollData.status === 'done') {
        displayResult(pollData.data);
        showToast('success', '内容生成成功！');
        break;
      }
      if (pollData.status === 'error') {
        showToast('error', pollData.error || '生成失败');
        break;
      }

      await new Promise(function (r) { setTimeout(r, 800); });
    }
  } catch (err) {
    showToast('error', '生成失败: ' + err.message);
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = '立即生成种草内容';
    if (statusLine) statusLine.style.display = 'none';
  }
}

// 显示生成结果（兼容接口返回的 camelCase 与数据库 snake_case）
function displayResult(content) {
  const resultDiv = document.getElementById('generateResult');
  const aiImage = document.getElementById('aiImage');
  const aiTitle = document.getElementById('aiTitle');
  const aiBody = document.getElementById('aiBody');
  const aiTags = document.getElementById('aiTags');

  const imgUrl = content.ai_image_url != null ? content.ai_image_url : content.aiImageUrl;
  const titleText = content.ai_text_title != null ? content.ai_text_title : content.aiTextTitle;
  const bodyText = content.ai_text_body != null ? content.ai_text_body : content.aiTextBody;
  const tagsRaw = content.ai_text_tags != null ? content.ai_text_tags : content.aiTextTags;

  // 保存内容ID用于后续操作
  resultDiv.dataset.contentId = content.id;

  // 设置图片
  if (imgUrl) {
    aiImage.src = imgUrl;
    aiImage.style.display = 'block';
  } else {
    aiImage.style.display = 'none';
  }

  // 设置文案
  aiTitle.textContent = titleText || '';
  aiBody.textContent = bodyText || '';

  // 设置标签
  let tags = [];
  try {
    tags = typeof tagsRaw === 'string' ? JSON.parse(tagsRaw || '[]') : Array.isArray(tagsRaw) ? tagsRaw : [];
  } catch (e) {
    tags = [];
  }
  aiTags.innerHTML = tags.map(tag => `<span class="tag">${tag}</span>`).join('');

  resultDiv.style.display = 'block';

  const previewLink = document.getElementById('previewLink');
  if (previewLink && content?.id) {
    previewLink.href = `/preview/${content.id}`;
    previewLink.style.display = 'inline-flex';
  }
}

// 重新生成图片
async function regenerateImage() {
  const resultDiv = document.getElementById('generateResult');
  const contentId = resultDiv.dataset.contentId;

  if (!contentId) {
    showToast('error', '请先生成内容');
    return;
  }

  const btn = document.getElementById('regenerateImageBtn');
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 生成中...';

  try {
    const response = await fetch(`/api/contents/${contentId}/regenerate-image`, {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      document.getElementById('aiImage').src = data.data.imageUrl;
      showToast('success', '图片重新生成成功');
    } else {
      showToast('error', data.message);
    }
  } catch (err) {
    showToast('error', '重新生成失败: ' + err.message);
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> 重新生成';
  }
}

// 重新生成文案
async function regenerateText() {
  const resultDiv = document.getElementById('generateResult');
  const contentId = resultDiv.dataset.contentId;

  if (!contentId) {
    showToast('error', '请先生成内容');
    return;
  }

  const btn = document.getElementById('regenerateTextBtn');
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 生成中...';

  try {
    const response = await fetch(`/api/contents/${contentId}/regenerate-text`, {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      document.getElementById('aiTitle').textContent = data.data.title;
      document.getElementById('aiBody').textContent = data.data.body;

      const tags = data.data.tags || [];
      document.getElementById('aiTags').innerHTML = tags.map(tag => `<span class="tag">${tag}</span>`).join('');

      showToast('success', '文案重新生成成功');
    } else {
      showToast('error', data.message);
    }
  } catch (err) {
    showToast('error', '重新生成失败: ' + err.message);
  } finally {
    btn.classList.remove('loading');
    btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> 重新生成';
  }
}

// 复制文案（商品详情页 #aiTitle / #aiBody / #aiTags）
function copyText() {
  const titleEl = document.getElementById('aiTitle');
  const bodyEl = document.getElementById('aiBody');
  const tagsEl = document.getElementById('aiTags');
  if (!titleEl || !bodyEl || !tagsEl) {
    showToast('error', '当前页面没有可复制的预览文案');
    return;
  }
  const title = titleEl.textContent;
  const body = bodyEl.textContent;
  const tags = tagsEl.textContent;

  const text = `${title}\n\n${body}\n\n${tags}`;

  navigator.clipboard.writeText(text).then(() => {
    showToast('success', '文案已复制到剪贴板');
  }).catch(() => {
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('success', '文案已复制到剪贴板');
  });
}

// 下载图片（商品详情页：同源代理 + Blob，以支持 @image_商品名 文件名）
async function downloadImage() {
  const img = document.getElementById('aiImage');
  const resultDiv = document.getElementById('generateResult');
  const btn = document.getElementById('downloadImageBtn');
  const contentId = resultDiv?.dataset?.contentId;
  const suggested = (btn && btn.getAttribute('data-download-name'))
    ? btn.getAttribute('data-download-name').trim()
    : '';

  if (!contentId) {
    showToast('error', '请先生成内容再下载');
    return;
  }
  if (!img || !img.getAttribute('src')) {
    showToast('error', '没有可下载的图片');
    return;
  }

  try {
    const r = await fetch(`/api/contents/${contentId}/download-image`);
    if (!r.ok) {
      let msg = '下载失败';
      try {
        const j = await r.json();
        if (j && j.message) msg = j.message;
      } catch (_) { /* ignore */ }
      showToast('error', msg);
      return;
    }
    const blob = await r.blob();
    const u = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = u;
    link.download = suggested || '@image_导出.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(u);
    showToast('success', '图片已下载');
  } catch (err) {
    showToast('error', '下载失败: ' + (err && err.message ? err.message : '网络错误'));
  }
}

// 加载历史内容
async function loadContent(contentId) {
  try {
    const response = await fetch(`/api/contents/${contentId}`);
    const data = await response.json();

    if (data.success) {
      displayResult(data.data);
    } else {
      showToast('error', data.message);
    }
  } catch (err) {
    showToast('error', '加载失败: ' + err.message);
  }
}

// 显示提示消息
function showToast(type, message) {
  // 创建toast容器
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  // 创建toast
  const toast = document.createElement('div');
  toast.className = `toast show bg-${type === 'success' ? 'success' : 'danger'} text-white`;
  toast.innerHTML = `
    <div class="toast-body">
      <i class="bi bi-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
      ${message}
    </div>
  `;

  container.appendChild(toast);

  // 3秒后移除
  setTimeout(() => {
    toast.remove();
  }, 3000);
}
