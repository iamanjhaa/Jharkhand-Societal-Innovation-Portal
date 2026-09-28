"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Mic, Minus, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { createEmergencyHelper, createEmergencyRequest, deleteEmergencyHelper, getActiveEmergency, getEmergencySettings, getSmsConfigurationDiagnostics, resolveEmergencyRequest, setEmergencyVoiceMode, transcribeEmergencyAudio, updateEmergencyHelper, type EmergencyHelper, type EmergencyRequest, type SmsConfigurationDiagnostics } from "@/lib/api";
import { parseEmergencyCommand } from "@/shared/emergency-intent.mjs";

type VoiceStatus = "Ready" | "Requesting microphone" | "Listening" | "Understanding" | "Emergency detected" | "Sending alert" | "Alert sent" | "Failed";

const STATUS_OPTIONS: VoiceStatus[] = ["Ready", "Requesting microphone", "Listening", "Understanding", "Emergency detected", "Sending alert", "Alert sent", "Failed"];
const MAX_RECORDING_MS = 12_000;

function normalizeVoiceCommand(command: string) {
  return String(command || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-IN")
    .replace(/\b(sahayak|hey sahayak|sahayak,?)\b/gi, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[_\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyVoiceCommand(command: string) {
  const parsed = parseEmergencyCommand(command);
  return parsed
    ? { intent: parsed.emergencyType, trigger: true, message: `${parsed.emergencyType.replace(/_/g, " ")} emergency detected.` }
    : { intent: "NORMAL", trigger: false, message: "" };
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return phone;
  const visible = digits.slice(-4);
  return `••••${visible}`;
}

export default function EmergencyVoiceMode() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [helpers, setHelpers] = useState<EmergencyHelper[]>([]);
  const [activeEmergency, setActiveEmergency] = useState<EmergencyRequest | null>(null);
  const [smsConfiguration, setSmsConfiguration] = useState<SmsConfigurationDiagnostics | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [editingHelperId, setEditingHelperId] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRelationship, setEditRelationship] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [helperOpen, setHelperOpen] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("Ready");
  const [transcript, setTranscript] = useState("");
  const [statusText, setStatusText] = useState("Waiting for a command.");
  const [emergencyId, setEmergencyId] = useState("");
  const [smsStatus, setSmsStatus] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingRequestIdRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const disposedRef = useRef(false);
  const microphoneRequestRef = useRef(false);

  async function refreshActiveEmergency() {
    const response = await getActiveEmergency();
    if (response.success) setActiveEmergency(response.data || null);
  }

  useEffect(() => {
    void refreshActiveEmergency();
    const refresh = () => void refreshActiveEmergency();
    window.addEventListener("sahayak:emergency-session-updated", refresh);
    return () => window.removeEventListener("sahayak:emergency-session-updated", refresh);
  }, []);

  useEffect(() => {
    if (!open) return;
    void Promise.all([getEmergencySettings(), getSmsConfigurationDiagnostics()]).then(([settings, configuration]) => {
      if (!settings.success || !settings.data) {
        setError(settings.message || "Unable to load emergency contacts");
      } else {
        setEnabled(settings.data.enabled);
        setHelpers(settings.data.helpers);
      }
      if (configuration.success && configuration.data) setSmsConfiguration(configuration.data);
    });
  }, [open]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      discardRecordingRef.current = true;
      cleanupRecording();
    };
  }, []);

  async function toggleMode() {
    setBusy(true);
    setError("");
    if (enabled) stopRecording(true);
    const response = await setEmergencyVoiceMode(!enabled);
    if (!response.success) {
      setError(response.message || "Unable to update Emergency Voice Mode");
    } else {
      setEnabled(!enabled);
      setStatusText(!enabled ? "Emergency Voice Mode enabled." : "Emergency Voice Mode disabled.");
      setVoiceStatus(!enabled ? "Ready" : "Failed");
    }
    setBusy(false);
  }

  async function addHelper(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await createEmergencyHelper({ name, phone, relationship });
    if (!response.success || !response.data) {
      setError(response.message || "Unable to add helper");
    } else {
      setHelpers((current) => [...current, response.data!].sort((a, b) => a.priority - b.priority));
      setName("");
      setPhone("");
      setRelationship("");
    }
    setBusy(false);
  }

  async function removeHelper(id: string) {
    setBusy(true);
    const response = await deleteEmergencyHelper(id);
    if (!response.success) {
      setError(response.message || "Unable to remove helper");
    } else {
      setHelpers((current) => current.filter((helper) => helper._id !== id));
    }
    setBusy(false);
  }

  async function saveHelper(helperId: string) {
    setBusy(true);
    setError("");
    const response = await updateEmergencyHelper(helperId, { name: editName, phone: editPhone, relationship: editRelationship });
    if (!response.success || !response.data) {
      setError(response.message || "Unable to update contact");
    } else {
      setHelpers((current) => current.map((helper) => helper._id === helperId ? response.data! : helper));
      setEditingHelperId("");
    }
    setBusy(false);
  }

  async function toggleHelper(helper: EmergencyHelper) {
    setBusy(true);
    setError("");
    const response = await updateEmergencyHelper(helper._id, { enabled: !helper.enabled });
    if (!response.success || !response.data) {
      setError(response.message || "Unable to update contact");
    } else {
      setHelpers((current) => current.map((item) => item._id === helper._id ? response.data! : item));
    }
    setBusy(false);
  }

  async function getLocationForAlert() {
    if (!("geolocation" in navigator)) return null;
    return new Promise<{ latitude: number; longitude: number; accuracy: number; locationLink: string } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
          const locationLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
          resolve({ latitude, longitude, accuracy: position.coords.accuracy || 0, locationLink });
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 2500, maximumAge: 30000 },
      );
    });
  }

  async function sendEmergencyRequest(command: string, intent: string) {
    const location = await getLocationForAlert();
    setVoiceStatus("Sending alert");
    setStatusText("Contacting your registered emergency contacts...");
    const response = await createEmergencyRequest({
      command,
      intent,
      source: "WEB",
      ...(location ? {
        latitude: location.latitude,
        longitude: location.longitude,
        locationAccuracy: location.accuracy,
        locationTimestamp: new Date().toISOString(),
      } : {}),
    });

    if (!response.success || !response.data?.emergency) {
      setVoiceStatus("Failed");
      setStatusText(response.message || "Emergency alert could not be activated.");
      setError(response.message || "Emergency alert could not be activated.");
      return;
    }

    const emergencyResult = response.data;
    setActiveEmergency(emergencyResult.emergency);
    const results = emergencyResult.smsResults || [];
    const sent = results.filter((result) => result.status === "sent").length;
    const failed = results.filter((result) => result.status === "failed").length;
    setEmergencyId(emergencyResult.emergencyId || "");
    setSmsStatus(emergencyResult.emergency.smsStatus === "SMS_NOT_CONFIGURED"
      ? "SMS_NOT_CONFIGURED"
      : failed ? "PARTIAL_OR_FAILED" : results.length ? "SMS_REQUEST_ACCEPTED" : "NO_ENABLED_HELPERS");
    setVoiceStatus(sent ? "Alert sent" : "Failed");
    setStatusText(emergencyResult.emergency.smsStatus === "SMS_NOT_CONFIGURED"
      ? "Emergency recorded, but SMS is not configured on the server."
      : results.length
      ? `Twilio accepted alert requests for ${sent} of ${results.length} emergency contacts${failed ? `; ${failed} failed` : ""}.`
      : "Emergency recorded, but no active emergency contact is configured.");
    setTranscript(command);
    setError(location ? "" : "Emergency recorded, but live location could not be obtained.");
    window.dispatchEvent(new Event("sahayak:emergency-session-updated"));
  }

  async function handleVoiceCommand(command: string) {
    const normalized = normalizeVoiceCommand(command);
    const parsed = classifyVoiceCommand(normalized);

    if (!parsed.trigger) {
      setVoiceStatus("Ready");
      setStatusText("Voice command not classified as an emergency.");
      return;
    }

    console.info("[EMERGENCY] intent detected", { emergencyType: parsed.intent });
    setVoiceStatus("Understanding");
    setStatusText(parsed.message || "Understanding your emergency command.");
    await new Promise((resolve) => setTimeout(resolve, 250));
    setVoiceStatus("Emergency detected");
    setStatusText(parsed.message || "Emergency detected.");
    try {
      setVoiceStatus("Sending alert");
      setStatusText("Sending alert to emergency contacts.");
      await sendEmergencyRequest(command, parsed.intent);
    } catch {
      setVoiceStatus("Failed");
      setStatusText("Emergency alert failed to send.");
    }
  }

  async function markSafe() {
    if (!activeEmergency || !window.confirm("Mark this emergency as resolved?")) return;
    setBusy(true);
    setError("");
    const response = await resolveEmergencyRequest(activeEmergency.id);
    if (!response.success) {
      setError(response.message || "Unable to resolve the emergency session");
    } else {
      setActiveEmergency(null);
      setStatusText("Emergency session resolved.");
      window.dispatchEvent(new Event("sahayak:emergency-session-updated"));
    }
    setBusy(false);
  }

  function releaseMicrophoneStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function cleanupRecording() {
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    microphoneRequestRef.current = false;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseMicrophoneStream();
    mediaChunksRef.current = [];
  }

  function stopRecording(discard = false) {
    if (discard) discardRecordingRef.current = true;
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      if (!discard) {
        setVoiceStatus("Understanding");
        setStatusText("Processing your voice command...");
      }
      recorder.stop();
      return;
    }
    if (microphoneRequestRef.current) recordingRequestIdRef.current += 1;
    microphoneRequestRef.current = false;
    releaseMicrophoneStream();
    mediaRecorderRef.current = null;
    mediaChunksRef.current = [];
  }

  async function transcribeRecording(recorder: MediaRecorder) {
    const stream = mediaStreamRef.current;
    mediaStreamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
    microphoneRequestRef.current = false;
    if (discardRecordingRef.current || disposedRef.current) {
      discardRecordingRef.current = false;
      mediaChunksRef.current = [];
      return;
    }

    const chunks = mediaChunksRef.current;
    mediaChunksRef.current = [];
    const mimeType = recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || "audio/webm";
    const audio = new Blob(chunks, { type: mimeType });
    if (!audio.size) {
      setVoiceStatus("Ready");
      setStatusText("No recording was captured. Check microphone access and try again.");
      setError("No recording was captured. Check microphone access and try again.");
      return;
    }

    setVoiceStatus("Understanding");
    setStatusText("Transcribing your voice command...");
    try {
      const response = await transcribeEmergencyAudio(audio);
      if (!response.success || !response.data) {
        throw new Error(response.message || "Speech transcription failed.");
      }
      const command = response.data.transcript.trim();
      if (!command) {
        setVoiceStatus("Ready");
        setStatusText("No speech was recognized. Please try again.");
        setError("No speech was recognized. Please try again.");
        return;
      }
      setTranscript(command);
      await handleVoiceCommand(command);
    } catch (transcriptionError) {
      const message = transcriptionError instanceof Error ? transcriptionError.message : "Speech transcription failed.";
      setVoiceStatus("Failed");
      setStatusText(message);
      setError(message);
    }
  }

  async function startListening() {
    if (voiceStatus === "Listening") {
      stopRecording();
      return;
    }
    if (!enabled || microphoneRequestRef.current || mediaRecorderRef.current) return;
    if (!window.isSecureContext) {
      const message = "Microphone access requires HTTPS or localhost. Open the portal over a secure connection.";
      setError(message);
      setStatusText(message);
      setVoiceStatus("Failed");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      const message = "Voice recording is not supported in this browser. Use the Sahayak text input or try a current version of Chrome or Edge.";
      setError(message);
      setStatusText(message);
      setVoiceStatus("Failed");
      return;
    }

    const requestId = ++recordingRequestIdRef.current;
    microphoneRequestRef.current = true;
    discardRecordingRef.current = false;
    setError("");
    setVoiceStatus("Requesting microphone");
    setStatusText("Requesting microphone access...");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (permissionError) {
      if (requestId !== recordingRequestIdRef.current || disposedRef.current) return;
      microphoneRequestRef.current = false;
      const name = permissionError instanceof DOMException ? permissionError.name : "";
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone permission was denied. Allow microphone access for this site, then try again."
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? "No microphone was found. Connect or enable a microphone, then try again."
          : `Could not access the microphone${name ? ` (${name})` : ""}. Check browser permissions and try again.`;
      setVoiceStatus("Failed");
      setStatusText(message);
      setError(message);
      return;
    }

    if (requestId !== recordingRequestIdRef.current || disposedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      microphoneRequestRef.current = false;
      return;
    }

    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) mediaChunksRef.current.push(event.data);
      };
      recorder.onerror = (event) => {
        const message = "Microphone recording failed. Check microphone access and try again.";
        setVoiceStatus("Failed");
        setStatusText(message);
        setError(message);
        console.error("[VOICE] media recording failed", { error: event.error?.name || "UnknownError" });
        stopRecording(true);
      };
      recorder.onstop = () => void transcribeRecording(recorder);
      recorder.start(250);
      microphoneRequestRef.current = false;
      setVoiceStatus("Listening");
      setStatusText("Listening. Speak now, then tap the microphone to transcribe. Recording stops automatically after 12 seconds.");
      recordingTimeoutRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch (recordingError) {
      stream.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      microphoneRequestRef.current = false;
      const message = recordingError instanceof Error ? recordingError.message : "Microphone recording could not start.";
      setVoiceStatus("Failed");
      setStatusText(message);
      setError(message);
    }
  }

  useEffect(() => {
    if (!open) {
      stopRecording(true);
      setVoiceStatus("Ready");
      setStatusText("Waiting for a command.");
    }
  }, [open]);

  return (
    <>
      {activeEmergency ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-red-950/80 p-4" role="alertdialog" aria-modal="true" aria-labelledby="active-emergency-title">
          <section className="w-full max-w-lg space-y-4 rounded-2xl border-2 border-red-700 bg-white p-5 shadow-2xl">
            <div className="rounded-xl bg-red-700 p-4 text-white">
              <p className="text-xs font-bold uppercase tracking-[0.18em]">Sahayak Emergency Mode</p>
              <h2 id="active-emergency-title" className="mt-1 text-2xl font-extrabold">🚨 EMERGENCY ACTIVE</h2>
              <p className="mt-2 text-sm">If you can, move to a safe place and contact local emergency services.</p>
            </div>
            <div className="space-y-2 text-sm text-slate-800">
              <p className="font-semibold">{activeEmergency.contactsAlerted
                ? `${activeEmergency.contactsAlerted} emergency contact alert request(s) were accepted by Twilio.`
                : "No contact alert request has been accepted. Check your saved emergency contacts and call local emergency services if needed."}</p>
              <ul className="space-y-1">
                {activeEmergency.smsResults.map((result, index) => (
                  <li key={`${result.contactName}-${index}`} className="flex items-center gap-2">
                    {result.status === "sent" ? <Check className="size-4 text-emerald-700" /> : <AlertTriangle className="size-4 text-amber-700" />}
                    <span>{result.contactName}: {result.status === "sent" ? "SMS request accepted" : result.status === "pending" ? "pending" : "SMS failed"}</span>
                  </li>
                ))}
              </ul>
              {activeEmergency.latitude !== null && activeEmergency.longitude !== null ? (
                <a className="inline-flex items-center gap-1 font-bold text-blue-800 underline" href={`https://www.google.com/maps?q=${activeEmergency.latitude},${activeEmergency.longitude}`} target="_blank" rel="noreferrer">
                  📍 Location shared — view map
                </a>
              ) : <p>📍 Location could not be retrieved.</p>}
              <p>Started: {new Date(activeEmergency.triggeredAt).toLocaleString()}</p>
              <p>Active until: {new Date(activeEmergency.expiresAt).toLocaleString()}</p>
            </div>
            {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
            <button type="button" onClick={() => void markSafe()} disabled={busy} className="w-full rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white hover:bg-emerald-900 disabled:opacity-50">
              I’m Safe — resolve emergency
            </button>
          </section>
        </div>
      ) : null}
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-left text-xs font-bold text-red-900 transition hover:bg-red-100">
        🆘 Emergency Voice Mode
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-voice-title">
          <div className={`relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${minimized ? "max-h-20" : "max-sm:max-h-[92vh] max-sm:overflow-y-auto"}`}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-700">Emergency</p>
                <h2 id="emergency-voice-title" className="mt-1 text-lg font-extrabold text-slate-900">Sahayak Emergency Assistant</h2>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => setMinimized((current) => !current)} aria-label="Minimize emergency assistant" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"><Minus className="size-4" /></button>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close emergency assistant" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"><X className="size-4" /></button>
              </div>
            </div>

            {!minimized ? <div className="space-y-4 p-4">
              <div className={`rounded-xl border p-3 ${enabled ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {enabled ? <ShieldCheck className="size-5 text-emerald-700" /> : <AlertTriangle className="size-5 text-slate-500" />}
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800">{enabled ? "Voice mode active" : "Voice mode disabled"}</div>
                      <div className="text-[11px] text-slate-600">{statusText}</div>
                    </div>
                  </div>
                  <button type="button" onClick={() => void toggleMode()} disabled={busy} className={`rounded-full px-3 py-1.5 text-[11px] font-bold text-white ${enabled ? "bg-slate-700" : "bg-red-700"} disabled:opacity-50`}>
                    {enabled ? "Disable" : "Enable"}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((status) => (
                    <span key={status} className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${voiceStatus === status ? "border-red-300 bg-red-700 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
                      {status}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => void startListening()}
                    disabled={!enabled || busy || voiceStatus === "Requesting microphone" || voiceStatus === "Understanding" || voiceStatus === "Emergency detected" || voiceStatus === "Sending alert"}
                    aria-label={voiceStatus === "Listening" ? "Stop voice recording and transcribe" : "Start voice emergency capture"}
                    className={`grid size-20 place-items-center rounded-full border-4 shadow-lg transition ${enabled ? "border-red-200 bg-red-600 text-white hover:bg-red-700" : "border-slate-200 bg-slate-200 text-slate-400"}`}
                  >
                    {voiceStatus === "Listening" ? <span className="text-xs font-bold">Stop</span> : <Mic className="size-9" />}
                  </button>
                </div>

                {transcript ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Last command</p>
                    <p className="mt-1 text-sm text-slate-800 break-words">{transcript}</p>
                  </div>
                ) : null}
                {emergencyId ? <p className="mt-2 text-center text-xs font-bold text-slate-700">Emergency ID: {emergencyId}</p> : null}
                {smsStatus === "SMS_NOT_CONFIGURED" ? <p className="mt-2 text-center text-xs text-amber-700">Emergency recorded. SMS service is not configured.</p> : null}
              </div>
              {smsConfiguration && !Object.values(smsConfiguration).every(Boolean) ? (
                <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  SMS configuration is incomplete. SOS sessions can still be recorded, but contacts will not receive SMS until the backend Twilio settings are corrected.
                </p>
              ) : null}

              <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <button type="button" onClick={() => setHelperOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Emergency Contacts</h3>
                    <p className="text-[11px] text-slate-500">Private to your account.</p>
                  </div>
                  <ChevronDown className={`size-4 text-slate-600 transition ${helperOpen ? "rotate-180" : ""}`} />
                </button>

                {helperOpen ? (
                  <div className="mt-3 space-y-2">
                    {helpers.length ? (
                      <div className="space-y-2">
                        {helpers.map((helper) => (
                          <div key={helper._id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
                            {editingHelperId === helper._id ? (
                              <form className="grid w-full gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void saveHelper(helper._id); }}>
                                <input value={editName} onChange={(event) => setEditName(event.target.value)} required maxLength={80} aria-label="Contact name" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                <input value={editPhone} onChange={(event) => setEditPhone(event.target.value)} required aria-label="Contact phone number" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                <input value={editRelationship} onChange={(event) => setEditRelationship(event.target.value)} maxLength={40} placeholder="Relationship (optional)" aria-label="Relationship" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                <div className="flex items-center justify-end gap-1">
                                  <button type="submit" disabled={busy} className="rounded-md p-1.5 text-emerald-800 hover:bg-emerald-50" aria-label="Save contact"><Check className="size-4" /></button>
                                  <button type="button" onClick={() => setEditingHelperId("")} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Cancel editing"><X className="size-4" /></button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-slate-800">{helper.name}{helper.relationship ? ` · ${helper.relationship}` : ""}</p>
                                  <p className="truncate text-xs text-slate-600">{maskPhone(helper.phone)} · {helper.enabled ? "Active" : "Disabled"}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button type="button" onClick={() => void toggleHelper(helper)} disabled={busy} className="rounded-md px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100">{helper.enabled ? "Disable" : "Enable"}</button>
                                  <button type="button" onClick={() => { setEditingHelperId(helper._id); setEditName(helper.name); setEditPhone(helper.phone); setEditRelationship(helper.relationship || ""); }} className="rounded-md p-1.5 text-blue-800 transition hover:bg-blue-50" aria-label={`Edit ${helper.name}`}>
                                    <Pencil className="size-4" />
                                  </button>
                                  <button type="button" onClick={() => void removeHelper(helper._id)} disabled={busy} className="rounded-md p-1.5 text-red-700 transition hover:bg-red-50" aria-label={`Delete ${helper.name}`}>
                                    <Trash2 className="size-4" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-slate-200 bg-white p-2 text-xs text-slate-500">No emergency helpers saved yet.</p>
                    )}

                    {helpers.length >= 5 ? <p className="text-xs font-semibold text-amber-800">Maximum 5 emergency contacts allowed.</p> : null}
                    <form onSubmit={addHelper} className="grid gap-2 pt-2 sm:grid-cols-[1fr_1fr_1fr_auto]" aria-label="Add emergency contact">
                      <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Name" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-red-400" />
                      <input value={phone} onChange={(event) => setPhone(event.target.value)} required placeholder="+91 ..." className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-red-400" />
                      <input value={relationship} onChange={(event) => setRelationship(event.target.value)} maxLength={40} placeholder="Relationship (optional)" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-red-400" />
                      <button type="submit" disabled={busy || helpers.length >= 5} className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                        <Plus className="size-4" />Add
                      </button>
                    </form>
                  </div>
                ) : null}
              </section>

              {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 break-words">{error}</p> : null}
            </div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
