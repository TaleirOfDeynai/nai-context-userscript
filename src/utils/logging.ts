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
  mark(name: string): void;
  measure(name: string): {
    start(): void;
    stop(): void;
  }
}

type PushFn = (data: Omit<LoggerMessage, "origin">) => void;

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

const createMark = (origin: string) => (name: string): void => {
  performance.mark(`[${origin}] ${name}`);
};

const createMeasure = (origin: string, push: PushFn) => (name: string) => {
  const START = `[${origin}] ${name}-start`;
  const STOP = `[${origin}] ${name}-stop`;
  let started = false;

  return {
    start: () => {
      if (!started) {
        started = true;
        performance.mark(START);
        return;
      }
      push({ type: "warn", data: [`Measurement \`${name}\` already started.`] });
    },
    stop: () => {
      if (started) {
        started = false;
        performance.mark(STOP);
        const measurement = performance.measure(name, START, STOP);
        push({ type: "info", data: [measurement] });
        return;
      }
      push({ type: "warn", data: [`Measurement \`${name}\` not yet started.`] });
    }
  }
};

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
    dir: (...data) => push({ type: "dir", data }),
    mark: createMark(origin),
    measure: createMeasure(origin, push)
  };

  logStream.subscribe(omegaLogger);
  return theLogger;
}

export function enableLogging() {
  loggingEnabled = true;
}