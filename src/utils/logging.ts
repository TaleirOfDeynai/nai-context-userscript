import * as rx from "rxjs";
import * as rxop from "./rxop";

interface LoggerMessage {
  origin: string;
  type: "info" | "warn" | "error" | "dir";
  data: any[];
}

/** A small interface for working with performance measurements. */
interface StopWatch {
  /** Begins measuring performance. */
  start(): void;
  /** Stops measuring performance. */
  stop(): void;
}

/**
 * An operator function for setting up performance measurement of
 * some {@link rx.Observable Observable}.
 */
interface MeasureStreamOperator<T> extends rx.OperatorFunction<T, T> {
  /** Additionally creates a mark each time an item is emitted. */
  markItems<U>(
    /** A function used to add a label to the mark using data from the item. */
    labeler?: (item: U, index: number) => string
  ): rx.OperatorFunction<U, U>;
}

let loggingEnabled = false;
const omegaLogger = new rx.Subject<LoggerMessage>();

class Logger {
  #origin: string;
  #stream: rx.Subject<LoggerMessage>;
  
  constructor(origin: string) {
    this.#origin = origin;
    this.#stream = new rx.Subject();
    this.#stream.subscribe(omegaLogger);
  }

  info = (...data: any[]) => {
    this.#stream.next({ origin: this.#origin, type: "info", data });
  };
  warn = (...data: any[]) => {
    this.#stream.next({ origin: this.#origin, type: "info", data });
  };
  error = (...data: any[]) => {
    this.#stream.next({ origin: this.#origin, type: "info", data });
  };
  dir = (...data: Parameters<Console["dir"]>) => {
    this.#stream.next({ origin: this.#origin, type: "info", data });
  };
  mark = (name: string) => {
    performance.mark(`[${this.#origin}] ${name}`);
  };

  /**
   * Creates a stop watch to track the performance of some operation.
   * Use `start` to being tracking time and `stop` to end the measurement.
   */
  stopWatch(
    /** The name of this measurement. */
    name: string
  ): StopWatch {
    if (!loggingEnabled) return { start: rx.noop, stop: rx.noop };

    const NAME = `[${this.#origin}] ${name}`;
    const START = `[${this.#origin}] START ${name}`;
    const STOP = `[${this.#origin}] STOP ${name}`;
    let started = false;
  
    return {
      start: () => {
        if (!started) {
          started = true;
          performance.mark(START);
          return;
        }
        this.warn(`Measurement \`${name}\` already started.`);
      },
      stop: () => {
        if (started) {
          started = false;
          performance.mark(STOP);
          const measurement = performance.measure(NAME, START, STOP);
          this.info(measurement);
          return;
        }
        this.warn(`Measurement \`${name}\` not yet started.`);
      }
    };
  }

  /** Measures the performance of the operations within a given function. */
  async measureAsync<T>(
    /** The name of this measurement. */
    name: string,
    /** A zero-arity function to call after measurement has begun. */
    task: () => Promise<T>
  ): Promise<T> {
    if (!loggingEnabled) return await task();

    const stopWatch = this.stopWatch(name);
    stopWatch.start();
    const result = await task();
    stopWatch.stop();
    return result;
  }

  measureStream<T>(
    name: string
  ): MeasureStreamOperator<T> {
    if (!loggingEnabled) {
      return Object.assign((source) => source, {
        markItems: () => (source) => source
      });
    }

    const forCold = this.stopWatch(`${name} (Cold)`);
    const forHot = this.stopWatch(`${name} (Hot)`);

    const operatorFn = <T>(source: rx.ObservableInput<T>) => {
      const observable = rx.from(source);
      let state: "cold" | "hot" | "done" = "cold";

      const onFinished = () => {
        switch (state) {
          case "cold":
            forCold.stop();
            break;
          case "hot":
            forHot.stop();
            break;
        }
        state = "done";
      };

      forCold.start();
      return observable.pipe(
        rxop.connect((shared) => {
          if (state === "cold") {
            forCold.stop();
            state = "hot";
            forHot.start();
          }

          shared.subscribe({
            complete: onFinished,
            error: onFinished
          });
          return shared;
        })
      );
    };

    return Object.assign(operatorFn, {
      markItems: <T>(labeler?: (item: T, index: number) => string) => (source: rx.ObservableInput<T>) => {
        let index = 0;
        return operatorFn(source).pipe(
          rxop.tap((item) => {
            const label = labeler?.(item, index) ?? String(index);
            this.mark(`${name} - ${label}`);
            index += 1;
          })
        );
      }
    })
  }
}

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

export const createLogger = (origin: string): Logger => new Logger(origin);

export const enableLogging = (): void => (loggingEnabled = true, void 0);