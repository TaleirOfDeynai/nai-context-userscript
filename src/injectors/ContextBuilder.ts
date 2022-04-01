import ContextBuilder, { IContextBuilder } from "@nai/ContextBuilder";
import ContextProcessor from "../contextBuilder/ContextProcessor";
import { onEndContext } from "../contextBuilder/rx/events";
import { replaceWrapper } from "./_helpers";

export const name = ContextBuilder.name;
export const chunkId = 2888;
export const moduleId = ContextBuilder.moduleId;
export const inject = replaceWrapper<IContextBuilder>({
  "rJ": (original, require) => {
    const processor = ContextProcessor(require);

    const ogMark = "build original context";
    const usMark = "build userscript context";

    return async function wrappedBuilderFn() {
      console.log("Successful call from injected context builder.");
      performance.mark(`${ogMark}:start`);
      const result = await original.apply(this, arguments);
      performance.mark(`${ogMark}:end`);

      const [sc, ss, tl, rc, sl, codec] = arguments as unknown as Parameters<typeof original>;
      performance.mark(`${usMark}:start`);
      await processor.processContext(sc, ss, tl, sl, rc, codec);
      performance.mark(`${usMark}:end`);

      console.log(performance.measure(ogMark, `${ogMark}:start`, `${ogMark}:end`));
      console.log(performance.measure(usMark, `${usMark}:start`, `${usMark}:end`));

      performance.clearMarks();
      performance.clearMeasures();

      onEndContext.next(result);
      return result;
    };
  }
});