import { ModuleDef } from "../require";
import type { StorySettings } from "./EventModule";

/** A generic interface for anything that can be provide content to the context. */
export interface PreambleData {
  /**
   * A string that represents the preamble.  Encode this unless
   * {@link exactTokens} is set.
   */
  str: string;
  /** When set, these are the exact tokens that must be used. */
  exactTokens: number[] | undefined;
}

export namespace Virtual {
  /** These are the conditions involved in {@link GetPreamble}. */
  declare enum Conditions {
    True,
    False,
    OnSettingEnabled,
    OnLowContext,
    OnEmptyContext,
    OnModule,
    OnAdventure
  };

  /**
   * This is implemented a little odd.  It looks like they have a set of
   * conditions that gets evaluated to see if the preamble is needed.
   * 
   * The `settingState` seems to use the fourth argument of the context
   * builder...  This used to be the `removeComments` arguments, but
   * it looks like they changed it.
   */
  export declare function GetPreamble(
    /** Defaults to `"euterpe-v2" at the moment.` */
    model?: StorySettings["model"],
    /** Checked by {@link Conditions.OnSettingEnabled}. */
    settingState?: boolean,
    /** Checked by {@link Conditions.OnEmptyContext}. */
    isContextEmpty?: boolean,
    /** Checked by {@link Conditions.OnLowContext}. */
    isStoryUntrimmed?: boolean,
    /** Checked by {@link Conditions.OnModule} and {@link Conditions.OnAdventure}. */
    prefix?: StorySettings["prefix"]
  ): PreambleData;
}

export interface IModelModule {
  "vp": typeof Virtual.GetPreamble;
};

class ModelModule extends ModuleDef<IModelModule> {
  moduleId = 81101;
  expectedExports = 9;
  mapping = {
    "vp": ["GetPreamble", "function"]
  } as const;
};

export default new ModelModule();