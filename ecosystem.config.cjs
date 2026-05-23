const path = require("path");
const fs = require("fs");

const root = __dirname;

function parseEnvFile(filePath) {
  try {
    return Object.fromEntries(
      fs.readFileSync(filePath, "utf8")
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const idx = line.indexOf("=");
          return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

const fileEnv = {
  ...parseEnvFile(path.join(root, ".env")),
  ...parseEnvFile(path.join(root, ".env.local")),
};

module.exports = {
  apps: [
    {
      name: "boringos-server",
      script: path.join(root, "scripts/dev-server.mjs"),
      interpreter: "node",
      cwd: root,
      env: {
        ...fileEnv,
        NODE_ENV: "development",
        PORT: "3030",
        PG_EMBEDDED: "false",
        HEBBS_DEV_MODULES: "true",
      },
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
    },
    {
      name: "boringos-shell",
      script: path.join(root, "packages/@boringos/shell/node_modules/vite/bin/vite.js"),
      cwd: path.join(root, "packages/@boringos/shell"),
      env: {
        NODE_ENV: "development",
        BORINGOS_API_TARGET: "http://localhost:3030",
      },
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
    },
  ],
};
