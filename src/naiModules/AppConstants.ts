import { ModuleDef } from "../require";

export interface IAppConstants {
  "Lb": number;
  "T8": number;
}

class AppConstants extends ModuleDef<IAppConstants> {
  moduleId = 61893;
  expectedExports = 54;
  mapping = {
    "Lb": ["contextSize", "number"],
    "T8": ["T8", "number"]
  } as const;
}

export default new AppConstants();