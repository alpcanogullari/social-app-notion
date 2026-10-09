import path from "node:path";
import { fileURLToPath } from "node:url";

export const backendDir = fileURLToPath(new URL("../", import.meta.url));
export const publicDir = path.join(backendDir, "public");
export const defaultDataDir = path.resolve(
  backendDir,
  process.env.APP_DATA_DIR || ".data",
);
