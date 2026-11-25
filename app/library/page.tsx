import Link from "next/link";
import { Film, FolderOpen } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MediaLibrary, type MediaItem } from "@/components/media-library";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { listUserMedia } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

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

      <MediaLibrary items={media as MediaItem[]} />

      {!media.length ? (
        <div className="hint mt-3 row" style={{ gap: 7 }}>
          <Film size={13} /> Media appears here after you upload or generate it inside a project.
        </div>
      ) : null}
    </AppShell>
  );
}
