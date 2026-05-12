const EventEmitter = require('events');

class ScrapeProgress extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20);
    this.active = false;
    this.logs = [];
    this.steps = [];
    this.currentStep = '';
    this.progress = 0;
    this.total = 100;
    this.status = 'idle'; // idle | running | done | error
    this.error = null;
    this.startedAt = null;
    this.finishedAt = null;
  }

  start(source) {
    this.active = true;
    this.logs = [];
    this.steps = [];
    this.currentStep = '';
    this.progress = 0;
    this.status = 'running';
    this.error = null;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.source = source;
    this.emit('start', { source });
    this.log(`爬虫任务启动，数据源: ${source === 'emulator' ? '模拟器' : '网页'}`);
  }

  log(message, level = 'info') {
    const entry = { time: Date.now(), message, level };
    this.logs.push(entry);
    this.emit('log', entry);
  }

  step(name, detail) {
    this.currentStep = name;
    const entry = { name, detail };
    this.steps.push(entry);
    this.emit('step', entry);
  }

  setProgress(current, total) {
    this.progress = current;
    this.total = total;
    this.emit('progress', { current, total, percent: total ? Math.round(current / total * 100) : 0 });
  }

  succeed(message) {
    this.status = 'done';
    this.active = false;
    this.finishedAt = Date.now();
    this.log(message || '抓取完成');
    this.emit('done', { message, duration: this.finishedAt - this.startedAt });
  }

  fail(message) {
    this.status = 'error';
    this.active = false;
    this.error = message;
    this.finishedAt = Date.now();
    this.log(message, 'error');
    this.emit('error', { message, duration: this.finishedAt - this.startedAt });
  }

  toJSON() {
    return {
      active: this.active,
      status: this.status,
      source: this.source,
      currentStep: this.currentStep,
      progress: this.progress,
      total: this.total,
      percent: this.total ? Math.round(this.progress / this.total * 100) : 0,
      logs: this.logs,
      steps: this.steps,
      error: this.error,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      duration: this.finishedAt ? this.finishedAt - this.startedAt : (this.startedAt ? Date.now() - this.startedAt : 0)
    };
  }
}

// 全局单例
const scrapeProgress = new ScrapeProgress();

module.exports = { ScrapeProgress, scrapeProgress };
