import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["web/place.js", "web/i18n.js", "web/editions.js", "web/audio.js", "web/dev-host.js"],
    },
  },
});
