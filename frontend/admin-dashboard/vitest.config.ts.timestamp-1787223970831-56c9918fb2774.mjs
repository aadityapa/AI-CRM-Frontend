// vitest.config.ts
import { defineConfig } from "file:///sessions/kind-magical-bardeen/mnt/AI-Interview-Model-F-V2/frontend/admin-dashboard/node_modules/vitest/dist/config.js";
import react from "file:///sessions/kind-magical-bardeen/mnt/AI-Interview-Model-F-V2/frontend/admin-dashboard/node_modules/@vitejs/plugin-react/dist/index.js";
var vitest_config_default = defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**", "src/**/*.d.ts"]
    }
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9zZXNzaW9ucy9raW5kLW1hZ2ljYWwtYmFyZGVlbi9tbnQvQUktSW50ZXJ2aWV3LU1vZGVsLUYtVjIvZnJvbnRlbmQvYWRtaW4tZGFzaGJvYXJkXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMva2luZC1tYWdpY2FsLWJhcmRlZW4vbW50L0FJLUludGVydmlldy1Nb2RlbC1GLVYyL2Zyb250ZW5kL2FkbWluLWRhc2hib2FyZC92aXRlc3QuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9raW5kLW1hZ2ljYWwtYmFyZGVlbi9tbnQvQUktSW50ZXJ2aWV3LU1vZGVsLUYtVjIvZnJvbnRlbmQvYWRtaW4tZGFzaGJvYXJkL3ZpdGVzdC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZXN0L2NvbmZpZ1wiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuXG4vLyBUZXN0IGNvbmZpZyBrZXB0IHNlcGFyYXRlIGZyb20gdml0ZS5jb25maWcudHMgKHdoaWNoIGlzIGJ1aWxkL3Byb3h5IGZvY3VzZWQpLlxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICB0ZXN0OiB7XG4gICAgZ2xvYmFsczogdHJ1ZSxcbiAgICBlbnZpcm9ubWVudDogXCJqc2RvbVwiLFxuICAgIHNldHVwRmlsZXM6IFtcIi4vc3JjL3Rlc3Qvc2V0dXAudHNcIl0sXG4gICAgY3NzOiBmYWxzZSxcbiAgICBpbmNsdWRlOiBbXCJzcmMvKiovKi57dGVzdCxzcGVjfS57dHMsdHN4fVwiXSxcbiAgICBjb3ZlcmFnZToge1xuICAgICAgcHJvdmlkZXI6IFwidjhcIixcbiAgICAgIHJlcG9ydGVyOiBbXCJ0ZXh0XCIsIFwiaHRtbFwiXSxcbiAgICAgIGluY2x1ZGU6IFtcInNyYy8qKi8qLnt0cyx0c3h9XCJdLFxuICAgICAgZXhjbHVkZTogW1wic3JjLyoqLyoue3Rlc3Qsc3BlY30ue3RzLHRzeH1cIiwgXCJzcmMvdGVzdC8qKlwiLCBcInNyYy8qKi8qLmQudHNcIl0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUErYSxTQUFTLG9CQUFvQjtBQUM1YyxPQUFPLFdBQVc7QUFHbEIsSUFBTyx3QkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLE1BQU07QUFBQSxJQUNKLFNBQVM7QUFBQSxJQUNULGFBQWE7QUFBQSxJQUNiLFlBQVksQ0FBQyxxQkFBcUI7QUFBQSxJQUNsQyxLQUFLO0FBQUEsSUFDTCxTQUFTLENBQUMsK0JBQStCO0FBQUEsSUFDekMsVUFBVTtBQUFBLE1BQ1IsVUFBVTtBQUFBLE1BQ1YsVUFBVSxDQUFDLFFBQVEsTUFBTTtBQUFBLE1BQ3pCLFNBQVMsQ0FBQyxtQkFBbUI7QUFBQSxNQUM3QixTQUFTLENBQUMsaUNBQWlDLGVBQWUsZUFBZTtBQUFBLElBQzNFO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
