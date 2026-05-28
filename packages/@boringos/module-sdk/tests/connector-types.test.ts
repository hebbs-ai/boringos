import { describe, it, expectTypeOf } from "vitest";
import type {
  ConnectorDefinition,
  ServiceDefinition,
  AuthStrategy,
  ScopeDefinition,
  ConnectedAccount,
  ModuleFactoryDeps,
} from "../src/index.js";

describe("connector types", () => {
  it("ConnectorDefinition has required fields", () => {
    const def: ConnectorDefinition = {
      provider: "google",
      displayName: "Google",
      auth: [{ type: "oauth2", authorizationUrl: "u", tokenUrl: "t", clientIdEnv: "C", clientSecretEnv: "S" }],
      services: [],
      resolveAccountId: (r) => String(r.email),
    };
    expectTypeOf(def.provider).toBeString();
  });

  it("AuthStrategy is a discriminated union", () => {
    const oauth: AuthStrategy = { type: "oauth2", authorizationUrl: "u", tokenUrl: "t", clientIdEnv: "C", clientSecretEnv: "S" };
    const apiKey: AuthStrategy = { type: "api-key" };
    const bot: AuthStrategy = { type: "bot-token" };
    const pat: AuthStrategy = { type: "pat" };
    expectTypeOf(oauth.type).toEqualTypeOf<"oauth2">();
  });

  it("ModuleFactoryDeps exposes new connector methods", () => {
    type T = NonNullable<ModuleFactoryDeps["listConnectedAccounts"]>;
    expectTypeOf<T>().toBeFunction();
  });
});
