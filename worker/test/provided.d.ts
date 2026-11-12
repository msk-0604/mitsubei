// 結合テストで global-setup.ts から渡す値
import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
    secret: string;
  }
}
