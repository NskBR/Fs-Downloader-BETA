import {
  Archive,
  File,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
} from "lucide-react";
import type { CustomCategory } from "./settings";

export const downloadCategories = [
  {
    name: "Imagens",
    extensions: ["jpg", "jpeg", "png", "webp", "gif"],
    icon: FileImage,
    color: "#60a5fa",
  },
  {
    name: "Vídeos",
    extensions: ["mp4", "mkv", "mov", "avi", "webm"],
    icon: FileVideo,
    color: "#818cf8",
  },
  {
    name: "Áudios",
    extensions: ["mp3", "wav", "flac", "ogg"],
    icon: FileAudio,
    color: "#c084fc",
  },
  {
    name: "Documentos",
    extensions: ["pdf", "docx", "xlsx", "pptx", "txt"],
    icon: FileText,
    color: "#38bdf8",
  },
  {
    name: "Compactados",
    extensions: ["zip", "rar", "7z", "tar", "gz", "tgz"],
    icon: Archive,
    color: "#fbbf24",
  },
  {
    name: "Aplicativos",
    extensions: ["exe", "msi", "apk", "bat"],
    icon: FileCode2,
    color: "#34d399",
  },
  { name: "Torrents", extensions: ["torrent"], icon: File, color: "#2dd4bf" },
  { name: "Outros", extensions: [], icon: File, color: "#94a3b8" },
] as const;

export function categoryForFile(
  fileName: string,
  customCategories: CustomCategory[] = [],
): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const standard = downloadCategories.find(
    (category) =>
      category.name !== "Outros" &&
      category.extensions.some((item) => item === extension),
  );
  if (standard) return standard.name;
  return (
    customCategories.find((category) => category.extensions.includes(extension))
      ?.name ?? "Outros"
  );
}
