"use client";

/* eslint-disable @next/next/no-img-element -- media streams from the authenticated /api/assets route */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  Check,
  CheckCircle2,
  Download,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Lock,
  Play,
  Plus,
  Scissors,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
  WandSparkles,
  X,
  XCircle,
} from "lucide-react";

type Caption = { start: number; end: number; text: string };
type Project = {
  id: string;
  name: string;
  prompt: string;
  aspect: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  overlayTitle: string;
  selectedAssetId: string | null;
  captionEnabled: number;
  captions: Caption[];
};
type Asset = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  kind: string;
  createdAt: number;
  url: string;
};
type Generation = {
  id: string;
  projectId: string;
  status: string;
  capability: string;
  modelName: string | null;
  providerName: string | null;
  prompt: string;
  duration: number;
  aspect: string;
  resolution: string | null;
  progress: number;
  creditsReserved: number;
  creditsCharged: number;
  outputAssetId: string | null;
  outputUrl: string | null;
  outputContentType: string | null;
  error: string | null;
  createdAt: number;
};
type PublicModel = {
  id: string;
  name: string;
  description: string;
  provider: string;
  providerCode: string;
  code: string;
  capabilities: string[];
  maxDurationSeconds: number;
  resolutions: string[];
  pricingUnit: string;
  planAllowed: boolean;
};
type Estimate = {
  credits: number;
  priceLabel: string;
  units: number;
  unitKind: string;
  estimated: boolean;
};

const timecode = (seconds: number) =>
  `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
const srtTime = (seconds: number) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${response.status}).`);
  return data as T;
}

async function refreshCredits(): Promise<number | null> {
  try {
    const data = await api<{ wallet: { available: number } }>("/api/auth/me");
    return data.wallet.available;
  } catch {
    return null;
  }
}

const CAPABILITY_LABEL: Record<string, string> = {
  text_to_video: "Text to video",
  image_to_video: "Image to video",
  video_to_video: "Restyle video",
  text_to_image: "Text to image",
  image_edit: "Edit image",
  transcription: "Auto captions",
  prompt_enhance: "Improve prompt",
};

export function StudioEditor({
  initialProject,
  initialAssets,
  initialGenerations,
  models,
  availableCredits,
  planName,
  limits,
  usage,
  openImageMode = false,
}: {
  initialProject: Project;
  initialAssets: Asset[];
  initialGenerations: Generation[];
  models: PublicModel[];
  availableCredits: number;
  planName: string | null;
  limits: {
    maxVideoDurationSeconds: number;
    resolutions: string[];
    maxConcurrentJobs: number;
    videoLimit: number;
    imageLimit: number;
  };
  usage: { videos: number; images: number; concurrentJobs: number };
  openImageMode?: boolean;
}) {
  const [project, setProject] = useState<Project>(initialProject);
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [generations, setGenerations] = useState<Generation[]>(initialGenerations);
  const [tab, setTab] = useState<"edit" | "generate" | "captions" | "export">(
    openImageMode ? "generate" : "generate",
  );
  const [mode, setMode] = useState<"video" | "image">(openImageMode ? "image" : "video");
  const [action, setAction] = useState<"text_to_video" | "image_to_video" | "video_to_video" | "text_to_image" | "image_edit">(
    openImageMode ? "text_to_image" : "text_to_video",
  );
  const [selectedModelId, setSelectedModelId] = useState("");
  const [duration, setDuration] = useState(Math.min(5, limits.maxVideoDurationSeconds || 5));
  const [resolution, setResolution] = useState(limits.resolutions[0] || "720p");
  const [imageCount, setImageCount] = useState(1);
  const [sourceAssetId, setSourceAssetId] = useState<string>("");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateError, setEstimateError] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState(initialProject.selectedAssetId || initialAssets[0]?.id || "");
  const [videoDuration, setVideoDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [creditsAvailable, setCreditsAvailable] = useState(availableCredits);
  const [captionApproved, setCaptionApproved] = useState(false);
  const [captionEstimate, setCaptionEstimate] = useState<Estimate | null>(null);
  const [enhanceEstimate, setEnhanceEstimate] = useState<Estimate | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const srtRef = useRef<HTMLInputElement>(null);
  const autosave = useRef<number | null>(null);
  const firstRender = useRef(true);

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) || null;
  const isVideoAsset = selectedAsset?.contentType.startsWith("video/") ?? false;
  const isImageAsset = selectedAsset?.contentType.startsWith("image/") ?? false;
  const mediaDuration = videoDuration || project.duration || 5;

  const capabilityModels = useMemo(
    () => models.filter((model) => model.capabilities.includes(action)),
    [models, action],
  );
  const allowedModels = capabilityModels.filter((model) => model.planAllowed);
  const activeModel = allowedModels.find((model) => model.id === selectedModelId) ?? allowedModels[0] ?? null;
  const activeModelId = activeModel?.id ?? "";
  const maxDuration = Math.max(
    1,
    Math.min(limits.maxVideoDurationSeconds || 30, activeModel?.maxDurationSeconds || 30),
  );
  const activeDuration = Math.min(Math.max(1, duration), maxDuration);
  const resolutionOptions = activeModel?.resolutions.length ? activeModel.resolutions : limits.resolutions;
  const activeResolution = resolutionOptions.includes(resolution) ? resolution : resolutionOptions[0] || "720p";
  const compatibleSources = needsSource(action)
    ? assets.filter((asset) =>
        action === "video_to_video" ? asset.contentType.startsWith("video/") : asset.contentType.startsWith("image/"),
      )
    : [];
  const activeSourceId =
    sourceAssetId && compatibleSources.some((asset) => asset.id === sourceAssetId)
      ? sourceAssetId
      : compatibleSources[0]?.id ?? "";
  const transcriptionModel = models.find(
    (candidate) => candidate.capabilities.includes("transcription") && candidate.planAllowed,
  );
  const activeGeneration = generations.find(
    (generation) => !["SUCCEEDED", "FAILED", "CANCELED"].includes(generation.status),
  );

  // Autosave project settings.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (autosave.current) window.clearTimeout(autosave.current);
    autosave.current = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        await api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(project) });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 650);
    return () => {
      if (autosave.current) window.clearTimeout(autosave.current);
    };
  }, [project]);

  // Poll the active generation. Jobs survive refreshes because state is in D1.
  const activeId = activeGeneration?.id;
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await api<{ generation: Generation }>(`/api/generations/${activeId}`);
        if (cancelled) return;
        setGenerations((current) =>
          current.map((generation) => (generation.id === result.generation.id ? result.generation : generation)),
        );
        if (result.generation.status === "SUCCEEDED") {
          const { assets: fresh } = await api<{ assets: Asset[] }>(`/api/projects/${project.id}/assets`);
          setAssets(fresh);
          if (result.generation.outputAssetId) {
            setSelectedAssetId(result.generation.outputAssetId);
            setProject((current) => ({ ...current, selectedAssetId: result.generation.outputAssetId }));
          }
          setMessage("Your generated media is saved in this project.");
          const available = await refreshCredits();
          if (available !== null) setCreditsAvailable(available);
        }
        if (result.generation.status === "FAILED") {
          setError(result.generation.error || "Generation failed. Reserved credits were released.");
          await refreshCredits();
        }
        if (result.generation.status === "CANCELED") {
          setMessage("Generation cancelled. Reserved credits were released.");
          await refreshCredits();
        }
      } catch {
        // A transient poll failure must not stop the job.
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeId, project.id]);

  // Estimate the selected generation.
  useEffect(() => {
    if (tab !== "generate" || !activeModel) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setEstimating(true);
      setEstimateError("");
      try {
        const result = await api<{ estimate: Estimate; available: number }>("/api/generations/estimate", {
          method: "POST",
          body: JSON.stringify({
            projectId: project.id,
            modelId: activeModel.id,
            capability: action,
            prompt: project.prompt || "estimate",
            durationSeconds: activeDuration,
            aspect: project.aspect,
            resolution: activeResolution,
            imageCount,
            sourceAssetId: activeSourceId || null,
          }),
        });
        if (cancelled) return;
        setEstimate(result.estimate);
        setCreditsAvailable(result.available);
        setApproved(false);
      } catch (caught) {
        if (cancelled) return;
        setEstimate(null);
        setEstimateError(caught instanceof Error ? caught.message : "Could not estimate this generation.");
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 420);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, activeModel, action, activeDuration, imageCount, activeResolution, project.prompt, project.aspect, project.id, activeSourceId]);

  // Estimate captions when the captions tab is open.
  useEffect(() => {
    if (tab !== "captions" || !transcriptionModel) return;
    let cancelled = false;
    api<{ estimate: Estimate }>("/api/generations/estimate", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        modelId: transcriptionModel.id,
        capability: "transcription",
        prompt: "Audio transcription",
        durationSeconds: Math.max(1, Math.round(Math.max(0, (project.trimEnd || mediaDuration) - project.trimStart))),
      }),
    })
      .then((result) => {
        if (!cancelled) setCaptionEstimate(result.estimate);
      })
      .catch(() => {
        if (!cancelled) setCaptionEstimate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, transcriptionModel, project.id, project.trimStart, project.trimEnd, mediaDuration]);

  const update = useCallback((patch: Partial<Project>) => {
    setProject((current) => ({ ...current, ...patch }));
  }, []);

  function selectAsset(asset: Asset) {
    setSelectedAssetId(asset.id);
    update({ selectedAssetId: asset.id });
    setVideoDuration(0);
    setPlayhead(0);
    setSourceAssetId("");
  }

  async function upload(file?: File) {
    if (!file) return;
    setBusy("upload");
    setError("");
    setMessage("");
    try {
      const result = await api<{ asset: Asset }>(`/api/projects/${project.id}/assets`, {
        method: "POST",
        headers: {
          "content-type": file.type || "video/mp4",
          "x-file-name": encodeURIComponent(file.name),
          "x-file-size": String(file.size),
        },
        body: file,
      });
      setAssets((current) => [result.asset, ...current]);
      selectAsset(result.asset);
      setMessage("Media uploaded and saved to this project.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setBusy("");
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  async function removeAsset(asset: Asset) {
    if (!window.confirm(`Delete “${asset.fileName}” from this project?`)) return;
    try {
      await api(`/api/assets/${asset.id}`, { method: "DELETE" });
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      if (selectedAssetId === asset.id) {
        const next = assets.find((item) => item.id !== asset.id);
        setSelectedAssetId(next?.id ?? "");
        update({ selectedAssetId: next?.id ?? null });
      }
      setMessage("Media deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete media.");
    }
  }

  async function generate() {
    setError("");
    setMessage("");
    if (!activeModel) {
      setError("Choose an AI model first.");
      return;
    }
    if (!project.prompt.trim() || project.prompt.trim().length < 5) {
      setError("Describe what you want to create first.");
      return;
    }
    if (!estimate) {
      setError(estimateError || "Wait for the estimate before generating.");
      return;
    }
    if (!approved) {
      setError("Confirm the credit cost before starting a paid generation.");
      return;
    }
    if (usage.concurrentJobs >= limits.maxConcurrentJobs) {
      setError(`Your plan allows ${limits.maxConcurrentJobs} concurrent job(s). Wait for one to finish.`);
      return;
    }
    setBusy("generate");
    setApproved(false);
    try {
      const source = needsSource(action) ? activeSourceId : undefined;
      if (needsSource(action) && !source) {
        setError("Choose a source file for this action.");
        return;
      }
      const result = await api<{ generation: Generation }>("/api/generations", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          modelId: activeModel.id,
          capability: action,
          prompt: project.prompt,
          durationSeconds: activeDuration,
          aspect: project.aspect,
          resolution: activeResolution,
          imageCount,
          sourceAssetId: source ?? null,
          idempotencyKey: crypto.randomUUID(),
          confirmedCredits: estimate.credits,
        }),
      });
      setGenerations((current) => [result.generation, ...current]);
      setCreditsAvailable((current) => Math.max(0, current - result.generation.creditsReserved));
      setMessage("Generation started. You can keep editing — it survives page refreshes.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the generation.");
    } finally {
      setBusy("");
    }
  }

  async function cancel(job: Generation) {
    setBusy(`cancel:${job.id}`);
    try {
      const result = await api<{ generation: Generation }>(`/api/generations/${job.id}/cancel`, { method: "POST" });
      setGenerations((current) => current.map((item) => (item.id === result.generation.id ? result.generation : item)));
      setMessage("Generation cancelled. Reserved credits were released.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel this job.");
    } finally {
      setBusy("");
    }
  }

  async function enhancePrompt() {
    if (!project.prompt.trim()) {
      setError("Write an idea first.");
      return;
    }
    setError("");
    try {
      const model = models.find((candidate) => candidate.capabilities.includes("prompt_enhance") && candidate.planAllowed);
      if (!model) {
        setError("Your plan does not include a prompt-enhancement model.");
        return;
      }
      const quote = await api<{ estimate: Estimate }>("/api/generations/estimate", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          modelId: model.id,
          capability: "prompt_enhance",
          prompt: project.prompt,
          durationSeconds: 1,
        }),
      });
      setEnhanceEstimate(quote.estimate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not price prompt enhancement.");
    }
  }

  async function confirmEnhance() {
    if (!enhanceEstimate) return;
    setEnhancing(true);
    setError("");
    try {
      const result = await api<{ prompt: string; creditsCharged: number }>("/api/prompt/enhance", {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, prompt: project.prompt }),
      });
      update({ prompt: result.prompt });
      setCreditsAvailable((current) => Math.max(0, current - result.creditsCharged));
      setMessage(`Prompt improved for ${result.creditsCharged} credits.`);
      setEnhanceEstimate(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Prompt enhancement failed.");
    } finally {
      setEnhancing(false);
    }
  }

  function addCaption() {
    update({
      captions: [
        ...project.captions,
        { start: Math.max(0, playhead), end: Math.min(mediaDuration, playhead + 2.5), text: "Add your caption" },
      ],
    });
  }

  async function importSrt(file?: File) {
    if (!file) return;
    const text = await file.text();
    const blocks = text.trim().split(/\r?\n\s*\r?\n/);
    const captions: Caption[] = blocks
      .map((block) => {
        const lines = block.split(/\r?\n/);
        const time = lines.find((line) => line.includes("-->"));
        if (!time) return null;
        const [start, end] = time.split("-->").map((value) => {
          const [h, m, s] = value.trim().replace(",", ".").split(":").map(Number);
          return h * 3600 + m * 60 + s;
        });
        return { start, end, text: lines.slice(lines.indexOf(time) + 1).join(" ").trim() };
      })
      .filter((value): value is Caption => Boolean(value && value.text));
    update({ captions });
    setMessage(`${captions.length} caption lines imported.`);
    if (srtRef.current) srtRef.current.value = "";
  }

  function downloadSrt() {
    const text = project.captions
      .map((caption, index) => `${index + 1}\n${srtTime(caption.start)} --> ${srtTime(caption.end)}\n${caption.text}`)
      .join("\n\n");
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([text], { type: "text/srt" }));
    anchor.download = `${project.name || "captions"}.srt`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  async function autoCaptions() {
    const video = videoRef.current;
    if (!video || !selectedAsset || !isVideoAsset) {
      setError("Select a video before creating captions.");
      return;
    }
    if (!captionApproved) {
      setError("Approve the transcription cost first.");
      return;
    }
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (!capture || !window.MediaRecorder) {
      setError("This browser cannot capture video audio. Import an SRT file instead.");
      return;
    }
    setBusy("captions");
    setError("");
    setMessage("");
    setCaptionApproved(false);
    try {
      const start = Math.max(0, project.trimStart);
      const end = Math.min(video.duration || mediaDuration, project.trimEnd > start ? project.trimEnd : video.duration || mediaDuration);
      if (end - start < 0.5) throw new Error("Choose a caption range of at least half a second.");
      video.pause();
      video.currentTime = start;
      const media = capture.call(video);
      const audioTracks = media.getAudioTracks();
      if (!audioTracks.length) throw new Error("No audio track found. Add captions manually or import an SRT file.");
      const audioStream = new MediaStream(audioTracks);
      const recorder = new MediaRecorder(audioStream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm",
      });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("Audio capture stopped unexpectedly."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      });
      recorder.start(1000);
      await video.play();
      await new Promise<void>((resolve, reject) => {
        video.ontimeupdate = () => {
          if (video.currentTime >= end) {
            video.pause();
            resolve();
          }
        };
        video.onended = () => resolve();
        video.onerror = () => reject(new Error("Video playback failed during caption capture."));
      });
      recorder.stop();
      audioTracks.forEach((track) => track.stop());
      const audio = await finished;
      if (audio.size > 25 * 1024 * 1024) throw new Error("Captured audio is over 25 MB. Trim the clip first.");
      const body = new FormData();
      body.append("projectId", project.id);
      body.append("offset", String(start));
      body.append("duration", String(Math.max(1, Math.round(end - start))));
      body.append("file", audio, "studio-audio.webm");
      const result = await api<{ captions: Caption[]; creditsCharged: number }>("/api/transcribe", {
        method: "POST",
        body,
      });
      update({ captions: result.captions });
      setCreditsAvailable((current) => Math.max(0, current - result.creditsCharged));
      setMessage(`${result.captions.length} captions created · ${result.creditsCharged} credits.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Automatic captions failed.");
    } finally {
      if (video) {
        video.pause();
        video.currentTime = 0;
        video.onended = null;
        video.ontimeupdate = null;
      }
      setBusy("");
    }
  }

  async function exportVideo() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !selectedAsset || !isVideoAsset) {
      setError("Select a video to export.");
      return;
    }
    setError("");
    setMessage("");
    setExporting(true);
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Video renderer is unavailable in this browser.");
      const [w, h] = project.aspect === "9:16" ? [720, 1280] : project.aspect === "1:1" ? [1080, 1080] : [1280, 720];
      canvas.width = w;
      canvas.height = h;
      const start = Math.max(0, project.trimStart);
      const end = Math.min(video.duration || mediaDuration, project.trimEnd > start ? project.trimEnd : video.duration || mediaDuration);
      if (end - start < 0.5) throw new Error("Choose a trim range of at least half a second.");
      const draw = () => {
        context.fillStyle = "#090b10";
        context.fillRect(0, 0, w, h);
        const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
        const dw = video.videoWidth * scale;
        const dh = video.videoHeight * scale;
        context.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
        if (project.overlayTitle.trim()) {
          context.textAlign = "center";
          context.textBaseline = "top";
          context.font = `700 ${Math.round(w * 0.055)}px Inter, system-ui`;
          context.lineWidth = Math.max(3, w * 0.004);
          context.strokeStyle = "#111";
          context.fillStyle = "#fff";
          context.strokeText(project.overlayTitle, w / 2, h * 0.08, w * 0.84);
          context.fillText(project.overlayTitle, w / 2, h * 0.08, w * 0.84);
        }
        const caption = project.captionEnabled
          ? project.captions.find((item) => video.currentTime >= item.start && video.currentTime <= item.end)
          : null;
        if (caption) {
          context.textAlign = "center";
          context.textBaseline = "bottom";
          const font = Math.round(w * 0.042);
          context.font = `700 ${font}px Inter, system-ui`;
          const lines = caption.text.match(/.{1,34}(?:\s|$)/g) || [caption.text];
          const lineHeight = font * 1.25;
          const y = h * 0.9 - (lines.length - 1) * lineHeight;
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index].trim();
            const width = Math.min(w * 0.88, context.measureText(line).width + 40);
            const py = y + index * lineHeight;
            context.fillStyle = "rgba(0,0,0,.76)";
            context.fillRect((w - width) / 2, py - lineHeight + 2, width, lineHeight + 8);
            context.fillStyle = "#fff";
            context.fillText(line, w / 2, py, w * 0.86);
          }
        }
      };
      const stream = canvas.captureStream(30);
      const source = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
      source?.getAudioTracks().forEach((track) => stream.addTrack(track));
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 7_000_000 });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      await new Promise<void>(async (resolve, reject) => {
        recorder.onerror = () => reject(new Error("Video export failed while recording."));
        recorder.onstop = () => resolve();
        const finish = () => {
          video.pause();
          if (recorder.state !== "inactive") recorder.stop();
        };
        const frame = () => {
          if (video.currentTime >= end || video.ended) {
            finish();
            return;
          }
          draw();
          requestAnimationFrame(frame);
        };
        video.currentTime = start;
        await new Promise<void>((done) => {
          video.onseeked = () => done();
        });
        recorder.start(250);
        await video.play();
        requestAnimationFrame(frame);
      });
      const blob = new Blob(chunks, { type: mime });
      if (blob.size < 500) throw new Error("Export produced an empty file. Try playing the clip first.");
      const outName = `${(project.name || "video").replace(/[^\w -]/g, "").trim() || "video"}-export.webm`;
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = outName;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      const saved = await api<{ asset: Asset }>(`/api/projects/${project.id}/assets`, {
        method: "POST",
        headers: {
          "content-type": "video/webm",
          "x-file-name": encodeURIComponent(outName),
          "x-file-size": String(blob.size),
        },
        body: blob,
      });
      setAssets((current) => [saved.asset, ...current]);
      setMessage("Export downloaded and saved to your project.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export could not finish.");
    } finally {
      if (videoRef.current) videoRef.current.onseeked = null;
      setExporting(false);
    }
  }

  const activeEstimate = estimate;
  const affordable = activeEstimate ? creditsAvailable >= activeEstimate.credits : false;
  const usageLabel = mode === "video" ? `${usage.videos}/${limits.videoLimit < 0 ? "∞" : limits.videoLimit} videos` : `${usage.images}/${limits.imageLimit < 0 ? "∞" : limits.imageLimit} images`;

  return (
    <div className="studio-layout">
      <div className="studio-stage">
        <div className="row-between wrap" style={{ gap: 10 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <input
              className="input"
              style={{ maxWidth: 260, fontWeight: 600 }}
              value={project.name}
              aria-label="Project name"
              maxLength={100}
              onChange={(event) => update({ name: event.target.value })}
            />
            <span className={`badge ${saveState === "error" ? "badge-danger" : saveState === "saving" ? "badge-warn" : "badge-ok"}`}>
              {saveState === "saving" ? <LoaderCircle size={11} className="spin" /> : <Check size={11} />}
              {saveState === "saving" ? "Saving" : saveState === "error" ? "Save failed" : "Saved"}
            </span>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => uploadRef.current?.click()} disabled={busy !== ""}>
              <Upload size={14} /> Import media
            </button>
            <input ref={uploadRef} type="file" accept="video/*,image/*" hidden onChange={(event) => upload(event.target.files?.[0])} />
            <a className="btn btn-ghost btn-sm" href="/projects">All projects</a>
          </div>
        </div>

        {error ? (
          <div className="notice notice-error">
            <XCircle size={16} />
            <span style={{ flex: 1 }}>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError("")} aria-label="Dismiss"><X size={13} /></button>
          </div>
        ) : null}
        {message ? (
          <div className="notice notice-success">
            <CheckCircle2 size={16} />
            <span style={{ flex: 1 }}>{message}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setMessage("")} aria-label="Dismiss"><X size={13} /></button>
          </div>
        ) : null}

        <div className="preview-box">
          <div className="preview-head">
            <span className="row" style={{ gap: 6 }}><Play size={12} /> PREVIEW</span>
            {selectedAsset ? <span className="file">{selectedAsset.fileName}</span> : null}
            <span style={{ marginLeft: "auto" }} className="badge badge-muted">{project.aspect}</span>
          </div>
          <div
            className="preview-screen"
            style={project.aspect === "9:16" ? { aspectRatio: "9 / 16", maxHeight: "58vh", width: "auto", margin: "0 auto" } : project.aspect === "1:1" ? { aspectRatio: "1 / 1", maxHeight: "58vh", width: "auto", margin: "0 auto" } : undefined}
          >
            {selectedAsset && isVideoAsset ? (
              <>
                <video
                  ref={videoRef}
                  src={selectedAsset.url}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => {
                    if (Number.isFinite(event.currentTarget.duration)) setVideoDuration(event.currentTarget.duration);
                  }}
                  onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onClick={(event) => { if (event.currentTarget.paused) void event.currentTarget.play(); else event.currentTarget.pause(); }}
                />
                {project.overlayTitle ? <div className="preview-title">{project.overlayTitle}</div> : null}
                {project.captionEnabled
                  ? project.captions
                      .filter((caption) => playhead >= caption.start && playhead <= caption.end)
                      .map((caption, index) => <div className="preview-caption" key={index}>{caption.text}</div>)
                  : null}
              </>
            ) : selectedAsset && isImageAsset ? (
              <img src={selectedAsset.url} alt={selectedAsset.fileName} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <div className="preview-empty">
                <div className="empty-icon"><Film size={24} /></div>
                <strong>Your edit starts here</strong>
                <span>Import footage or generate an image or clip with AI.</span>
                <div className="row wrap" style={{ justifyContent: "center", marginTop: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => uploadRef.current?.click()}>
                    <Upload size={14} /> Import media
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => setTab("generate")}>
                    <Sparkles size={14} /> Generate
                  </button>
                </div>
              </div>
            )}
          </div>
          {isVideoAsset ? (
            <>
              <div className="preview-controls">
                <button
                  className="control-round"
                  aria-label="Back one frame"
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = Math.max(0, playhead - 0.04);
                  }}
                >|◀</button>
                <button
                  className="control-round control-play"
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={() => {
                    const video = videoRef.current;
                    if (video?.paused) void video.play();
                    else video?.pause();
                  }}
                >
                  {playing ? "Ⅱ" : <Play size={14} fill="currentColor" />}
                </button>
                <button
                  className="control-round"
                  aria-label="Forward one frame"
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = Math.min(mediaDuration, playhead + 0.04);
                  }}
                >▶|</button>
                <span className="timecode">{timecode(playhead)} <i>/</i> {timecode(mediaDuration)}</span>
                <span style={{ flex: 1 }} />
                <span className="tiny muted">{project.aspect} · 30 FPS</span>
              </div>
              <input
                className="scrub"
                aria-label="Playhead"
                type="range"
                min={0}
                max={mediaDuration || 5}
                step={0.02}
                value={Math.min(playhead, mediaDuration || 5)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setPlayhead(value);
                  if (videoRef.current) videoRef.current.currentTime = value;
                }}
              />
            </>
          ) : null}
        </div>

        <div className="timeline">
          <div className="timeline-head">
            <strong><Activity size={13} /> TIMELINE <span className="muted" style={{ fontWeight: 400 }}>{selectedAsset ? "1 clip" : "Empty"}</span></strong>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={addCaption}><Plus size={12} /> Caption</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setTab("captions")}><Subtitles size={13} /> Manage</button>
            </div>
          </div>
          <div className="track">
            <div className="track-icon"><Film size={13} /></div>
            <div className="track-body">
              <div className="ruler">
                {Array.from({ length: 6 }, (_, index) => <span key={index}>{timecode(mediaDuration * index / 5)}</span>)}
              </div>
              <div className="lane">
                {selectedAsset ? (
                  <div
                    className="clip"
                    style={{
                      left: `${Math.min(40, (project.trimStart / (mediaDuration || 1)) * 100)}%`,
                      right: `${Math.max(0, 100 - ((project.trimEnd > project.trimStart ? project.trimEnd : mediaDuration) / (mediaDuration || 1)) * 100)}%`,
                    }}
                  >
                    {isImageAsset ? <ImageIcon size={12} /> : <Film size={12} />}
                    <span className="truncate">{selectedAsset.fileName}</span>
                  </div>
                ) : (
                  <span className="track-empty tiny muted" style={{ position: "absolute", left: 9, top: 8 }}>Import or generate media to add a clip</span>
                )}
                <div className="playhead" style={{ left: `${Math.min(100, (playhead / (mediaDuration || 1)) * 100)}%` }} />
              </div>
            </div>
          </div>
          <div className="track">
            <div className="track-icon"><Subtitles size={13} /></div>
            <div className="track-body">
              <div className="ruler"><span>CAPTIONS</span><span>{project.captions.length} lines</span></div>
              <div className="lane">
                {project.captions.length ? (
                  project.captions.map((caption, index) => (
                    <button
                      key={index}
                      className="caption-clip"
                      title={caption.text}
                      style={{
                        left: `${Math.min(96, (caption.start / (mediaDuration || 1)) * 100)}%`,
                        width: `${Math.max(3, Math.min(45, ((caption.end - caption.start) / (mediaDuration || 1)) * 100))}%`,
                      }}
                      onClick={() => {
                        setTab("captions");
                        setPlayhead(caption.start);
                        if (videoRef.current) videoRef.current.currentTime = caption.start;
                      }}
                    >
                      {caption.text}
                    </button>
                  ))
                ) : (
                  <button className="track-empty tiny muted" style={{ position: "absolute", left: 9, top: 8, border: 0, background: "transparent", padding: 0 }} onClick={() => setTab("captions")}>
                    Add subtitles to your video
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="trim-row">
            <Scissors size={13} /> <span className="tiny" style={{ letterSpacing: "0.08em" }}>TRIM</span>
            <label className="row" style={{ gap: 5 }}>In
              <input className="input" type="number" min={0} max={mediaDuration} step={0.1} value={project.trimStart} onChange={(event) => update({ trimStart: Number(event.target.value) })} />
            </label>
            <label className="row" style={{ gap: 5 }}>Out
              <input className="input" type="number" min={0} max={mediaDuration} step={0.1} value={project.trimEnd || mediaDuration} onChange={(event) => update({ trimEnd: Number(event.target.value) })} />
            </label>
            <span className="tiny muted" style={{ marginLeft: "auto" }}>Trim and overlays apply to export</span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Media in this project</h3>
              <p>{assets.length} files · {selectedAsset ? `selected: ${selectedAsset.fileName}` : "nothing selected"}</p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => uploadRef.current?.click()} disabled={busy !== ""}>
              <Upload size={13} /> Add
            </button>
          </div>
          <div className="card-body">
            {assets.length ? (
              <div className="row wrap" style={{ gap: 8 }}>
                {assets.map((asset) => (
                  <div key={asset.id} className={`media-row ${selectedAssetId === asset.id ? "selected" : ""}`} style={{ width: "auto", minWidth: 180, maxWidth: 280 }}>
                    <button className="row" style={{ gap: 6, flex: 1, border: 0, background: "transparent", padding: 0, minWidth: 0 }} onClick={() => selectAsset(asset)}>
                      {asset.contentType.startsWith("image/") ? <ImageIcon size={13} /> : <Film size={13} />}
                      <span title={asset.fileName}>{asset.fileName}</span>
                    </button>
                    <button className="btn btn-ghost btn-sm" aria-label={`Delete ${asset.fileName}`} onClick={() => removeAsset(asset)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty" style={{ padding: "24px 14px" }}>
                <div className="empty-icon"><Upload size={20} /></div>
                <strong>No media yet</strong>
                <p>Upload a video or image, or generate one with AI.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="inspector-panel">
        <div className="tabs-row">
          {([
            ["generate", Sparkles, "Generate"],
            ["edit", Scissors, "Edit"],
            ["captions", Subtitles, "Captions"],
            ["export", Download, "Export"],
          ] as const).map(([key, Icon, label]) => (
            <button key={key} className={`tab-btn ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="inspector-body">
          {tab === "generate" ? (
            <>
              <div className="row-between">
                <span className="badge badge-lime">{planName ?? "No plan"}</span>
                <span className="tiny muted">{creditsAvailable} credits</span>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 12 }}>
                <button className={`tab-btn ${mode === "video" ? "active" : ""}`} onClick={() => { setMode("video"); setAction("text_to_video"); setApproved(false); }}>
                  <Film size={13} /> Video
                </button>
                <button className={`tab-btn ${mode === "image" ? "active" : ""}`} onClick={() => { setMode("image"); setAction("text_to_image"); setApproved(false); }}>
                  <ImageIcon size={13} /> Image
                </button>
              </div>

              <div className="field mt-2">
                <label className="label" htmlFor="prompt">Creative brief</label>
                <textarea
                  id="prompt"
                  className="textarea"
                  style={{ minHeight: 108 }}
                  maxLength={1800}
                  value={project.prompt}
                  onChange={(event) => update({ prompt: event.target.value })}
                  placeholder="A cinematic close-up of a coffee cup on a rain-speckled windowsill. Warm light, slow push-in, premium editorial feel."
                />
                <div className="row-between">
                  <span className="hint">{project.prompt.length}/1800</span>
                  <button className="btn btn-ghost btn-sm" onClick={enhancePrompt} disabled={enhancing || !project.prompt.trim()}>
                    <WandSparkles size={12} /> Improve
                  </button>
                </div>
                {enhanceEstimate ? (
                  <div className="cost-box" style={{ marginTop: 8 }}>
                    <div className="cost-line"><span>Prompt enhancement</span><b>{enhanceEstimate.credits} cr</b></div>
                    <p>{enhanceEstimate.priceLabel} · uses {enhanceEstimate.credits} credits</p>
                    <div className="row mt-1">
                      <button className="btn btn-primary btn-sm" onClick={confirmEnhance} disabled={enhancing}>
                        {enhancing ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} Confirm
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEnhanceEstimate(null)}>Cancel</button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="action">Generation type</label>
                <select
                  id="action"
                  className="select"
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value as typeof action);
                    setApproved(false);
                  }}
                >
                  {mode === "video" ? (
                    <>
                      <option value="text_to_video">Text to video</option>
                      <option value="image_to_video">Animate an image</option>
                      <option value="video_to_video">Restyle a video</option>
                    </>
                  ) : (
                    <>
                      <option value="text_to_image">Text to image</option>
                      <option value="image_edit">Edit an image</option>
                    </>
                  )}
                </select>
              </div>

              {needsSource(action) ? (
                <div className="field">
                  <label className="label" htmlFor="source">Source file</label>
                  <select id="source" className="select" value={activeSourceId} onChange={(event) => { setSourceAssetId(event.target.value); setApproved(false); }}>
                    <option value="">Choose a file…</option>
                    {assets
                      .filter((asset) => (action === "video_to_video" ? asset.contentType.startsWith("video/") : asset.contentType.startsWith("image/")))
                      .map((asset) => (
                        <option key={asset.id} value={asset.id}>{asset.fileName}</option>
                      ))}
                  </select>
                </div>
              ) : null}

              <div className="field">
                <label className="label">AI model</label>
                <div style={{ maxHeight: 222, overflowY: "auto" }}>
                  {capabilityModels.length ? (
                    capabilityModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className={`model-option ${activeModelId === model.id ? "selected" : ""} ${model.planAllowed ? "" : "locked"}`}
                        onClick={() => {
                          if (!model.planAllowed) return;
                          setSelectedModelId(model.id);
                          setApproved(false);
                        }}
                        disabled={!model.planAllowed}
                      >
                        <span className="model-radio" />
                        <span style={{ minWidth: 0 }}>
                          <b>{model.name}</b>
                          <span>{model.provider} · {CAPABILITY_LABEL[action]}</span>
                          {!model.planAllowed ? <span className="badge badge-warn" style={{ marginTop: 5 }}><Lock size={10} /> Upgrade required</span> : null}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="muted small">No model supports this action on your plan.</p>
                  )}
                </div>
              </div>

              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="aspect">Aspect</label>
                  <select id="aspect" className="select" value={project.aspect} onChange={(event) => update({ aspect: event.target.value })}>
                    <option value="16:9">Landscape · 16:9</option>
                    <option value="9:16">Portrait · 9:16</option>
                    <option value="1:1">Square · 1:1</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="resolution">Resolution</label>
                  <select id="resolution" className="select" value={activeResolution} onChange={(event) => { setResolution(event.target.value); setApproved(false); }}>
                    {resolutionOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                {mode === "video" ? (
                  <div className="field">
                    <label className="label" htmlFor="duration">Duration (seconds)</label>
                    <input id="duration" className="input" type="number" min={1} max={maxDuration} value={activeDuration} onChange={(event) => { setDuration(Number(event.target.value)); setApproved(false); }} />
                  </div>
                ) : (
                  <div className="field">
                    <label className="label" htmlFor="count">Images</label>
                    <select id="count" className="select" value={imageCount} onChange={(event) => { setImageCount(Number(event.target.value)); setApproved(false); }}>
                      {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="cost-box">
                <div className="cost-line">
                  <span>Estimated cost</span>
                  <b>{estimating ? "…" : activeEstimate ? `${activeEstimate.credits} cr` : "—"}</b>
                </div>
                <p>
                  {estimateError
                    ? estimateError
                    : activeEstimate
                      ? `${activeEstimate.priceLabel} · ${activeEstimate.units} ${activeEstimate.unitKind}(s)${activeEstimate.estimated ? " · estimated" : ""}`
                      : "Waiting for a price…"}
                </p>
                <label className="checkbox mt-1">
                  <input type="checkbox" checked={approved} disabled={!activeEstimate || !affordable} onChange={(event) => setApproved(event.target.checked)} />
                  <span>I approve spending {activeEstimate?.credits ?? 0} credits on this generation.</span>
                </label>
                {!affordable && activeEstimate ? (
                  <p className="error-text tiny mt-1">Not enough available credits. <a href="/billing" style={{ color: "var(--lime)" }}>Buy credits</a>.</p>
                ) : null}
              </div>

              <button className="btn btn-primary btn-block" onClick={generate} disabled={!!busy || !approved || !affordable || !activeEstimate}>
                {busy === "generate" ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                {busy === "generate" ? "Starting…" : mode === "video" ? "Generate video" : "Generate image"}
              </button>
              <p className="tiny muted mt-2" style={{ textAlign: "center" }}>
                {usageLabel} used · {limits.maxConcurrentJobs} concurrent slot(s)
              </p>

              {activeGeneration ? (
                <div className="card card-pad mt-3" style={{ padding: 12 }}>
                  <div className="row" style={{ gap: 9 }}>
                    <LoaderCircle className="spin" size={15} style={{ color: "var(--lime)" }} />
                    <div style={{ flex: 1 }}>
                      <b className="small">{activeGeneration.modelName ?? "Generation"} · {activeGeneration.status.toLowerCase()}</b>
                      <div className="tiny muted">
                        {activeGeneration.creditsReserved} credits reserved · survives page refresh
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm mt-2" onClick={() => cancel(activeGeneration)} disabled={busy === `cancel:${activeGeneration.id}`}>
                    {busy === `cancel:${activeGeneration.id}` ? <LoaderCircle className="spin" size={12} /> : <X size={12} />} Cancel job
                  </button>
                </div>
              ) : null}

              {generations.filter((job) => ["FAILED", "CANCELED"].includes(job.status)).slice(0, 1).map((job) => (
                <div className="notice notice-error mt-2" key={job.id}>
                  <XCircle size={14} /> <span>{job.error || "The last generation did not complete. Credits were released."}</span>
                </div>
              ))}
            </>
          ) : null}

          {tab === "edit" ? (
            <>
              <h3 style={{ fontSize: 15 }}>Canvas &amp; overlays</h3>
              <div className="field mt-2">
                <label className="label">Aspect ratio</label>
                <div className="row" style={{ gap: 6 }}>
                  {["16:9", "9:16", "1:1"].map((value) => (
                    <button key={value} className={`btn btn-sm ${project.aspect === value ? "btn-primary" : "btn-secondary"}`} style={{ flex: 1 }} onClick={() => update({ aspect: value })}>
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="title">On-screen title</label>
                <input id="title" className="input" maxLength={120} placeholder="e.g. A taste of summer" value={project.overlayTitle} onChange={(event) => update({ overlayTitle: event.target.value })} />
                <span className="hint">Appears in the preview and burned into the export.</span>
              </div>
              <div className="field">
                <label className="label">Trim</label>
                <div className="form-grid">
                  <input className="input" type="number" min={0} step={0.1} value={project.trimStart} aria-label="Trim in" onChange={(event) => update({ trimStart: Number(event.target.value) })} />
                  <input className="input" type="number" min={0} step={0.1} value={project.trimEnd || mediaDuration} aria-label="Trim out" onChange={(event) => update({ trimEnd: Number(event.target.value) })} />
                </div>
                <span className="hint">In / out points in seconds.</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="select-media">Preview media</label>
                <select id="select-media" className="select" value={selectedAssetId} onChange={(event) => {
                  const asset = assets.find((item) => item.id === event.target.value);
                  if (asset) selectAsset(asset);
                }}>
                  {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.fileName}</option>)}
                </select>
              </div>
              <div className="notice notice-info">
                <ImageIcon size={15} />
                <span className="small">Images can be animated from the Generate tab. Video trimming and export are available on video assets.</span>
              </div>
            </>
          ) : null}

          {tab === "captions" ? (
            <>
              <h3 style={{ fontSize: 15 }}>Captions &amp; subtitles</h3>
              <p className="hint mt-1">
                Automatic captions send the selected range&apos;s audio to {models.find((model) => model.capabilities.includes("transcription"))?.provider ?? "the transcription provider"}.
              </p>
              <div className="cost-box">
                <div className="cost-line"><span>Transcription estimate</span><b>{transcriptionModel && captionEstimate ? `${captionEstimate.credits} cr` : "—"}</b></div>
                <p>{transcriptionModel && captionEstimate ? `${captionEstimate.priceLabel} · ${captionEstimate.units} minute(s)` : "Select a video and range to price captions."}</p>
                <label className="checkbox mt-1">
                  <input type="checkbox" checked={captionApproved} onChange={(event) => setCaptionApproved(event.target.checked)} disabled={!transcriptionModel || !captionEstimate} />
                  <span>I approve this transcription charge.</span>
                </label>
              </div>
              <button className="btn btn-primary btn-block" onClick={autoCaptions} disabled={!!busy || !isVideoAsset || !captionApproved || !transcriptionModel}>
                {busy === "captions" ? <LoaderCircle className="spin" size={15} /> : <AudioLines size={15} />}
                {busy === "captions" ? "Listening to video…" : "Generate captions with AI"}
              </button>
              <div className="row mt-2" style={{ gap: 6 }}>
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={addCaption}><Plus size={12} /> Add line</button>
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => srtRef.current?.click()}><Upload size={12} /> Import SRT</button>
                <input ref={srtRef} type="file" accept=".srt,text/plain" hidden onChange={(event) => importSrt(event.target.files?.[0])} />
              </div>
              <button className="btn btn-ghost btn-sm btn-block mt-1" onClick={downloadSrt} disabled={!project.captions.length}>
                <Download size={12} /> Download .SRT
              </button>
              <div className="row-between mt-3">
                <span className="label">CAPTION LINES</span>
                <button className="btn btn-ghost btn-sm" onClick={() => update({ captionEnabled: project.captionEnabled ? 0 : 1 })}>
                  {project.captionEnabled ? "Preview on" : "Preview off"}
                </button>
              </div>
              <div className="mt-1">
                {project.captions.length ? (
                  project.captions.map((caption, index) => (
                    <div className="caption-item" key={index}>
                      <button className="time-btn" onClick={() => {
                        setPlayhead(caption.start);
                        if (videoRef.current) videoRef.current.currentTime = caption.start;
                      }}>{timecode(caption.start)}</button>
                      <textarea
                        aria-label={`Caption ${index + 1}`}
                        value={caption.text}
                        onChange={(event) => update({ captions: project.captions.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })}
                      />
                      <button className="del" aria-label={`Delete caption ${index + 1}`} onClick={() => update({ captions: project.captions.filter((_, itemIndex) => itemIndex !== index) })}>
                        <X size={13} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty" style={{ padding: "20px 12px" }}>
                    <div className="empty-icon"><Subtitles size={19} /></div>
                    <strong>No captions yet</strong>
                    <p>Generate them from audio, import an SRT, or add lines at the playhead.</p>
                  </div>
                )}
              </div>
            </>
          ) : null}

          {tab === "export" ? (
            <>
              <h3 style={{ fontSize: 15 }}>Export</h3>
              <p className="hint mt-1">Renders the trimmed range with the title and enabled captions burned in.</p>
              <div className="output-spec mt-2" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "2px 12px" }}>
                <div className="row-between" style={{ padding: "9px 0", borderBottom: "1px solid var(--line)" }}><span className="small muted">Aspect</span><b className="small">{project.aspect}</b></div>
                <div className="row-between" style={{ padding: "9px 0", borderBottom: "1px solid var(--line)" }}><span className="small muted">Format</span><b className="small">WebM · VP9 / Opus</b></div>
                <div className="row-between" style={{ padding: "9px 0", borderBottom: "1px solid var(--line)" }}><span className="small muted">Trim length</span><b className="small">{timecode(Math.max(0, (project.trimEnd || mediaDuration) - project.trimStart))}</b></div>
                <div className="row-between" style={{ padding: "9px 0" }}><span className="small muted">Captions</span><b className="small">{project.captionEnabled && project.captions.length ? "Burned in" : "Not included"}</b></div>
              </div>
              {isVideoAsset ? (
                <button className="btn btn-primary btn-block mt-3" onClick={exportVideo} disabled={exporting}>
                  {exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
                  {exporting ? "Rendering in real time…" : "Render & download"}
                </button>
              ) : isImageAsset ? (
                <a className="btn btn-primary btn-block mt-3" href={`${selectedAsset?.url}?download=1`}>
                  <Download size={15} /> Download image
                </a>
              ) : (
                <div className="notice notice-warn mt-3">Select a video or image to export.</div>
              )}
              <p className="tiny muted mt-2">Browser export records in real time. Keep this tab open until it finishes. The file is downloaded and saved back to the project.</p>
              <div className="divider" />
              <h4 className="small" style={{ fontWeight: 600 }}>Recent jobs</h4>
              <div className="mt-1">
                {generations.slice(0, 5).map((job) => (
                  <div className="row-between" key={job.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                    <span className="tiny truncate" style={{ maxWidth: 170 }}>{job.modelName ?? job.capability}</span>
                    <span className={`badge ${job.status === "SUCCEEDED" ? "badge-ok" : job.status === "FAILED" ? "badge-danger" : "badge-warn"}`}>
                      {job.status.toLowerCase()}
                    </span>
                  </div>
                ))}
                {!generations.length ? <p className="tiny muted">No AI jobs yet.</p> : null}
              </div>
            </>
          ) : null}
        </div>
      </aside>
      <canvas ref={canvasRef} aria-hidden="true" style={{ position: "fixed", left: -9999, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

function needsSource(capability: string): boolean {
  return ["image_to_video", "video_to_video", "image_edit"].includes(capability);
}


