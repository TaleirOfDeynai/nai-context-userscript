import { replaceWrapper } from "./_helpers";

export const name = "Context Builder";
export const chunkId = 2888;
export const moduleId = 91072;
export const inject = replaceWrapper({
  "rJ": (original: Function) => {
    return function wrappedBuilderFn() {
      console.log("Successful call from injected context builder.");
      return original.apply(this, arguments);
    };
  }
});