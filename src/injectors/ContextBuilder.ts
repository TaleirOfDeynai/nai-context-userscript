import usConfig from "@config";
import ContextBuilder, { IContextBuilder } from "@nai/ContextBuilder";
import { createLogger } from "@utils/logging";
import ContextProcessor from "../contextBuilder/ContextProcessor";
import { onEndContext } from "../contextBuilder/rx/events";
import { notifyOfProblem } from "../require";
import { replaceWrapper } from "./_helpers";

const logger = createLogger("ContextBuilder Injector");

export const name = ContextBuilder.name;
export const chunkId = 2888;
export const moduleId = ContextBuilder.moduleId;
export const inject = replaceWrapper<IContextBuilder>({
  "rJ": (original, require) => {
    const processor = ContextProcessor(require);

    let builderFailed = false;

    const ogMark = "build original context";
    const usMark = "build userscript context";

    async function timeTrialBuilder() {
      performance.mark(`${ogMark}:start`);
      const naiResult = await original.apply(this, arguments);
      performance.mark(`${ogMark}:end`);

      const [sc, ss, tl, pp, sl, codec] = arguments as unknown as Parameters<typeof original>;
      performance.mark(`${usMark}:start`);
      const usResult = await processor.processContext(sc, ss, tl, sl, pp, codec);
      performance.mark(`${usMark}:end`);

      // Log the different results out.  Helpful for comparing.
      logger.info("Vanilla Result:", naiResult);
      logger.info("User-Script Result:", usResult);

      // Use the vanilla `console.log` to print the results.
      // I will sometimes want to measure without the expensive log spam.
      console.log(performance.measure(ogMark, `${ogMark}:start`, `${ogMark}:end`));
      console.log(performance.measure(usMark, `${usMark}:start`, `${usMark}:end`));

      performance.clearMarks();
      performance.clearMeasures();

      onEndContext.next(usResult);
      return usResult;
    }

    async function failSafeBuilder() {
      if (!builderFailed) {
        try {
          const [sc, ss, tl, pp, sl, codec] = arguments as unknown as Parameters<typeof original>;
          const usResult = await processor.processContext(sc, ss, tl, sl, pp, codec);
          logger.info("User-Script Result:", usResult);
          onEndContext.next(usResult);
          return usResult;
        }
        catch (err) {
          notifyOfProblem({
            message: [
              "The custom context builder failed.",
              "Falling back to the vanilla context builder for the remainder of this session.",
            ].join("  "),
            logToConsole: err
          });
          builderFailed = true;
        }
      }

      // Invoke the original if the new builder fails.
      const naiResult = await original.apply(this, arguments);
      onEndContext.next(naiResult);
      return naiResult;
    }

    return usConfig.debugTimeTrial ? timeTrialBuilder : failSafeBuilder;
  }
});