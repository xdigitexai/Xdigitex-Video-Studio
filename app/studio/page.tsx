/* eslint-disable @next/next/no-img-element -- media streams from the authenticated /api/assets route */
import Link from "next/link";
import { Clapperboard, FolderOpen, Image as ImageIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NewProjectButton } from "@/components/new-project-button";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { listProjectCards } from "@/lib/server/projects";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StudioIndexPage() {
  const frame = await loadFrame("/studio");
  const projects = await listProjectCards(frame.db, frame.actor.user.id, 60);

  return (
    <AppShell
      active="studio"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      title="Studio"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">CREATE</div>
          <h1 className="page-title">Open a project</h1>
          <p className="page-sub">
            Generate with AI, edit on the timeline, caption, and export. Everything stays inside the project.
          </p>
        </div>
        <div className="head-actions">
          <NewProjectButton label="New video project" />
          <NewProjectButton label="New image project" kind="image" className="btn btn-secondary" />
        </div>
      </div>

      <div className="grid grid-3">
        {projects.map((project) => (
          <Link href={`/studio/${project.id}`} className="project-card" key={project.id}>
            <div className="project-thumb">
              {project.thumbId && project.thumbType?.startsWith("image/") ? (
                <img src={`/api/assets/${project.thumbId}`} alt="" loading="lazy" />
              ) : project.thumbId && project.thumbType?.startsWith("video/") ? (
                <video src={`/api/assets/${project.thumbId}#t=0.2`} muted preload="metadata" playsInline />
              ) : (
                <Clapperboard size={26} />
              )}
              <span className="thumb-badge badge badge-muted">{project.assetCount} media</span>
            </div>
            <div className="project-meta">
              <strong>{project.name}</strong>
              <span>{project.generationCount} AI jobs · {relativeTime(project.updatedAt)}</span>
            </div>
          </Link>
        ))}
        {!projects.length ? (
          <div className="empty" style={{ gridColumn: "1 / -1" }}>
            <div className="empty-icon"><FolderOpen size={22} /></div>
            <strong>No projects yet</strong>
            <p>Create a video or image project to start generating.</p>
            <div className="row wrap" style={{ justifyContent: "center" }}>
              <NewProjectButton label="New video project" />
              <NewProjectButton label="New image project" kind="image" className="btn btn-secondary" />
            </div>
          </div>
        ) : null}
        <Link href="/projects" className="project-card" style={{ borderStyle: "dashed", minHeight: 180 }}>
          <div className="project-thumb" style={{ background: "transparent" }}>
            <ImageIcon size={24} />
          </div>
          <div className="project-meta">
            <strong>Manage all projects</strong>
            <span>Rename, delete and browse</span>
          </div>
        </Link>
      </div>
    </AppShell>
  );
}
