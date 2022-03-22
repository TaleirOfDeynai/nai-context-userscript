import ContextBuilder, { IContextBuilder } from "../naiModules/ContextBuilder";
import { onEndContext } from "../contextBuilder/rx/events";
import { replaceWrapper } from "./_helpers";

export const name = ContextBuilder.name;
export const chunkId = 2888;
export const moduleId = ContextBuilder.moduleId;
export const inject = replaceWrapper<IContextBuilder>({
  "rJ": (original) => {
    return function wrappedBuilderFn() {
      console.log("Successful call from injected context builder.");
      const result = original.apply(this, arguments);
      result.then(onEndContext.next.bind(onEndContext));
      return result;
    };
  }
});