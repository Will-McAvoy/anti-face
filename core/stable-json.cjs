function stableStringify(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('稳定序列化拒绝非有限数字');
    return JSON.stringify(value);
  }
  if (type !== 'object') throw new TypeError('稳定序列化遇到无法编码的值');
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

module.exports = { stableStringify };
