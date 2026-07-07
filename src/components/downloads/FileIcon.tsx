import {
  Archive,
  Boxes,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  PackageOpen,
} from "lucide-react";

type FileIconGroup = {
  label: string;
  className: string;
  icon: typeof File;
};

const groups: Record<string, FileIconGroup> = {
  pdf: { label: "PDF", className: "pdf", icon: FileText },
  doc: { label: "DOC", className: "doc", icon: FileText },
  docx: { label: "DOC", className: "doc", icon: FileText },
  txt: { label: "TXT", className: "text", icon: FileText },
  xls: { label: "XLS", className: "sheet", icon: FileText },
  xlsx: { label: "XLS", className: "sheet", icon: FileText },
  pptx: { label: "PPT", className: "slides", icon: FileText },

  zip: { label: "ZIP", className: "zip", icon: Archive },
  rar: { label: "RAR", className: "rar", icon: PackageOpen },
  "7z": { label: "7Z", className: "sevenzip", icon: Boxes },
  tar: { label: "TAR", className: "tar", icon: FileArchive },
  gz: { label: "GZ", className: "gzip", icon: FileArchive },
  tgz: { label: "TGZ", className: "gzip", icon: FileArchive },

  mp3: { label: "MP3", className: "audio", icon: FileAudio },
  wav: { label: "WAV", className: "audio", icon: FileAudio },
  flac: { label: "FLAC", className: "audio", icon: FileAudio },
  ogg: { label: "OGG", className: "audio", icon: FileAudio },

  mp4: { label: "MP4", className: "video", icon: FileVideo },
  mkv: { label: "MKV", className: "video", icon: FileVideo },
  mov: { label: "MOV", className: "video", icon: FileVideo },
  avi: { label: "AVI", className: "video", icon: FileVideo },
  webm: { label: "WEBM", className: "video", icon: FileVideo },

  exe: { label: "EXE", className: "app", icon: FileCode2 },
  msi: { label: "MSI", className: "installer", icon: PackageOpen },
  apk: { label: "APK", className: "android", icon: PackageOpen },
  bat: { label: "BAT", className: "script", icon: FileCode2 },

  png: { label: "PNG", className: "image", icon: FileImage },
  jpg: { label: "JPG", className: "image", icon: FileImage },
  jpeg: { label: "JPG", className: "image", icon: FileImage },
  webp: { label: "WEBP", className: "image", icon: FileImage },
  gif: { label: "GIF", className: "image", icon: FileImage },

  iso: { label: "ISO", className: "disc", icon: PackageOpen },
  bin: { label: "BIN", className: "binary", icon: FileCode2 },
  torrent: { label: "TOR", className: "torrent", icon: Boxes },
};

export function FileIcon({ extension }: { extension: string | null }) {
  const normalized = extension?.toLowerCase() ?? "";
  const group = groups[normalized] ?? {
    label: (extension ?? "FILE").slice(0, 4).toUpperCase(),
    className: "generic",
    icon: File,
  };
  const Icon = group.icon;
  return (
    <div className={`styled-file-icon styled-file-icon--${group.className}`}>
      <Icon size={24} />
      <b>{group.label}</b>
    </div>
  );
}
