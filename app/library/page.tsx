/* eslint-disable @next/next/no-img-element -- media streams from the authenticated /api/assets route */
import Link from "next/link";
import { Download, Film, FolderOpen, Image as ImageIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { listUserMedia } from "@/lib/server/projects";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function sizeLabel(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function LibraryPage() {
  const frame = await loadFrame("/library");
  const media = await listUserMedia(frame.db, frame.actor.user.id, 180);
  const videos = media.filter((item) => item.contentType.startsWith("video/")).length;
  const images = media.filter((item) => item.contentType.startsWith("image/")).length;

  return (
    <AppShell
      active="library"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      title="Media library"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">ALL MEDIA</div>
          <h1 className="page-title">Media library</h1>
          <p className="page-sub">
            {media.length} files · {videos} videos · {images} images. Every file belongs to a project and is
            private to your account.
          </p>
        </div>
        <div className="head-actions">
          <Link href="/studio" className="btn btn-secondary">
            <FolderOpen size={15} /> Go to projects
          </Link>
        </div>
      </div>

      {media.length ? (
        <div className="media-grid">
          {media.map((item) => {
            const isImage = item.contentType.startsWith("image/");
            return (
              <article className="media-tile" key={item.id}>
                <div className="media-preview">
                  {isImage ? (
                    <img src={`/api/assets/${item.id}`} alt={item.fileName} loading="lazy" />
                  ) : (
                    <video src={`/api/assets/${item.id}#t=0.2`} muted preload="metadata" playsInline />
                  )}
                </div>
                <div className="media-info">
                  <b title={item.fileName}>{item.fileName}</b>
                  <div className="row-between">
                    <span className="row" style={{ gap: 5 }}>
                      {isImage ? <ImageIcon size={11} /> : <Film size={11} />}
                      {sizeLabel(item.byteSize)} · {relativeTime(item.createdAt)}
                    </span>
                    <a
                      href={`/api/assets/${item.id}?download=1`}
                      className="btn btn-ghost btn-sm"
                      aria-label={`Download ${item.fileName}`}
                    >
                      <Download size={13} />
                    </a>
                  </div>
                  <Link href={`/studio/${item.projectId}`} className="tiny" style={{ color: "var(--lime)", display: "block", marginTop: 5 }}>
                    {item.projectName}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon"><Film size={22} /></div>
          <strong>No media yet</strong>
          <p>Upload footage in a project or generate your first image or clip.</p>
          <Link href="/studio" className="btn btn-primary">Open studio</Link>
        </div>
      )}
    </AppShell>
  );
}
