import ContextBuilder from "../naiModules/ContextBuilder";
import { replaceWrapper } from "./_helpers";

export const name = ContextBuilder.name;
export const chunkId = 2888;
export const moduleId = ContextBuilder.moduleId;
export const inject = replaceWrapper({
  "rJ": (original: Function) => {
    return function wrappedBuilderFn() {
      console.log("Successful call from injected context builder.");
      return original.apply(this, arguments);
    };
  }
});