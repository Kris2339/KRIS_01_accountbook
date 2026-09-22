import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:8899",
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          executablePath:
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
          args: ["--disable-gpu"],
        },
      },
    },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  reporter: "list",
});
