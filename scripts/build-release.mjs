import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const tauriTargetDir = path.join(rootDir, "src-tauri", "target", "release");

console.log("==================================================");
console.log("🚀 Iniciando Build do SFDownloader...");
console.log("==================================================");

try {
  // 1. Executar Tauri Build
  execSync("npx tauri build", { cwd: rootDir, stdio: "inherit" });

  // 2. Garantir pasta release/ no diretório raiz do projeto
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  console.log("\n📦 Copiando arquivos gerados para a pasta release/...");

  const copiedFiles = [];

  // Copiar o executável principal .exe se existir
  const mainExe = path.join(tauriTargetDir, "SFDownloader.exe");
  if (fs.existsSync(mainExe)) {
    const destExe = path.join(releaseDir, "SFDownloader.exe");
    fs.copyFileSync(mainExe, destExe);
    copiedFiles.push(destExe);
  }

  // Procurar por instaladores na pasta bundle/
  const bundleDir = path.join(tauriTargetDir, "bundle");
  if (fs.existsSync(bundleDir)) {
    const searchFolderRecursive = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          searchFolderRecursive(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === ".exe" || ext === ".msi" || ext === ".zip") {
            const destPath = path.join(releaseDir, entry.name);
            fs.copyFileSync(fullPath, destPath);
            copiedFiles.push(destPath);
          }
        }
      }
    };
    searchFolderRecursive(bundleDir);
  }

  console.log("==================================================");
  console.log("✅ Build concluído com sucesso!");
  console.log(`📁 Arquivos copiados para a pasta raiz /release:\n`);
  copiedFiles.forEach((file) => console.log(`   👉 ${file}`));
  console.log("==================================================");
} catch (error) {
  console.error("\n❌ Erro durante o processo de build:", error);
  process.exit(1);
}
