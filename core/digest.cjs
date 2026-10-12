const { createHash } = require('node:crypto');
const { stableStringify } = require('./stable-json.cjs');

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sha256Json(value) {
  return sha256Text(stableStringify(value));
}

module.exports = { sha256Text, sha256Json };
