import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// In dev, npm workspaces change cwd to apps/api. Resolve configuration relative
// to this source file instead, for both tsx dev and bundled dist startup.
config({ path: process.env.CSW_CONFIG_PATH || fileURLToPath(new URL("../../../.env", import.meta.url)) });
