import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function chooseDownloadFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Escolha a pasta principal de downloads",
  });
  return typeof selected === "string" ? selected : null;
}

export async function createCategoryFolders(
  rootPath: string,
  customCategories: string[] = [],
): Promise<string[]> {
  if (!rootPath.trim())
    throw new Error("Escolha uma pasta principal antes de continuar.");
  return invoke<string[]>("create_category_folders", {
    rootPath,
    customCategories,
  });
}
