import { jest } from "@jest/globals";

import AppConstants from "@nai/AppConstants";

import type { FunctionLike, Mock } from "jest-mock";
import type * as USModule from "@utils/usModule";
import type { WrappedRequireFn } from "@src/require";

interface ModuleMocker<T extends {}> {
  (
    /** The exports from the module. */
    exports: T,
    /**
     * A special variant of `jest.fn` that will restore the given
     * implementation after `mockReset`.
     */
    jestFn: typeof createJestMock
  ): T;
}

interface FakeRequire extends WrappedRequireFn {
  inject<T extends {}>(
    moduleFactory: USModule.UserScriptModule<T>,
    moduleMocker: ModuleMocker<T>
  ): void;
}

const _mocks: FakeRequire["_mocks"] = new Map();

function createJestMock(): Mock;
function createJestMock<TFn extends FunctionLike>(defaultImplementation: TFn): Mock<TFn>;
function createJestMock<TFn extends FunctionLike>(defaultImplementation?: TFn) {
  const theMock = jest.fn(defaultImplementation);
  if (!defaultImplementation) return theMock;

  const { mockReset } = theMock;
  return Object.assign(theMock, {
    mockReset: () => {
      mockReset.call(theMock);
      theMock.mockImplementation(defaultImplementation);
      return theMock;
    }
  })
};

const inject: FakeRequire["inject"] = (moduleFactory, moduleMocker) =>
  _mocks.set(moduleFactory, (exports: any) => moduleMocker(exports, createJestMock));

const fakeRequire: any = (module: any) => {
  switch (module) {
    // Imported by `TextSplitterService`.
    case AppConstants: return {
      contextSize: 2000
    };
    default: return {};
  }
};

export default Object.assign(fakeRequire, { _mocks, inject }) as FakeRequire;