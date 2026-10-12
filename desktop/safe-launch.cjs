const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SESSION_FILE = 'runtime-session.json';

class SafeLaunchManager {
  constructor(userData, options = {}) {
    this.userData = userData;
    this.filePath = path.join(userData, SESSION_FILE);
    this.cliSafeMode = options.cliSafeMode === true;
    this.sessionId = randomUUID();
    this.state = {
      schemaVersion: 1,
      sessionId: this.sessionId,
      phase: 'starting',
      failureCount: 0,
      lastExitClean: true,
      lastRunStartedAt: new Date().toISOString(),
      lastRunExitedAt: null,
      reason: null
    };
    this.activeSafeMode = false;
    this.wasUnclean = false;
  }

  async readSession() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && data.schemaVersion === 1) {
        return data;
      }
      this.markerDamaged=true; return {phase:'damaged',failureCount:0};
    } catch (error) {
      if(error.code !== 'ENOENT') { this.markerDamaged=true; return {phase:'damaged', failureCount:0}; }
      return null;
    }
  }

  async writeSession(data) {
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempPath, this.filePath);
  }

  async init() {
    const prev = await this.readSession();
    let failureCount = 0;
    let wasUnclean = false;

    if (prev) {
      if (prev.phase !== 'clean') {
        wasUnclean = true;
        failureCount = (typeof prev.failureCount === 'number' ? prev.failureCount : 0) + 1;
      } else {
        failureCount = 0;
        wasUnclean = false;
      }
    }

    this.wasUnclean = wasUnclean;
    const shouldSafe = this.cliSafeMode || wasUnclean || this.markerDamaged === true;
    this.activeSafeMode = shouldSafe;

    this.state = {
      schemaVersion: 1,
      sessionId: this.sessionId,
      phase: 'running',
      failureCount,
      lastExitClean: !wasUnclean,
      lastRunStartedAt: new Date().toISOString(),
      lastRunExitedAt: null,
      reason: this.cliSafeMode
        ? 'CLI_FLAG'
        : failureCount >= 2
        ? 'CONSECUTIVE_UNRECOVERED_CRASHES'
        : wasUnclean
        ? 'UNCLEAN_EXIT'
        : null
    };

    await this.writeSession(this.state);
    return this.status();
  }

  status() {
    return {
      safeMode: this.activeSafeMode,
      cliSafeMode: this.cliSafeMode,
      wasUnclean: this.wasUnclean,
      needsStartupChoice: this.wasUnclean && !this.cliSafeMode && !this.startupChoiceMade,
      markerDamaged: this.markerDamaged === true,
      failureCount: this.state.failureCount,
      reason: this.state.reason,
      sessionId: this.sessionId
    };
  }

  async enterSafeMode(reason = 'USER_REQUESTED') {
    this.activeSafeMode = true;
    this.startupChoiceMade=true;
    this.state.reason = reason;
    await this.writeSession(this.state);
    return this.status();
  }

  async exitSafeMode() {
    this.activeSafeMode = false;
    this.startupChoiceMade=true;
    this.state.reason = null;
    this.state.failureCount = 0;
    await this.writeSession(this.state);
    return this.status();
  }

  async recordCleanExit() {
    this.state.phase = 'clean';
    this.state.lastExitClean = true;
    this.state.failureCount = 0;
    this.state.lastRunExitedAt = new Date().toISOString();
    try {
      await this.writeSession(this.state);
    } catch {
      // ignore during shutdown
    }
  }
}

module.exports = { SafeLaunchManager, SESSION_FILE };
