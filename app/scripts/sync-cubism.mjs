// Prepares the Live2D Cubism SDK (not in git: Live2D license) for the app:
// - Core and WebGL shaders -> public/cubism, served by Vite
// - Framework sources -> .cubism/framework with "// @ts-nocheck", so our strict tsconfig
//   type-checks the app without failing on the SDK's own non-strict code
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdk = join(root, "vendor/cubism");
const core = join(sdk, "Core/live2dcubismcore.min.js");
if (!existsSync(core)) {
  console.error(
    "vendor/cubism/Core not found. Download Cubism SDK for Web 5 from https://www.live2d.com/sdk/download/web/ (accepting Live2D's license) and unzip it as app/vendor/cubism.",
  );
  process.exit(1);
}

const pub = join(root, "public/cubism");
mkdirSync(pub, { recursive: true });
cpSync(core, join(pub, "live2dcubismcore.min.js"));
cpSync(join(sdk, "Framework/Shaders/WebGL"), join(pub, "shaders"), { recursive: true });

const out = join(root, ".cubism/framework");
rmSync(out, { recursive: true, force: true });
const copy = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    if (statSync(src).isDirectory()) copy(src, join(to, name));
    else if (name.endsWith(".ts")) writeFileSync(join(to, name), "// @ts-nocheck\n" + readFileSync(src, "utf8"));
  }
};
copy(join(sdk, "Framework/src"), out);
