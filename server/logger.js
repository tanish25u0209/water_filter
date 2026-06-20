/**
 * logger.js
 *
 * Tiny timestamped logger shared by every module in this project.
 * Keeps log output consistent ("when did this happen + what kind of
 * message is it") without pulling in a full logging framework.
 */

function info(...args) {
  console.log(new Date().toISOString(), '[INFO]', ...args);
}

function warn(...args) {
  console.warn(new Date().toISOString(), '[WARN]', ...args);
}

function error(...args) {
  console.error(new Date().toISOString(), '[ERROR]', ...args);
}

module.exports = { info, warn, error };
