import { Archive, File, FileAudio, FileCode2, FileText, FileVideo, Image } from "lucide-react";
const groups:Record<string,{label:string;className:string;icon:typeof File}>={
  pdf:{label:"PDF",className:"pdf",icon:FileText},doc:{label:"W",className:"doc",icon:FileText},docx:{label:"W",className:"doc",icon:FileText},xlsx:{label:"X",className:"sheet",icon:FileText},
  zip:{label:"ZIP",className:"zip",icon:Archive},rar:{label:"RAR",className:"zip",icon:Archive},"7z":{label:"7Z",className:"zip",icon:Archive},
  mp3:{label:"♪",className:"audio",icon:FileAudio},wav:{label:"♪",className:"audio",icon:FileAudio},flac:{label:"♪",className:"audio",icon:FileAudio},
  mp4:{label:"▶",className:"video",icon:FileVideo},mkv:{label:"▶",className:"video",icon:FileVideo},webm:{label:"▶",className:"video",icon:FileVideo},
  exe:{label:"EXE",className:"app",icon:FileCode2},msi:{label:"MSI",className:"app",icon:FileCode2},png:{label:"IMG",className:"image",icon:Image},jpg:{label:"IMG",className:"image",icon:Image},
};
export function FileIcon({extension}:{extension:string|null}){const group=groups[extension?.toLowerCase()??""]??{label:(extension??"FILE").slice(0,4).toUpperCase(),className:"generic",icon:File};const Icon=group.icon;return <div className={`styled-file-icon styled-file-icon--${group.className}`}><Icon size={24}/><b>{group.label}</b></div>}
