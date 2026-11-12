/* eslint-disable @next/next/no-img-element -- media streams from the authenticated /api/assets route */
import Link from "next/link";
import { Clapperboard, Film, FolderOpen, Image as ImageIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { NewProjectButton } from "@/components/new-project-button";
import { DeleteProjectButton } from "@/components/delete-project-button";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { listProjectCards } from "@/lib/server/projects";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const frame = await loadFrame("/projects");
  const projects = await listProjectCards(frame.db, frame.actor.user.id, 200);

  return (
    <AppShell
      active="projects"
      user={shellUser(frame.actor)}
      availableCredits={frame.wallet.available}
      planName={frame.entitlements.plan?.name ?? null}
      title="Projects"
    >
      <div className="page-head">
        <div>
          <div className="page-eyebrow">YOUR WORKSPACE</div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">Every project keeps its own media, edits, captions and AI jobs.</p>
        </div>
        <div className="head-actions">
          <NewProjectButton label="New video project" />
          <NewProjectButton label="New image project" kind="image" className="btn btn-secondary" />
        </div>
      </div>

      {projects.length ? (
        <div className="grid grid-3">
          {projects.map((project) => (
            <article className="project-card" key={project.id}>
              <Link href={`/studio/${project.id}`} className="project-thumb" aria-label={`Open ${project.name}`}>
                {project.thumbId && project.thumbType?.startsWith("image/") ? (
                  <img src={`/api/assets/${project.thumbId}`} alt="" loading="lazy" />
                ) : project.thumbId && project.thumbType?.startsWith("video/") ? (
                  <video src={`/api/assets/${project.thumbId}#t=0.2`} muted preload="metadata" playsInline />
                ) : (
                  <Clapperboard size={28} />
                )}
                <span className="thumb-badge badge badge-muted">
                  {project.generationCount > 0 ? `${project.generationCount} AI` : `${project.assetCount} media`}
                </span>
              </Link>
              <div className="project-meta">
                <Link href={`/studio/${project.id}`}>
                  <strong>{project.name}</strong>
                </Link>
                <span className="row" style={{ gap: 6 }}>
                  <Film size={11} /> {project.assetCount} files · {relativeTime(project.updatedAt)}
                </span>
                <div className="project-actions">
                  <Link href={`/studio/${project.id}`} className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
                    Open studio
                  </Link>
                  <DeleteProjectButton projectId={project.id} projectName={project.name} />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon"><FolderOpen size={22} /></div>
          <strong>Your first project starts here</strong>
          <p>Create a project to upload footage, generate AI clips and build your edit.</p>
          <div className="row wrap" style={{ justifyContent: "center" }}>
            <NewProjectButton label="New video project" />
            <NewProjectButton label="New image project" kind="image" className="btn btn-secondary" />
          </div>
        </div>
      )}

      <div className="notice notice-info mt-3">
        <ImageIcon size={16} />
        <span>
          Image projects use the same editor: generate stills, animate them into video, then trim and
          export. Every generation is priced before you confirm.
        </span>
      </div>
    </AppShell>
  );
}
