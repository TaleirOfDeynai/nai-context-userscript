/**
 * Provides helpers or work-alike implementations for NovelAI's internal
 * APIs.
 */

import { usModule } from "@utils/usModule";
import { isArray } from "@utils/is";
import ModelModule from "@nai/ModelModule";
import UUID from "@nai/UUID";

import type { AnyValueOf } from "@utils/utility-types";
import type { ContextStatus as IContextStatus } from "@nai/ContextBuilder";
import type { TrimStates, TrimMethods } from "@nai/ContextBuilder";
import type { IContextField } from "@nai/ContextModule";
import type { TokenCodec } from "@nai/TokenizerCodec";
import type { StorySettings } from "@nai/EventModule";
import type { PreambleData } from "@nai/ModelModule";

const theModule = usModule((require, exports) => {
  const modelModule = require(ModelModule);
  const uuid = require(UUID);

  const getPreambleTokens = async (codec: TokenCodec, data: PreambleData) => {
    if (isArray(data.exactTokens)) return data.exactTokens;
    if (!data.str) return [];
    return await codec.encode(data.str);
  };

  const getPreamble = async (
    codec: TokenCodec,
    model: StorySettings["model"],
    prefix: StorySettings["prefix"],
    prependPreamble: boolean,
    isContextEmpty: boolean,
    isStoryUntrimmed: boolean
  ) => {
    const preambleData = modelModule.GetPreamble(
      model,
      prependPreamble,
      isContextEmpty,
      isStoryUntrimmed,
      prefix
    );

    return {
      str: preambleData.str,
      tokens: await getPreambleTokens(codec, preambleData)
    };
  };

  /** Work-alike implementation of the private `ContextStatus` class. */
  class ContextStatus<T extends IContextField = IContextField> implements IContextStatus<T> {
    included: boolean = true;
    identifier: string = "";
    state: AnyValueOf<TrimStates> = "not included";
    reason: string = "default";
    triggeringKey: string = "";
    keyIndex: number = -1;
    includedText: string = "";
    calculatedTokens: number = 0;
    actualReservedTokens: number = 0;
    keyRelative: boolean = false;
    trimMethod: AnyValueOf<TrimMethods> = "no trim";
    type: string = "";

    /** Misspelled in NAI source. */
    unqiueId: string;
    contextField: T;
    settings: T;

    constructor(entry: T) {
      this.unqiueId = uuid.v4();
      this.contextField = entry;
      this.settings = entry;
    }
  }

  return Object.assign(exports, {
    getPreamble,
    ContextStatus
  });
});

export default theModule;

// Do some magic with instantiation expressions to extract the class.
declare namespace WitchCraft {
  export const ContextStatusCtor: ReturnType<typeof theModule>["ContextStatus"];
}
export type ContextStatus<T extends IContextField = IContextField>
  = InstanceType<typeof WitchCraft.ContextStatusCtor<T>>;