import usConfig from "@config";
import { isThenable } from "./is";
import * as rx from "./rx";
import * as rxop from "./rxop";

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

/** The functional reactive nature of this logger offends Jest. */
const CAN_ASYNC_LOG = usConfig.debugLogging && !usConfig.testLogging;
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
    if (!CAN_ASYNC_LOG) return;
    this.#stream.next({ origin: this.#origin, type: "info", data });
  };
  warn = (...data: any[]) => {
    if (!CAN_ASYNC_LOG) return;
    this.#stream.next({ origin: this.#origin, type: "info", data });
  };
  error = (...data: any[]) => {
    if (!CAN_ASYNC_LOG) return;
    this.#stream.next({ origin: this.#origin, type: "info", data });
  };
  dir = (...data: Parameters<Console["dir"]>) => {
    if (!CAN_ASYNC_LOG) return;
    this.#stream.next({ origin: this.#origin, type: "info", data });
  };
  mark = (name: string) => {
    if (!CAN_ASYNC_LOG) return;
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
    if (!CAN_ASYNC_LOG) return {
      start: rx.noop,
      stop: rx.noop,
      stopAndReport: rx.noop as StopWatch["stopAndReport"]
    };

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

  /** Wraps a function, measuring how long it takes to call it. */
  measureFn<T extends (this: unknown, ...args: any[]) => any>(
    fn: T,
    name: string = fn.name || "<anonymous>"
  ): T {
    if (!CAN_ASYNC_LOG) return fn;

    const self = this;
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

  /** Measures the performance of the operations within a given function. */
  async measureAsync<T>(
    /** The name of this measurement. */
    name: string,
    /** A zero-arity function to call after measurement has begun. */
    task: () => Promise<T>
  ): Promise<T> {
    if (!CAN_ASYNC_LOG) return await task();

    const stopWatch = this.stopWatch(name);
    stopWatch.start();
    const result = await task();
    stopWatch.stop();
    return result;
  }

  measureStream<T>(
    name: string
  ): MeasureStreamOperator<T> {
    if (!CAN_ASYNC_LOG) {
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