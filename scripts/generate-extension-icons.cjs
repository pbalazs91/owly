const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const extensionDir = path.join(__dirname, "..", "browser-extension");
  const iconDir = path.join(extensionDir, "icons");
  const svg = await fs.readFile(path.join(extensionDir, "owl-icon.svg"));
  await fs.mkdir(iconDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await sharp(svg).resize(size, size).png().toFile(path.join(iconDir, `owl-${size}.png`));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
