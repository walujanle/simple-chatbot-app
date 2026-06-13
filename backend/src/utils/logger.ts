type LogFields = Record<string, unknown>;

function writeLog(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  const output = level === "info" ? process.stdout : process.stderr;
  output.write(`${entry}\n`);
}

export function logInfo(event: string, fields?: LogFields): void {
  writeLog("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  writeLog("warn", event, fields);
}

export function logError(event: string, fields?: LogFields): void {
  writeLog("error", event, fields);
}
