import usConfig from "@config";
import * as rx from "./rx";
import * as rxop from "./rxop";
import { noop } from "./functions";
import { isThenable } from "./is";

import type { UndefOr } from "./utility-types";

interface LoggerMessage {
  origin: string;
  type: "info" | "warn" | "error" | "dir";
  data: any[];
}

interface AggregatedMeasurement {
  name: string;
  count: number;
  total: number;
  min: number;
  avg: number;
  max: number;
}

/** A small interface for working with performance measurements. */
interface StopWatch {
  /** Begins measuring performance. */
  start(): void;
  /** Stops measuring performance. */
  stop(logMeasurement?: boolean): void;
  /** Stops measuring performance and returns the measurement. */
  stopAndReport(): UndefOr<PerformanceMeasure>;
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

const omegaLogger = new rx.Subject<LoggerMessage>();

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

export interface ILogger {
  info(...data: any[]): void;
  warn(...data: any[]): void;
  error(...data: any[]): void;
  dir(...data: Parameters<Console["dir"]>): void;
  mark(name: string): void;

  /**
   * Creates a stop watch to track the performance of some operation.
   * Use `start` to being tracking time and `stop` to end the measurement.
   */
  stopWatch(
    /** The name of this measurement. */
    name: string
  ): StopWatch;

  /**
   * Wraps a function, measuring how long it takes to call it.
   * 
   * Works with both synchronous and asynchronous functions.
   */
  measureFn<T extends (this: unknown, ...args: any[]) => any>(
    /** The function implementation to measure. */
    fn: T,
    /** An optional name to present when logging. */
    givenName?: string
  ): T;

  /** Measures the performance of the operations within a given function. */
  measureAsync<T>(
    /** The name of this measurement. */
    name: string,
    /** A zero-arity function to call after measurement has begun. */
    task: () => Promise<T>
  ): Promise<T>;

  /**
   * Measures an {@link rx.Observable} and measures the time spent cold,
   * hot, and until completion.
   */
  measureStream<T>(
    /** The name of this measurement. */
    name: string
  ): MeasureStreamOperator<T>
}

class Logger implements ILogger {
  #origin: string;
  #stream: rx.Subject<LoggerMessage>;
  
  constructor(origin: string) {
    this.#origin = origin;
    this.#stream = new rx.Subject();
    this.#stream.subscribe(omegaLogger);
  }

  info = (...data: any[]) =>
    this.#stream.next({ origin: this.#origin, type: "info", data });
  warn = (...data: any[]) =>
    this.#stream.next({ origin: this.#origin, type: "info", data });
  error = (...data: any[]) =>
    this.#stream.next({ origin: this.#origin, type: "info", data });
  dir = (...data: Parameters<Console["dir"]>) =>
    this.#stream.next({ origin: this.#origin, type: "info", data });
  mark = (name: string) =>
    performance.mark(`[${this.#origin}] ${name}`);

  stopWatch(name: string): StopWatch {
    const NAME = `[${this.#origin}] ${name}`;
    const START = `[${this.#origin}] START ${name}`;
    const STOP = `[${this.#origin}] STOP ${name}`;
    let started = false;

    const start = () => {
      if (!started) {
        started = true;
        performance.mark(START);
        return;
      }
      this.warn(`Measurement \`${name}\` already started.`);
    };

    const stopAndReport = () => {
      if (started) {
        started = false;
        performance.mark(STOP);
        return performance.measure(NAME, START, STOP);
      }
      this.warn(`Measurement \`${name}\` not yet started.`);
    };

    const stop = (logMeasurement: boolean = true) => {
      const measurement = stopAndReport();
      if (measurement && logMeasurement) this.info(measurement);
    };
  
    return { start, stop, stopAndReport };
  }

  measureFn<T extends (this: unknown, ...args: any[]) => any>(
    fn: T,
    givenName?: string
  ): T {
    const self = this;
    const name = givenName || fn.name || "<anonymous>";
    const wrappedName = `measured ${name}`;
    const aggregator = new rx.Subject<PerformanceMeasure>();

    aggregator.pipe(
      rxop.bufferTime(1000),
      rxop.filter((measurements) => measurements.length > 0),
      rxop.map((measurements) => measurements.reduce(
        (acc: AggregatedMeasurement, m: PerformanceMeasure) => {
          const initCount = acc.count;
          const dur = m.duration;

          acc.count = initCount + 1;
          acc.total = acc.total + dur;
          acc.min = initCount > 0 ? Math.min(acc.min, dur) : dur;
          acc.avg = acc.total / acc.count;
          acc.max = Math.max(acc.max, dur);

          return acc;
        },
        {
          name: wrappedName,
          count: 0,
          total: 0,
          min: 0,
          avg: 0,
          max: 0
        }
      ))
    ).subscribe((m) => this.info(m));

    // An old trick to give a dynamic name to a function.
    const wrapping = {
      [wrappedName](this: ThisParameterType<T>) {
        const stopWatch = self.stopWatch(name);

        const doStop = () => {
          const measurement = stopWatch.stopAndReport();
          if (!measurement) return;
          aggregator.next(measurement);
        };

        stopWatch.start();
        const retVal = fn.apply(this, arguments);

        // For async functions, we want to wait for it to resolve.
        if (isThenable(retVal)) {
          return Promise.resolve(retVal).finally(doStop);
        }
        else {
          doStop();
          return retVal;
        }
      }
    };

    return wrapping[wrappedName] as T;
  }

  async measureAsync<T>(name: string, task: () => Promise<T>): Promise<T> {
    const stopWatch = this.stopWatch(name);
    stopWatch.start();
    const result = await task();
    stopWatch.stop();
    return result;
  }

  measureStream<T>(name: string): MeasureStreamOperator<T> {
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

class NullLogger implements ILogger {
  info = noop;
  warn = noop;
  error = noop;
  dir = noop;
  mark = noop;

  stopWatch(): StopWatch {
    return {
      start: noop,
      stop: noop,
      stopAndReport: noop as StopWatch["stopAndReport"]
    };
  }

  measureFn<T extends (this: unknown, ...args: any[]) => any>(fn: T): T {
    return fn;
  }

  async measureAsync<T>(_name: string, task: () => Promise<T>): Promise<T> {
    return await task();
  }

  measureStream<T>(): MeasureStreamOperator<T> {
    return Object.assign((source) => source, {
      markItems: () => (source) => source
    });
  }
}

export const createLogger = (origin: string): ILogger => {
  // Can be disabled via config.
  if (!usConfig.debugLogging) return new NullLogger();
  // The functional reactive nature of this logger offends Jest.
  if (usConfig.inTestEnv) return new NullLogger();
  return new Logger(origin);
};