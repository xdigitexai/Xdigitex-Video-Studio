"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AudioLines, Check, ChevronDown, Clapperboard, Download, Film, FolderOpen, LoaderCircle, MonitorPlay, Plus, Scissors, Settings2, Sparkles, Subtitles, Upload, WandSparkles, X } from "lucide-react";

type Caption = { start: number; end: number; text: string };
type Project = { id: string; name: string; prompt: string; aspect: string; duration: number; trimStart: number; trimEnd: number; captions: Caption[]; overlayTitle:string; selectedAssetId:string|null; captionEnabled:number };
type Asset = { id: string; projectId: string; fileName: string; contentType: string; byteSize: number; kind: string; url: string };
type Generation = { id: string; status: string; prompt: string; outputAssetId: string | null; error: string | null };

const money = (n: number) => `$${n.toFixed(2)}`;
const timecode = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
const srtTime = (seconds: number) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const hh = Math.floor(ms / 3600000), mm = Math.floor((ms % 3600000) / 60000), ss = Math.floor((ms % 60000) / 1000), milli = ms % 1000;
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")},${String(milli).padStart(3,"0")}`;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }), ...init?.headers }, cache: "no-store" });
  const data = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${response.status}).`);
  return data as T;
}

export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState("Edit");
  const [playhead, setPlayhead] = useState(0);
  const [approvedCost, setApprovedCost] = useState(false);
  const [captionCostApproved, setCaptionCostApproved] = useState(false);
  const [aiMode, setAiMode] = useState<"generate"|"edit">("generate");
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const autosaveTimer = useRef<number | null>(null);

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) || assets[0];
  const duration = videoDuration || project?.duration || 5;
  const estimate = useMemo(() => aiMode === "edit" ? Math.max(Math.ceil(videoDuration || 0) * 0.28, 0.56) : (project?.duration || 5) * 0.12, [aiMode, project?.duration, videoDuration]);
  const clearNotices = () => { setError(""); setMessage(""); };

  const loadProject = useCallback(async (id: string) => {
    const [{ project: p }, { assets: a }] = await Promise.all([
      api<{project:Project}>(`/api/projects/${id}`), api<{assets:Asset[]}>(`/api/projects/${id}/assets`),
    ]);
    const { generation: g } = await api<{generation:Generation|null}>(`/api/generate?projectId=${encodeURIComponent(id)}`).catch(() => ({generation:null}));
    let visibleAssets = a;
    if (g?.status === "SUCCEEDED") {
      const fresh = await api<{assets:Asset[]}>(`/api/projects/${id}/assets`).catch(() => ({assets:a}));
      visibleAssets = fresh.assets;
    }
    const selected = p.selectedAssetId || visibleAssets[0]?.id || null;
    setProject({ ...p, selectedAssetId:selected }); setAssets(visibleAssets); setSelectedAssetId(selected || ""); setVideoDuration(0); setGeneration(g);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api<{projects:Project[]}>("/api/projects");
        if (cancelled) return;
        if (result.projects.length) { setProjects(result.projects); await loadProject(result.projects[0].id); }
        else {
          const created = await api<{project:Project}>("/api/projects", { method:"POST", body: JSON.stringify({ name:"Untitled video" }) });
          if (!cancelled) { setProject(created.project); setProjects([created.project]); }
        }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Studio could not load."); }
    })();
    return () => { cancelled = true; };
  }, [loadProject]);

  useEffect(() => {
    if (!project) return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(async () => {
      try {
        await api<{project:Project}>(`/api/projects/${project.id}`, { method:"PATCH", body:JSON.stringify(project) });
        setProjects((items) => items.map((item) => item.id === project.id ? project : item));
      } catch (e) { setError(e instanceof Error ? e.message : "Changes could not be saved."); }
    }, 550);
    return () => { if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current); };
  }, [project]);

  const activeProjectId = project?.id;
  const generationStatus = generation?.status;
  useEffect(() => {
    if (!activeProjectId || !generationStatus || ["SUCCEEDED","FAILED","CANCELED"].includes(generationStatus)) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await api<{generation:Generation|null}>(`/api/generate?projectId=${encodeURIComponent(activeProjectId)}`);
        if (!result.generation) return;
        setGeneration(result.generation);
        if (result.generation.status === "SUCCEEDED") {
          const { assets: list } = await api<{assets:Asset[]}>(`/api/projects/${activeProjectId}/assets`); setAssets(list); setSelectedAssetId(list[0]?.id || ""); setProject((current)=>current?{...current,selectedAssetId:list[0]?.id||null}:current); setMessage("Your generated video is saved in this project.");
        }
        if (result.generation.status === "FAILED") setError(result.generation.error || "Generation failed.");
      } catch (e) { setError(e instanceof Error ? e.message : "Could not check generation status."); }
    }, 6000);
    return () => window.clearInterval(timer);
  }, [activeProjectId, generationStatus]);

  const update = (patch: Partial<Project>) => setProject((current) => current ? { ...current, ...patch } : current);
  const createProject = async () => {
    clearNotices(); setBusy("project");
    try {
      const result = await api<{project:Project}>("/api/projects", { method:"POST", body:JSON.stringify({ name:"Untitled video" }) });
      setProjects((current) => [result.project, ...current]); setProject(result.project); setAssets([]); setSelectedAssetId(""); setVideoDuration(0); setGeneration(null); setTab("Edit");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create project."); }
    finally { setBusy(""); }
  };

  const upload = async (file?: File) => {
    if (!file || !project) return;
    clearNotices(); setBusy("upload");
    try {
      const result = await api<{asset:Asset}>(`/api/projects/${project.id}/assets`, { method:"POST", headers:{"content-type":file.type || "video/mp4", "x-file-name":encodeURIComponent(file.name), "x-file-size":String(file.size)}, body:file });
      setAssets((current) => [result.asset, ...current]); setSelectedAssetId(result.asset.id); update({selectedAssetId:result.asset.id}); setVideoDuration(0); setMessage("Video uploaded and saved to this project."); setTab("Edit"); setPlayhead(0);
    } catch (e) { setError(e instanceof Error ? e.message : "Video upload failed."); }
    finally { setBusy(""); if (uploadRef.current) uploadRef.current.value=""; }
  };

  const generate = async () => {
    if (!project || !project.prompt.trim()) { setError("Describe the clip you want to create first."); return; }
    if (aiMode === "edit" && (!selectedAsset || videoDuration < 2 || videoDuration > 30)) { setError("AI edit needs a selected source video between 2 and 30 seconds long."); return; }
    if (!approvedCost) { setError("Review and check the cost approval before starting a paid generation."); return; }
    clearNotices(); setBusy("generate"); setApprovedCost(false);
    try {
      const result = await api<{generation:Generation}>("/api/generate", { method:"POST", body:JSON.stringify({ projectId:project.id, prompt:project.prompt, mode:aiMode, assetId:selectedAsset?.id, duration:aiMode==="edit"?Math.ceil(videoDuration):project.duration, aspect:project.aspect, confirmedEstimate:estimate }) });
      setGeneration(result.generation); setTab("Generate"); setMessage("Generation started. You can keep editing while it renders.");
    } catch (e) { setError(e instanceof Error ? e.message : "Generation could not start."); }
    finally { setBusy(""); }
  };

  const addCaption = () => update({ captions:[...(project?.captions || []), { start:Math.max(0, playhead), end:Math.min(duration, playhead+2.5), text:"Add your caption" }] });
  const importSrt = async (file?: File) => {
    if (!file || !project) return;
    const text = await file.text();
    const blocks = text.trim().split(/\r?\n\s*\r?\n/);
    const captions: Caption[] = blocks.map((block) => {
      const lines = block.split(/\r?\n/); const time = lines.find((line) => line.includes("-->"));
      if (!time) return null;
      const [start, end] = time.split("-->").map((v) => { const [h,m,s] = v.trim().replace(",", ".").split(":").map(Number); return h*3600+m*60+s; });
      return { start, end, text:lines.slice(lines.indexOf(time)+1).join(" ").trim() };
    }).filter((v):v is Caption => !!v && !!v.text);
    update({ captions }); setMessage(`${captions.length} caption lines imported.`);
  };

  const downloadSrt = () => {
    const text = (project?.captions || []).map((caption, index) => `${index+1}\n${srtTime(caption.start)} --> ${srtTime(caption.end)}\n${caption.text}`).join("\n\n");
    const a = document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type:"text/srt"})); a.download=`${project?.name || "captions"}.srt`; a.click(); URL.revokeObjectURL(a.href);
  };

  const autoCaptions = async () => {
    const video = videoRef.current;
    if (!video || !project || !selectedAsset) { setError("Upload or generate a video before creating captions."); return; }
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (!capture || !window.MediaRecorder) { setError("This browser cannot capture the video audio. Import an SRT caption file instead."); return; }
    clearNotices(); setBusy("captions"); setCaptionCostApproved(false);
    try {
      const start=Math.max(0,project.trimStart), end=Math.min(video.duration||videoDuration,project.trimEnd>start?project.trimEnd:(video.duration||videoDuration));
      if(end-start<0.5)throw new Error("Choose a caption range of at least half a second.");
      video.pause(); video.currentTime=start;
      const media = capture.call(video); const audioTracks=media.getAudioTracks();
      if (!audioTracks.length) throw new Error("No audio track was found. You can still add captions manually or import an SRT file.");
      const audioStream = new MediaStream(audioTracks); const recorder = new MediaRecorder(audioStream, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm" });
      const chunks: BlobPart[]=[]; recorder.ondataavailable=(event)=>{ if(event.data.size) chunks.push(event.data); };
      const finished = new Promise<Blob>((resolve,reject)=>{ recorder.onerror=()=>reject(new Error("Audio capture stopped unexpectedly.")); recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType || "audio/webm"})); });
      recorder.start(1000); await video.play();
      await new Promise<void>((resolve,reject)=>{ video.ontimeupdate=()=>{if(video.currentTime>=end){video.pause();resolve();}}; video.onended=()=>resolve(); video.onerror=()=>reject(new Error("Video playback failed during caption capture.")); });
      recorder.stop(); audioTracks.forEach((track)=>track.stop());
      const audio=await finished;
      if (audio.size>25*1024*1024) throw new Error("Captured audio is over 25 MB. Trim the video or create captions from a shorter section.");
      const body=new FormData(); body.append("projectId",project.id); body.append("offset",String(start)); body.append("file",audio,audio.type.includes("mp4")?"studio-audio.mp4":"studio-audio.webm");
      const result=await api<{captions:Caption[]}>("/api/transcribe",{method:"POST",body});
      update({captions:result.captions}); setMessage(`${result.captions.length} captions created and saved.`);
    } catch(e) { setError(e instanceof Error ? e.message : "Automatic captions failed."); }
    finally { if(video) { video.pause(); video.currentTime=0; video.onended=null; video.ontimeupdate=null; } setBusy(""); }
  };

  const exportVideo = async () => {
    const video=videoRef.current, canvas=canvasRef.current;
    if(!video || !canvas || !selectedAsset || !project) return;
    clearNotices(); setExporting(true);
    try {
      const context=canvas.getContext("2d"); if(!context) throw new Error("Video renderer is unavailable in this browser.");
      const [w,h]=project.aspect==="9:16"?[720,1280]:project.aspect==="1:1"?[1080,1080]:[1280,720]; canvas.width=w; canvas.height=h;
      const start=Math.max(0,project.trimStart), end=Math.min(duration,project.trimEnd>start?project.trimEnd:duration); if(end-start<0.5) throw new Error("Choose a trim range of at least half a second.");
      const draw=()=>{
        context.fillStyle="#090b10"; context.fillRect(0,0,w,h);
        const scale=Math.max(w/video.videoWidth,h/video.videoHeight), dw=video.videoWidth*scale, dh=video.videoHeight*scale;
        context.drawImage(video,(w-dw)/2,(h-dh)/2,dw,dh);
        if(project.overlayTitle.trim()){ context.textAlign="center"; context.textBaseline="top"; context.font=`700 ${Math.round(w*.055)}px Inter, system-ui`; context.lineWidth=Math.max(3,w*.004); context.strokeStyle="#111"; context.fillStyle="#fff"; context.strokeText(project.overlayTitle,w/2,h*.08,w*.84); context.fillText(project.overlayTitle,w/2,h*.08,w*.84); }
        const caption=project.captionEnabled?project.captions.find((c)=>video.currentTime>=c.start&&video.currentTime<=c.end):null;
        if(caption){ context.textAlign="center"; context.textBaseline="bottom"; const font=Math.round(w*.042); context.font=`700 ${font}px Inter, system-ui`; const lines=caption.text.match(/.{1,34}(?:\s|$)/g)||[caption.text]; const lineHeight=font*1.25; const y=h*.9-(lines.length-1)*lineHeight;
          for(let i=0;i<lines.length;i++){ const line=lines[i].trim(); const width=Math.min(w*.88,context.measureText(line).width+40); const py=y+i*lineHeight; context.fillStyle="rgba(0,0,0,.76)"; context.fillRect((w-width)/2,py-lineHeight+2,width,lineHeight+8); context.fillStyle="#fff"; context.fillText(line,w/2,py,w*.86); }
        }
      };
      const stream=canvas.captureStream(30); const source=(video as HTMLVideoElement & {captureStream?:()=>MediaStream}).captureStream?.(); source?.getAudioTracks().forEach((track)=>stream.addTrack(track));
      const mime=MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")?"video/webm;codecs=vp9,opus":"video/webm";
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:7_000_000}); const chunks:BlobPart[]=[]; recorder.ondataavailable=(event)=>{if(event.data.size)chunks.push(event.data);};
      await new Promise<void>(async(resolve,reject)=>{
        recorder.onerror=()=>reject(new Error("Video export failed while recording.")); recorder.onstop=()=>resolve();
        const finish=()=>{video.pause(); if(recorder.state!=="inactive")recorder.stop();};
        const frame=()=>{ if(video.currentTime>=end||video.ended){finish();return;} draw(); requestAnimationFrame(frame); };
        video.currentTime=start; await new Promise<void>((done)=>{video.onseeked=()=>done();});
        recorder.start(250); await video.play(); requestAnimationFrame(frame);
      });
      const blob=new Blob(chunks,{type:mime}); if(blob.size<500)throw new Error("Export produced an empty file. Try playing the clip first.");
      const outName=`${(project.name||"video").replace(/[^\w -]/g,"").trim()||"video"}-export.webm`;
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=outName;a.click();URL.revokeObjectURL(a.href);
      const saved=await api<{asset:Asset}>(`/api/projects/${project.id}/assets`,{method:"POST",headers:{"content-type":"video/webm","x-file-name":encodeURIComponent(outName),"x-file-size":String(blob.size)},body:blob});
      setAssets((items)=>[saved.asset,...items]);setMessage("Export downloaded and saved to your project.");
    } catch(e){setError(e instanceof Error?e.message:"Export could not finish.");}
    finally{ if(videoRef.current)videoRef.current.onseeked=null; setExporting(false); }
  };

  if (!project) return <main className="loading-shell"><div className="brand"><span className="brand-mark"><Clapperboard size={19}/></span><b>X D I G I T E X</b><span className="brand-divider"/>VIDEO STUDIO</div><div className="loading-card">{error ? <><strong>Studio needs attention</strong><p>{error}</p><button className="button primary" onClick={()=>window.location.reload()}>Try again</button></> : <><LoaderCircle className="spin"/> Loading your projects…</>}</div></main>;

  return <main className="studio-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Clapperboard size={18}/></span><b>X D I G I T E X</b><span className="brand-divider"/>VIDEO STUDIO <span className="build-chip">STUDIO</span></div>
      <div className="project-name"><span>PROJECT</span><input aria-label="Project name" value={project.name} onChange={(e)=>update({name:e.target.value})}/><ChevronDown size={14}/></div>
      <div className="top-actions"><span className="saved"><span/> All changes saved</span><button className="button ghost" onClick={createProject}><Plus size={15}/> New project</button><button className="button primary top-export" onClick={()=>{setTab("Export");void exportVideo();}} disabled={!selectedAsset||exporting}><Download size={15}/> Export</button></div>
    </header>

    <div className="app-grid">
      <aside className="left-rail">
        <div className="rail-section-label">WORKSPACE</div>
        {[{label:"Edit",icon:Scissors},{label:"Generate",icon:Sparkles},{label:"Captions",icon:Subtitles},{label:"Export",icon:Download}].map(({label,icon:Icon})=><button key={label} className={`nav-item ${tab===label?"active":""}`} onClick={()=>setTab(label)}><Icon size={17}/>{label}{label==="Captions"&&project.captions.length>0&&<span className="nav-count">{project.captions.length}</span>}</button>)}
        <div className="rail-divider"/><div className="rail-section-label library-head"><span>PROJECTS</span><button aria-label="New project" onClick={createProject}><Plus size={15}/></button></div>
        <div className="project-list">{projects.map((item)=><button key={item.id} className={`project-row ${item.id===project.id?"current":""}`} onClick={()=>loadProject(item.id)}><Film size={14}/><span>{item.name}</span></button>)}</div>
        <div className="rail-bottom"><div className="storage-icon"><FolderOpen size={17}/></div><div><b>Private workspace</b><span>Saved to your account</span></div></div>
      </aside>

      <section className="main-stage">
        <div className="stage-heading"><div><div className="eyebrow">{tab.toUpperCase()} WORKSPACE</div><h1>{tab==="Generate"?"Create with AI":tab==="Captions"?"Captions & subtitles":tab==="Export"?"Review & export":"Edit your video"}</h1></div><div className="stage-heading-right"><span className="autosave"><Check size={13}/> Saved</span><button className="button secondary" onClick={()=>uploadRef.current?.click()} disabled={!!busy}><Upload size={15}/>{busy==="upload"?"Uploading…":"Import video"}</button><input ref={uploadRef} type="file" accept="video/*" hidden onChange={(e)=>void upload(e.target.files?.[0])}/></div></div>

        {error&&<div className="notice error"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError("")}><X size={15}/></button></div>}
        {message&&<div className="notice success"><Check size={15}/><span>{message}</span><button aria-label="Dismiss message" onClick={()=>setMessage("")}><X size={15}/></button></div>}

        <div className={`preview-wrap aspect-${project.aspect.replace(":","-")}`}>
          <div className="preview-toolbar"><span><MonitorPlay size={14}/> PREVIEW</span>{selectedAsset&&<span className="preview-file">{selectedAsset.fileName}</span>}<button className="preview-fit"><Settings2 size={13}/> Fit</button></div>
          <div className="preview-screen">
            {selectedAsset?<>
              <video ref={videoRef} src={selectedAsset.url} playsInline preload="metadata" onLoadedMetadata={(e)=>{if(Number.isFinite(e.currentTarget.duration))setVideoDuration(e.currentTarget.duration);}} onTimeUpdate={(e)=>setPlayhead(e.currentTarget.currentTime)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onClick={(e)=>e.currentTarget.paused?void e.currentTarget.play():e.currentTarget.pause()}/>
              {project.overlayTitle&&<div className="video-title-overlay">{project.overlayTitle}</div>}
              {!!project.captionEnabled&&project.captions.filter((c)=>playhead>=c.start&&playhead<=c.end).map((c,i)=><div key={i} className="video-caption-overlay">{c.text}</div>)}
              <button className="play-overlay" aria-label={playing?"Pause video":"Play video"} onClick={()=>{const v=videoRef.current;if(v?.paused)void v.play();else v?.pause();}}>{playing?<span className="pause-icon">Ⅱ</span>:<span className="play-icon">▶</span>}</button>
            </>:<div className="empty-preview"><div className="empty-film"><Film size={29}/></div><strong>Your edit starts here</strong><span>Import a video or create a new clip with AI</span><div className="empty-actions"><button className="button primary" onClick={()=>uploadRef.current?.click()}><Upload size={15}/> Import video</button><button className="button secondary" onClick={()=>setTab("Generate")}><Sparkles size={15}/> Generate a clip</button></div></div>}
          </div>
          <div className="preview-controls"><button className="round-control" aria-label="Previous frame" onClick={()=>{if(videoRef.current)videoRef.current.currentTime=Math.max(0,playhead-.04);}}>|◀</button><button className="play-control" onClick={()=>{const v=videoRef.current;if(v?.paused)void v.play();else v?.pause();}}>{playing?"Ⅱ":"▶"}</button><button className="round-control" aria-label="Next frame" onClick={()=>{if(videoRef.current)videoRef.current.currentTime=Math.min(duration,playhead+.04);}}>▶|</button><span className="time-readout">{timecode(playhead)} <i>/</i> {timecode(duration)}</span><span className="controls-spacer"/><span className="resolution">{project.aspect} · 30 FPS</span></div>
          <input aria-label="Video playhead" className="scrub" type="range" min="0" max={duration||5} step="0.02" value={Math.min(playhead,duration||5)} onChange={(e)=>{const n=Number(e.target.value);setPlayhead(n);if(videoRef.current)videoRef.current.currentTime=n;}}/>
        </div>

        <div className="timeline-card"><div className="timeline-header"><div className="timeline-label"><Activity size={14}/> TIMELINE <span>{selectedAsset?"1 clip":"Empty"}</span></div><div className="timeline-actions"><button onClick={addCaption}><Plus size={13}/> Caption</button><button onClick={()=>setTab("Captions")}><Subtitles size={14}/> Manage captions</button></div></div>
          <div className="track-row"><div className="track-icon video-track"><Film size={15}/></div><div className="track-content"><div className="ruler">{Array.from({length:6},(_,i)=><span key={i}>{timecode(duration*i/5)}</span>)}</div><div className="clip-lane">{selectedAsset?<button className="clip-block" style={{left:`${Math.min(40,(project.trimStart/(duration||1))*100)}%`,right:`${Math.max(0,100-(project.trimEnd>project.trimStart?project.trimEnd:duration)/(duration||1)*100)}%`}} onClick={()=>videoRef.current?.play()}><Film size={14}/><span>{selectedAsset.fileName}</span><i/></button>:<span className="track-empty">Import or generate a video to add a clip</span>}<div className="playhead" style={{left:`${Math.min(100,playhead/(duration||1)*100)}%`}}/></div></div></div>
          <div className="track-row caption-track"><div className="track-icon caption-icon"><Subtitles size={15}/></div><div className="track-content"><div className="caption-lane">{project.captions.length?project.captions.map((c,i)=><button key={i} className="caption-chip" title={c.text} style={{left:`${Math.min(96,c.start/(duration||1)*100)}%`,width:`${Math.max(3,Math.min(45,(c.end-c.start)/(duration||1)*100))}%`}} onClick={()=>{setTab("Captions");setPlayhead(c.start);if(videoRef.current)videoRef.current.currentTime=c.start;}}>{c.text}</button>):<button className="track-empty clickable" onClick={()=>setTab("Captions")}>Add subtitles to your video</button>}</div></div></div>
          <div className="trim-controls"><Scissors size={14}/><span>TRIM</span><label>In <input type="number" min="0" max={duration} step="0.1" value={project.trimStart} onChange={(e)=>update({trimStart:Number(e.target.value)})}/><small>s</small></label><span className="trim-divider"/><label>Out <input type="number" min="0" max={duration} step="0.1" value={project.trimEnd||duration} onChange={(e)=>update({trimEnd:Number(e.target.value)})}/><small>s</small></label><span className="trim-note">Trim is applied to export</span></div>
        </div>

        <div className="bottom-tabs"><button className={tab==="Edit"?"selected":""} onClick={()=>setTab("Edit")}><Scissors size={14}/> Edit</button><button className={tab==="Generate"?"selected":""} onClick={()=>setTab("Generate")}><WandSparkles size={14}/> AI Generator</button><button className={tab==="Captions"?"selected":""} onClick={()=>setTab("Captions")}><Subtitles size={14}/> Captions</button><button className={tab==="Export"?"selected":""} onClick={()=>setTab("Export")}><Download size={14}/> Export</button></div>
      </section>

      <aside className="inspector">
        {tab==="Generate"?<>
          <div className="panel-title"><div className="panel-title-icon"><Sparkles size={16}/></div><div><strong>AI video studio</strong><span>Generate a scene or restyle your source</span></div></div>
          <div className="panel-body"><label className="field-label" htmlFor="prompt">YOUR CREATIVE BRIEF</label><textarea id="prompt" className="brief-input" maxLength={1000} value={project.prompt} onChange={(e)=>update({prompt:e.target.value})} placeholder="A cinematic close-up of a coffee cup on a rain-speckled windowsill. Warm light, slow camera push-in, subtle steam, premium editorial feel."/><div className="field-hint">Describe subject, scene, lighting, camera and mood.</div>
            <div className="ai-mode-switch" role="group" aria-label="AI video action"><button className={aiMode==="generate"?"chosen":""} onClick={()=>{setAiMode("generate");setApprovedCost(false);}}><Sparkles size={13}/> Generate new</button><button className={aiMode==="edit"?"chosen":""} disabled={!selectedAsset} onClick={()=>{setAiMode("edit");setApprovedCost(false);}}><WandSparkles size={13}/> Edit source</button></div>
            <div className="field-label settings-label">CLIP SETTINGS</div><label className="select-row"><span>Aspect ratio</span><select value={project.aspect} onChange={(e)=>update({aspect:e.target.value})}><option value="16:9">Landscape · 16:9</option><option value="9:16">Portrait · 9:16</option><option value="1:1">Square · 1:1</option></select></label>{aiMode==="generate"?<label className="select-row"><span>Duration</span><select value={project.duration} onChange={(e)=>{update({duration:Number(e.target.value)});setApprovedCost(false);}}><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></label>:<div className="select-row"><span>Source length</span><span className="source-length">{videoDuration?`${videoDuration.toFixed(1)} sec`:"Select video"}</span></div>}
            <div className="cost-card"><div className="cost-top"><span>Estimated provider charge</span><b>{money(estimate)}</b></div><p>{aiMode==="edit"?"Aleph 2 source video edit · Runway":"Gen-4.5 video generation · Runway"}</p><label className="cost-check"><input type="checkbox" checked={approvedCost} onChange={(e)=>setApprovedCost(e.target.checked)}/><span>I approve this estimated charge for this one render</span></label><small>Provider pricing can change; the final charge may differ slightly.</small></div>
            <button className="button primary generate-button" onClick={()=>void generate()} disabled={!!busy||!approvedCost||!project.prompt.trim()||(aiMode==="edit"&&!selectedAsset)}>{busy==="generate"?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>} {busy==="generate"?"Starting…":aiMode==="edit"?"Apply AI edit":"Generate video"}</button>
            <p className="provider-footnote">Your prompt and source are sent securely to Runway. Your API key stays on the server.</p>
            {generation&&<div className={`job-card ${generation.status.toLowerCase()}`}><span className="job-dot"/><div><strong>{generation.status==="SUCCEEDED"?"Generation complete":generation.status==="FAILED"?"Generation failed":"Rendering your clip"}</strong><small>{generation.status==="SUCCEEDED"?"New clip saved in this project":generation.status==="FAILED"?generation.error:"This can take a few minutes. You can continue editing."}</small></div>{! ["SUCCEEDED","FAILED"].includes(generation.status)&&<LoaderCircle className="spin" size={15}/>}</div>}
          </div>
        </>:tab==="Captions"?<>
          <div className="panel-title"><div className="panel-title-icon"><Subtitles size={16}/></div><div><strong>Captions & subtitles</strong><span>Readable, editable, exportable</span></div></div><div className="panel-body">
            <div className="caption-tools"><p>Audio from the selected trim range is sent to OpenAI for transcription. Current Whisper pricing is about $0.006 per minute.</p><label className="cost-check caption-cost-check"><input type="checkbox" checked={captionCostApproved} onChange={(e)=>setCaptionCostApproved(e.target.checked)}/><span>I approve this one transcription request</span></label><button className="button primary wide" onClick={()=>void autoCaptions()} disabled={!!busy||!selectedAsset||!captionCostApproved}>{busy==="captions"?<LoaderCircle className="spin" size={15}/>:<AudioLines size={15}/>} {busy==="captions"?"Listening to video…":"Generate captions with AI"}</button><p>Timed lines are saved to the project. You can edit them, import SRT, or add lines manually.</p><label className="button secondary wide import-srt"><Upload size={14}/> Import SRT file<input type="file" accept=".srt,text/plain" onChange={(e)=>void importSrt(e.target.files?.[0])}/></label><button className="button secondary wide" onClick={addCaption}><Plus size={14}/> Add caption at playhead</button><button className="button text-button" onClick={downloadSrt} disabled={!project.captions.length}><Download size={14}/> Download .SRT</button></div>
            <div className="caption-list-heading"><span>CAPTION LINES</span><button onClick={()=>update({captionEnabled:project.captionEnabled?0:1})}>{project.captionEnabled?"Preview on":"Preview off"}</button></div>
            <div className="caption-list">{project.captions.length?project.captions.map((c,i)=><div className="caption-edit" key={i}><button className="caption-time" onClick={()=>{setPlayhead(c.start);if(videoRef.current)videoRef.current.currentTime=c.start;}}>{timecode(c.start)}</button><textarea aria-label={`Caption ${i+1}`} value={c.text} onChange={(e)=>update({captions:project.captions.map((item,n)=>n===i?{...item,text:e.target.value}:item)})}/><button aria-label={`Delete caption ${i+1}`} className="delete-caption" onClick={()=>update({captions:project.captions.filter((_,n)=>n!==i)})}><X size={14}/></button></div>):<div className="caption-empty"><Subtitles size={21}/><span>Your subtitle lines will appear here</span></div>}</div>
          </div>
        </>:tab==="Export"?<>
          <div className="panel-title"><div className="panel-title-icon"><Download size={16}/></div><div><strong>Export video</strong><span>Render and save your finished edit</span></div></div><div className="panel-body">
            <label className="field-label">TITLE OVERLAY</label><input className="title-input" placeholder="Add a title on screen" value={project.overlayTitle} onChange={(e)=>update({overlayTitle:e.target.value})}/><div className="field-hint">Shown near the top of the video.</div>
            <div className="field-label settings-label">OUTPUT</div><div className="output-spec"><div><span>Aspect ratio</span><b>{project.aspect}</b></div><div><span>Format</span><b>WebM · VP9 / Opus</b></div><div><span>Trimmed length</span><b>{timecode(Math.max(0,(project.trimEnd||duration)-project.trimStart))}</b></div><div><span>Captions</span><b>{project.captionEnabled&&project.captions.length?"Burned in":"Not included"}</b></div></div>
            <button className="button primary generate-button" disabled={!selectedAsset||exporting} onClick={()=>void exportVideo()}>{exporting?<LoaderCircle className="spin" size={16}/>:<Download size={16}/>} {exporting?"Rendering in real time…":"Render & download"}</button><div className="export-note">Export plays through the selected range, burns in your title and captions, downloads the finished file, and saves a copy in this project. Keep this tab open until it finishes.</div>
          </div>
        </>:<>
          <div className="panel-title"><div className="panel-title-icon"><Settings2 size={16}/></div><div><strong>Clip settings</strong><span>Shape your current edit</span></div></div><div className="panel-body">
            <div className="field-label">CANVAS</div><div className="ratio-grid">{[["16:9","Landscape"],["9:16","Portrait"],["1:1","Square"]].map(([v,l])=><button key={v} className={project.aspect===v?"ratio-option chosen":"ratio-option"} onClick={()=>update({aspect:v})}><span className={`ratio-icon ratio-${v.replace(":","-")}`}/><b>{l}</b><small>{v}</small></button>)}</div>
            <div className="field-label settings-label">ON-SCREEN TITLE</div><input className="title-input" placeholder="e.g. A taste of summer" value={project.overlayTitle} onChange={(e)=>update({overlayTitle:e.target.value})}/><div className="field-hint">A title appears in the preview and final export.</div>
            <div className="field-label settings-label">MEDIA IN PROJECT</div>{assets.length?<div className="media-list">{assets.map((asset)=><button key={asset.id} className={`media-row ${selectedAsset?.id===asset.id?"media-active":""}`} onClick={()=>{setSelectedAssetId(asset.id);update({selectedAssetId:asset.id});setVideoDuration(0);setPlayhead(0);}}><Film size={15}/><span>{asset.fileName}</span><small>{asset.kind==="generated"?"AI":"VIDEO"}</small></button>)}</div>:<div className="no-media"><Upload size={16}/><span>Upload a video or generate a clip</span></div>}
            <button className="button secondary wide upload-secondary" onClick={()=>uploadRef.current?.click()} disabled={!!busy}><Upload size={14}/> Add video to project</button>
          </div>
        </>}
      </aside>
    </div>
    <canvas ref={canvasRef} className="render-canvas" aria-hidden="true"/>
  </main>;
}
