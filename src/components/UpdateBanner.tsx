import React from "react";
import { Sparkles, ExternalLink, X } from "lucide-react";
import type { UpdateCheckResult } from "../services/downloadService";
import { openUrl } from "../services/downloadService";

interface UpdateBannerProps {
  update: UpdateCheckResult;
  onDismiss: () => void;
}

export const UpdateBanner: React.FC<UpdateBannerProps> = ({
  update,
  onDismiss,
}) => {
  const handleOpenRelease = () => {
    if (update.release_url) {
      void openUrl(update.release_url);
    }
  };

  return (
    <div className="update-banner-container">
      <div className="update-banner-content">
        <span className="update-banner-badge">
          <Sparkles size={14} className="icon-pulse" />
          <span>Atualização Disponível</span>
        </span>
        <span className="update-banner-text">
          Nova versão <strong>v{update.latest_version}</strong> lançada no GitHub (você está na v{update.current_version})
        </span>
      </div>
      <div className="update-banner-actions">
        <button className="update-banner-btn-primary" onClick={handleOpenRelease}>
          <span>Ver no GitHub</span>
          <ExternalLink size={13} />
        </button>
        <button className="update-banner-btn-dismiss" title="Dispensar aviso" onClick={onDismiss}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
};
