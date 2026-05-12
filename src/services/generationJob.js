/**
 * In-memory generation job store for surfacing server-side logs to the UI.
 * Entries expire after TTL to avoid unbounded growth.
 */

const TTL_MS = 15 * 60 * 1000;

/** @type {Map<string, { status: string, logs: Array<{ t: number, message: string }>, meta: object, result: object | null, error: string | null, createdAt: number }>} */
const jobs = new Map();

function prune() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > TTL_MS) {
      jobs.delete(id);
    }
  }
}

/**
 * @param {string} jobId
 * @param {object} [meta]
 */
function create(jobId, meta = {}) {
  prune();
  jobs.set(jobId, {
    status: 'running',
    logs: [],
    meta,
    result: null,
    error: null,
    createdAt: Date.now()
  });
}

/**
 * @param {string} jobId
 * @param {string} message
 */
function append(jobId, message) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.logs.push({ t: Date.now(), message: String(message) });
}

/**
 * @param {string} jobId
 * @param {object} result
 */
function complete(jobId, result) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.status = 'done';
  job.result = result;
}

/**
 * @param {string} jobId
 * @param {string} message
 */
function fail(jobId, message) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.status = 'error';
  job.error = String(message);
}

/**
 * @param {string} jobId
 */
function get(jobId) {
  prune();
  return jobs.get(jobId) || null;
}

module.exports = {
  create,
  append,
  complete,
  fail,
  get
};
