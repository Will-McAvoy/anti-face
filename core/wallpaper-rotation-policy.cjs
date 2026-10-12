const { appError } = require('./errors.cjs');

const ALLOWED_ORDERS = new Set(['sequential', 'shuffle']);
const MIN_INTERVAL_SECONDS = 60; // 最短 1 分钟
const DEFAULT_INTERVAL_SECONDS = 900; // 默认 15 分钟

function validateRotationConfig(raw = {}) {
  const enabled = raw.enabled === true;
  const folderRef = typeof raw.folderRef === 'string' ? raw.folderRef.trim() : '';
  const order = ALLOWED_ORDERS.has(raw.order) ? raw.order : 'sequential';
  let intervalSeconds = typeof raw.intervalSeconds === 'number' && Number.isFinite(raw.intervalSeconds)
    ? Math.round(raw.intervalSeconds)
    : DEFAULT_INTERVAL_SECONDS;
  if (intervalSeconds < MIN_INTERVAL_SECONDS) {
    intervalSeconds = MIN_INTERVAL_SECONDS;
  }
  const recursive = raw.recursive === true;

  return {
    enabled,
    folderRef,
    order,
    intervalSeconds,
    recursive
  };
}

/**
 * Fisher-Yates 洗牌（支持可注入随机数生成器以保证确定性测试）
 */
function shuffleArray(array, rng = Math.random) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 维持无重复 Shuffle Bag 的下一项选择
 * @param {Array<string>} items - 候选列表
 * @param {number} currentIndex - 顺序模式下的当前索引
 * @param {'sequential' | 'shuffle'} order
 * @param {object} shuffleState - { remaining: string[], lastItem: string | null }
 * @param {object} [options] - { rng }
 * @returns {{ nextIndex: number, nextItem: string | null, nextShuffleState: object }}
 */
function selectNextCandidate(items, currentIndex = -1, order = 'sequential', shuffleState = null, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      nextIndex: -1,
      nextItem: null,
      nextShuffleState: { remaining: [], lastItem: null }
    };
  }

  if (items.length === 1) {
    return {
      nextIndex: 0,
      nextItem: items[0],
      nextShuffleState: { remaining: [items[0]], lastItem: items[0] }
    };
  }

  if (order === 'sequential') {
    const nextIndex = (currentIndex + 1) % items.length;
    return {
      nextIndex,
      nextItem: items[nextIndex],
      nextShuffleState: { remaining: [], lastItem: items[nextIndex] }
    };
  }

  // Shuffle 模式：Shuffle Bag（一轮用尽前不重复，跨轮首尾不连续相同）
  const rng = options.rng || Math.random;
  let remaining = Array.isArray(shuffleState?.remaining) ? [...shuffleState.remaining] : [];
  let lastItem = shuffleState?.lastItem || null;

  // 过滤掉已不在 items 中的项
  const itemSet = new Set(items);
  remaining = remaining.filter(item => itemSet.has(item));

  if (remaining.length === 0) {
    // 重新洗牌
    let newBag = shuffleArray(items, rng);
    // 如果首项和上一轮最后一项相同，且有多个元素，则把首项换到后面
    if (newBag.length > 1 && newBag[0] === lastItem) {
      const temp = newBag[0];
      newBag[0] = newBag[newBag.length - 1];
      newBag[newBag.length - 1] = temp;
    }
    remaining = newBag;
  }

  const nextItem = remaining.shift();
  const nextIndex = items.indexOf(nextItem);

  return {
    nextIndex,
    nextItem,
    nextShuffleState: {
      remaining,
      lastItem: nextItem
    }
  };
}

/**
 * 计算下次轮换时间（睡眠唤醒不追赶，最多触发一次）
 */
function computeNextRotationTime(lastRotationTime, intervalSeconds, now) {
  if (!lastRotationTime || lastRotationTime <= 0) {
    return now + intervalSeconds * 1000;
  }
  const intervalMs = intervalSeconds * 1000;
  const target = lastRotationTime + intervalMs;
  if (now >= target) {
    // 已经超时（如系统休眠），立即触发，并将下一次重置为 now + intervalMs
    return now;
  }
  return target;
}

module.exports = {
  MIN_INTERVAL_SECONDS,
  DEFAULT_INTERVAL_SECONDS,
  validateRotationConfig,
  shuffleArray,
  selectNextCandidate,
  computeNextRotationTime
};
