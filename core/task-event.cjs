const { appError } = require('./errors.cjs');
const { randomUUID } = require('node:crypto');

const EVENT_TYPES = ['completed', 'failed', 'waiting_user', 'cancelled'];
const EVENT_SCOPES = ['task', 'step'];
const EVENT_PROVENANCES = ['real', 'fixture', 'preview'];
const CONFIDENCE_LEVELS = ['verified', 'unknown'];

function validateTaskNotificationEvent(event) {
  if (!event || typeof event !== 'object') {
    throw appError('INVALID_ARGUMENT', '事件必须是对象');
  }

  const type = EVENT_TYPES.includes(event.type) ? event.type : null;
  if (!type) {
    throw appError('INVALID_ARGUMENT', `不支持的事件类型: ${event.type}`);
  }

  const scope = EVENT_SCOPES.includes(event.scope) ? event.scope : 'task';
  const provenance = EVENT_PROVENANCES.includes(event.provenance) ? event.provenance : 'real';
  const confidence = CONFIDENCE_LEVELS.includes(event.confidence) ? event.confidence : 'unknown';

  if (!event.taskId && !event.runId) {
    throw appError('INVALID_ARGUMENT', '事件必须包含有效的 taskId 或 runId');
  }

  return {
    eventId: event.eventId || randomUUID(),
    sourceId: event.sourceId || 'default-source',
    provenance,
    taskId: event.taskId || event.runId || 'unidentified',
    runId: event.runId || event.taskId || 'unidentified',
    attemptId: event.attemptId || null,
    transitionId: event.transitionId || null,
    type,
    scope,
    confidence,
    occurredAt: event.occurredAt || null,
    observedAt: event.observedAt || new Date().toISOString(),
    targetInstanceId: event.targetInstanceId || null
  };
}

/**
 * 来源适配器能力声明规范
 */
function declareSourceCapabilities(sourceId, options = {}) {
  return {
    sourceId,
    supportsTaskCompleted: options.supportsTaskCompleted === true,
    supportsTaskFailed: options.supportsTaskFailed === true,
    supportsWaitingUser: options.supportsWaitingUser === true,
    evidenceDescription: options.evidenceDescription || '当前来源能力描述',
    restrictions: Array.isArray(options.restrictions) ? options.restrictions : []
  };
}

module.exports = {
  EVENT_TYPES,
  EVENT_SCOPES,
  EVENT_PROVENANCES,
  CONFIDENCE_LEVELS,
  validateTaskNotificationEvent,
  createTaskNotificationEvent: validateTaskNotificationEvent,
  declareSourceCapabilities
};
