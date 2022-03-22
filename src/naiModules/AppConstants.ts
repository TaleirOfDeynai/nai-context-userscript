import { ModuleDef } from "../require";

export interface IAppConstants {
  "uV": number;
  "T8": number;
}

class AppConstants extends ModuleDef<IAppConstants> {
  moduleId = 63139;
  expectedExports = 43;
  mapping = {
    "uV": ["contextSize", "number"],
    "T8": ["T8", "number"]
  } as const;
}

export default new AppConstants();