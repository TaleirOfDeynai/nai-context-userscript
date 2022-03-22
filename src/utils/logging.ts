import { Subject } from "rxjs";

interface LoggerMessage {
  origin: string;
  type: "info" | "warn" | "error" | "dir";
  data: any[];
}

interface Logger {
  name: string;
  info(...data: any[]): void;
  warn(...data: any[]): void;
  error(...data: any[]): void;
  dir(item?: any, options?: any): void;
  push(data: LoggerMessage): void;
}

let loggingEnabled = false;
const omegaLogger = new Subject<LoggerMessage>();

omegaLogger.forEach(({ origin, type, data }) => {
  switch (type) {
    case "info": return console.info(`[${origin}]`, ...data);
    case "warn": return console.warn(`[${origin}]`, ...data);
    case "error": return console.error(`[${origin}]`, ...data);
    case "dir": {
      if (data.length === 0) return;
      console.log(`[${origin}]:`);
      return console.dir(...data);
    }
  }
});

export function createLogger(origin: string): Logger {
  const logStream = new Subject<LoggerMessage>();
  const push = (data: Omit<LoggerMessage, "origin">) => {
    if (!loggingEnabled) return;
    logStream.next({ ...data, origin });
  };

  const theLogger = {
    push,
    name: origin,
    info: (...data) => push({ type: "info", data }),
    warn: (...data) => push({ type: "warn", data }),
    error: (...data) => push({ type: "error", data }),
    dir: (...data) => push({ type: "dir", data })
  };

  logStream.subscribe(omegaLogger);
  return theLogger;
}

export function enableLogging() {
  loggingEnabled = true;
}