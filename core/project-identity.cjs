const { sha256Text } = require('./digest.cjs');

function normalizeProjectPath(input, platform = 'win32') {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value || value.length > 1024 || /[\u0000-\u001f]/.test(value)) return null;
  const windows = platform === 'win32';
  value = windows ? value.replace(/\//g, '\\') : value.replace(/\\/g, '/');
  const unc = windows && /^\\\\[^\\]/.test(value);
  let prefix = '';
  if (windows && /^[A-Za-z]:/.test(value)) {
    prefix = `${value[0].toUpperCase()}:`;
    value = value.slice(2);
  } else if (unc) {
    prefix = '\\\\';
    value = value.replace(/^\\+/, '');
  }
  const separator = windows ? '\\' : '/';
  const stack = [];
  for (const part of value.split(separator)) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length) stack.pop();
      continue;
    }
    stack.push(windows ? part.toLowerCase() : part);
  }
  if (!stack.length && !prefix) return null;
  const body = stack.join(separator);
  if (prefix.endsWith(':')) return body ? `${prefix}\\${body}` : `${prefix}\\`;
  if (unc) return body ? `\\\\${body}` : null;
  return body || null;
}

function basename(normalized, platform = 'win32') {
  const separator = platform === 'win32' ? '\\' : '/';
  const parts = normalized.split(separator).filter(Boolean);
  return parts[parts.length - 1] || '项目';
}

function identifyProject(source, platform = 'win32') {
  if (!source || typeof source !== 'object') {
    return { status: 'unknown', reliable: false, confidence: 'none', reason: 'missing' };
  }
  const workspaceId = typeof source.workspaceId === 'string' ? source.workspaceId.trim() : '';
  if (/^[A-Za-z0-9_.:-]{1,128}$/.test(workspaceId)) {
    return {
      status: 'identified',
      reliable: true,
      confidence: 'high',
      identityKind: 'workspace',
      identityVersion: 1,
      projectKey: `workspace:${workspaceId}`,
      displayHint: `工作区 ${workspaceId.slice(0, 8)}`
    };
  }
  const normalized = normalizeProjectPath(source.projectPath, platform);
  if (normalized) {
    const digest = sha256Text(`${platform}:${normalized}`).slice(0, 24);
    return {
      status: 'identified',
      reliable: true,
      confidence: 'high',
      identityKind: 'path',
      identityVersion: 1,
      projectKey: `path:${digest}`,
      normalizedPath: normalized,
      displayHint: basename(normalized, platform)
    };
  }
  return { status: 'unknown', reliable: false, confidence: 'none', reason: 'no-stable-id' };
}

module.exports = { normalizeProjectPath, identifyProject };
