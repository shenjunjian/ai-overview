import { getHarnessErrorMessage } from "@ai-sdk/harness/agent";
import { expect, test } from "vite-plus/test";

import { requireDeepSeekApiKey } from "../src/lib/agent.ts";

test("missing MY_DS stays readable to the chat client", () => {
  expect(() => requireDeepSeekApiKey({})).toThrow(/MY_DS/);
  try {
    requireDeepSeekApiKey({ MY_DS: "  " });
  } catch (error) {
    expect(getHarnessErrorMessage(error)).toBe(
      "未配置 MY_DS。把 DeepSeek API key 写到 .env.local 后再分析。",
    );
  }
  expect(requireDeepSeekApiKey({ MY_DS: " sk-test " })).toBe("sk-test");
});
