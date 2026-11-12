import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StudioEditor } from "@/components/studio-editor";
import { loadFrame, shellUser } from "@/lib/server/frame";
import { generationView, listGenerations } from "@/lib/server/generation";
import { listCustomerModels, publicModel } from "@/lib/server/models";
import { parseJson } from "@/lib/server/util";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  prompt: string;
  aspect: string;
  duration: number;
  trim_start: number;
  trim_end: number;
  overlay_title: string;
  selected_asset_id: string | null;
  caption_enabled: number;
  captions: string;
}

export default async function StudioProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<Record<string, unknown>> | Record<string, unknown>;
}) {
  const { projectId } = await params;
  const query = await Promise.resolve(searchParams ?? {});
  const frame = await loadFrame(`/studio/${projectId}`);
  const { db, actor, entitlements, wallet } = frame;
  const project = await db.first<ProjectRow>(
    `SELECT * FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`,
    [projectId, actor.user.id],
  );
  if (!project) notFound();

  const [assetRows, generationRows, models] = await Promise.all([
    db.all<{
      id: string;
      file_name: string;
      content_type: string;
      byte_size: number;
      kind: string;
      created_at: number;
    }>(
      `SELECT id, file_name, content_type, byte_size, kind, created_at FROM assets
       WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC`,
      [projectId, actor.user.id],
    ),
    listGenerations(db, { userId: actor.user.id, projectId, limit: 20 }),
    listCustomerModels(db, { planModelIds: entitlements.plan ? entitlements.modelIds : [] }),
  ]);
  const generations = await Promise.all(generationRows.map((row) => generationView(db, row)));

  return (
    <AppShell
      active="studio"
      user={shellUser(actor)}
      availableCredits={wallet.available}
      planName={entitlements.plan?.name ?? null}
      title={project.name}
    >
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div>
          <Link href="/projects" className="row tiny muted" style={{ gap: 5, marginBottom: 8 }}>
            <ArrowLeft size={12} /> All projects
          </Link>
          <h1 className="page-title" style={{ fontSize: 26 }}>{project.name}</h1>
          <p className="page-sub">
            {entitlements.plan
              ? `${entitlements.plan.name} · ${wallet.available} credits available · ${entitlements.usage.videos}/${entitlements.limits.videoLimit < 0 ? "∞" : entitlements.limits.videoLimit} videos used`
              : "No active plan — subscribe to generate with AI. Editing and exports remain available."}
          </p>
        </div>
        <div className="head-actions">
          <Link href="/billing" className="btn btn-secondary btn-sm">Buy credits</Link>
        </div>
      </div>

      <StudioEditor
        initialProject={{
          id: project.id,
          name: project.name,
          prompt: project.prompt,
          aspect: project.aspect,
          duration: project.duration,
          trimStart: project.trim_start,
          trimEnd: project.trim_end,
          overlayTitle: project.overlay_title,
          selectedAssetId: project.selected_asset_id,
          captionEnabled: project.caption_enabled,
          captions: parseJson(project.captions, []),
        }}
        initialAssets={assetRows.map((asset) => ({
          id: asset.id,
          fileName: asset.file_name,
          contentType: asset.content_type,
          byteSize: asset.byte_size,
          kind: asset.kind,
          createdAt: asset.created_at,
          url: `/api/assets/${asset.id}`,
        }))}
        initialGenerations={generations}
        models={models.map((model) => publicModel(model, { planAllowed: model.planAllowed }))}
        availableCredits={wallet.available}
        planName={entitlements.plan?.name ?? null}
        limits={{
          maxVideoDurationSeconds: entitlements.limits.maxVideoDurationSeconds || 5,
          resolutions: entitlements.limits.resolutions.length ? entitlements.limits.resolutions : ["720p"],
          maxConcurrentJobs: Math.max(1, entitlements.limits.maxConcurrentJobs),
          videoLimit: entitlements.limits.videoLimit,
          imageLimit: entitlements.limits.imageLimit,
        }}
        openImageMode={query.mode === "image"}
        usage={{
          videos: entitlements.usage.videos,
          images: entitlements.usage.images,
          concurrentJobs: entitlements.usage.concurrentJobs,
        }}
      />
    </AppShell>
  );
}
