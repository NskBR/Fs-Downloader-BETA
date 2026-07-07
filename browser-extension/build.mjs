import { cp, mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const project = dirname(root);
const dist = join(root, "dist");
const release = join(root, "release");

await rm(dist, { recursive: true, force: true });
await mkdir(release, { recursive: true });

for (const target of ["chromium", "firefox"]) {
  const out = join(dist, target);
  await mkdir(join(out, "icons"), { recursive: true });
  
  for (const file of ["background.js", "content.js", "popup.html", "popup.css", "popup.js"]) {
    await cp(join(root, "src", file), join(out, file));
  }
  
  const manifestContent = await readFile(join(root, `manifest.${target}.json`), "utf8");
  const manifest = JSON.parse(manifestContent);
  const version = manifest.version;
  
  await writeFile(join(out, "manifest.json"), manifestContent);
  await cp(join(project, "src-tauri", "icons", "32x32.png"), join(out, "icons", "sf-small.png"));
  await cp(join(project, "src-tauri", "icons", "128x128.png"), join(out, "icons", "sf-large.png"));
  
  console.log(`Empacotando ${target} v${version}...`);
  
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const cmd = `${npxCmd} web-ext build --source-dir "${out}" --artifacts-dir "${release}" --overwrite-dest`;
  
  try {
    execSync(cmd, { stdio: "inherit" });
    
    const originalZip = join(release, `sf_downloader_integration-${version}.zip`);
    const targetZip = join(release, `sf_downloader_integration-${target}-${version}.zip`);
    
    await rm(targetZip, { force: true });
    await rename(originalZip, targetZip);
    console.log(`Sucesso: ${targetZip}`);
  } catch (err) {
    console.error(`Erro ao empacotar ${target}:`, err);
  }
}
