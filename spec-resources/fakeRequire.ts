import AppConstants from "@nai/AppConstants";

import type { WrappedRequireFn } from "@src/require";

const fakeRequire: any = (module: any) => {
  switch (module) {
    // Imported by `TextSplitterService`.
    case AppConstants: return {
      contextSize: 2000
    };
    default: return {};
  }
};

export default fakeRequire as WrappedRequireFn;