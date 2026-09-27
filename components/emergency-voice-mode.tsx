"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Mic, Minus, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { apiCall, createEmergencyHelper, deleteEmergencyHelper, getEmergencySettings, setEmergencyVoiceMode, transcribeEmergencyAudio, type EmergencyHelper } from "@/lib/api";

type VoiceStatus = "Ready" | "Listening" | "Understanding" | "Emergency detected" | "Sending alert" | "Alert sent" | "Failed";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onnomatch: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const STATUS_OPTIONS: VoiceStatus[] = ["Ready", "Listening", "Understanding", "Emergency detected", "Sending alert", "Alert sent", "Failed"];

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
  const normalized = normalizeVoiceCommand(command);
  if (!normalized) return { intent: "NORMAL", trigger: false, message: "" };

  const accidentPatterns = [
    /\b(accident|road accident|vehicle accident|accident ho gaya|accident ho gya|accident hua|had an accident|i had an accident|car crash|truck crash|bike accident|road hit|fall|fell|injured|bleeding)\b/,
    /\b(hit|crash|collided|serious injury|ghatna|apda)\b/,
  ];
  const medicalPatterns = [
    /\b(ambulance|medical emergency|doctor help|need doctor|heart attack|chest pain|breathing problem|unconscious|fainted|seizure|severe pain|tabiyat kharab|urgent medical|blood emergency)\b/,
    /\b(doctor|medical|medicine|hospital|injury|body pain|nurse)\b/,
  ];
  const firePatterns = [/\b(fire|aag|smoke|flame|explosion|burning)\b/];
  const floodPatterns = [/\b(flood|water logging|waterlogging|bahut pani|badh|disaster|road under water)\b/];
  const helperPatterns = [
    /\b(call my helper|call my emergency helper|call helper|helper ko call karo|my helper|helper call|call helper now|call emergency helper)\b/,
    /\b(sahayak.*(call.*helper|helper.*call))\b/,
  ];
  const generalPatterns = [
    /\b(help me|help chahiye|madad chahiye|mujhe madad|bachao|please help|help please|emergency|critical|danger)\b/,
  ];

  if (accidentPatterns.some((pattern) => pattern.test(normalized))) return { intent: "ACCIDENT", trigger: true, message: "Accident emergency detected." };
  if (medicalPatterns.some((pattern) => pattern.test(normalized))) return { intent: "MEDICAL_EMERGENCY", trigger: true, message: "Medical emergency detected." };
  if (firePatterns.some((pattern) => pattern.test(normalized))) return { intent: "FIRE", trigger: true, message: "Fire emergency detected." };
  if (floodPatterns.some((pattern) => pattern.test(normalized))) return { intent: "FLOOD_DISASTER", trigger: true, message: "Flood or disaster emergency detected." };
  if (helperPatterns.some((pattern) => pattern.test(normalized))) return { intent: "CALL_EMERGENCY_HELPER", trigger: true, message: "Emergency helper requested." };
  if (generalPatterns.some((pattern) => pattern.test(normalized))) return { intent: "GENERAL_EMERGENCY", trigger: true, message: "Emergency detected." };

  return { intent: "NORMAL", trigger: false, message: "" };
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
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [helperOpen, setHelperOpen] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("Ready");
  const [transcript, setTranscript] = useState("");
  const [statusText, setStatusText] = useState("Waiting for a command.");
  const [emergencyId, setEmergencyId] = useState("");
  const [smsStatus, setSmsStatus] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const lastTranscriptRef = useRef("");

  useEffect(() => {
    if (!open) return;
    void getEmergencySettings().then((response) => {
      if (!response.success || !response.data) {
        setError(response.message || "Unable to load emergency settings");
        return;
      }
      setEnabled(response.data.enabled);
      setHelpers(response.data.helpers);
    });
  }, [open]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  async function toggleMode() {
    setBusy(true);
    setError("");
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
    const response = await createEmergencyHelper({ name, phone });
    if (!response.success || !response.data) {
      setError(response.message || "Unable to add helper");
    } else {
      setHelpers((current) => [...current, response.data!].sort((a, b) => a.priority - b.priority));
      setName("");
      setPhone("");
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

  async function getLocationForAlert() {
    if (!("geolocation" in navigator)) return null;
    return new Promise<{ latitude: number; longitude: number; accuracy: number; locationLink: string } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
          const locationLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
          console.info("[SAHAYAK_LOCATION]", { latitude, longitude, accuracy: position.coords.accuracy, locationLink });
          resolve({ latitude, longitude, accuracy: position.coords.accuracy || 0, locationLink });
        },
        () => {
          console.warn("[SAHAYAK_LOCATION] location unavailable");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      );
    });
  }

  async function sendEmergencyRequest(command: string, intent: string) {
    const location = await getLocationForAlert();
    const body: Record<string, unknown> = { command, source: "WEB" };
    if (location) {
      body.latitude = location.latitude;
      body.longitude = location.longitude;
      body.locationAccuracy = location.accuracy;
      body.locationTimestamp = new Date().toISOString();
    }

    console.info("[SAHAYAK_EMERGENCY_API]", { intent, command, hasLocation: Boolean(location), location });
    setVoiceStatus("Sending alert");
    setStatusText("Contacting your registered emergency helper...");
    const response = await apiCall<{ emergency?: { _id: string }; emergencyId?: string; alertDelivery?: string; smsStatus?: string; callTarget?: { name: string; phone: string } }>("/api/emergency/trigger", {
      method: "POST",
      body: JSON.stringify({ ...body, intent, transcript: command }),
    });

    if (!response.success) {
      setVoiceStatus("Failed");
      setStatusText(response.message || "Emergency alert failed to send.");
      setError(response.message || "Emergency alert failed to send.");
      console.error("[SAHAYAK_EMERGENCY_API] failed", { intent, message: response.message });
      return;
    }

    const delivery = response.data?.smsStatus || response.data?.alertDelivery || "";
    setEmergencyId(response.data?.emergencyId || "");
    setSmsStatus(delivery);
    setVoiceStatus(delivery === "SMS_REQUEST_ACCEPTED" ? "Alert sent" : "Failed");
    setStatusText(
      delivery === "SMS_REQUEST_ACCEPTED"
        ? `Emergency helper notified by SMS${response.data?.callTarget ? ` (${response.data.callTarget.name})` : ""}.`
        : delivery === "SMS_NOT_CONFIGURED"
          ? "Emergency recorded. SMS service is not configured."
          : delivery === "NO_ENABLED_HELPERS"
            ? "Emergency recorded, but no enabled emergency helper is configured."
            : "Emergency recorded, but the SMS provider could not notify your helper.",
    );
    setTranscript(command);
    setError(location ? "" : "Emergency recorded, but live location could not be obtained.");
    console.info("[SAHAYAK_NOTIFICATION]", { intent, alertDelivery: response.data?.alertDelivery || "unknown", callTarget: response.data?.callTarget || null });
  }

  async function handleVoiceCommand(command: string) {
    const normalized = normalizeVoiceCommand(command);
    const parsed = classifyVoiceCommand(normalized);
    console.info("[SAHAYAK_INTENT]", { rawCommand: command, normalized, intent: parsed.intent, trigger: parsed.trigger });

    if (!parsed.trigger) {
      setVoiceStatus("Ready");
      setStatusText("Voice command not classified as an emergency.");
      return;
    }

    setVoiceStatus("Understanding");
    setStatusText(parsed.message || "Understanding your emergency command.");
    await new Promise((resolve) => setTimeout(resolve, 250));
    setVoiceStatus("Emergency detected");
    setStatusText(parsed.message || "Emergency detected.");
    try {
      setVoiceStatus("Sending alert");
      setStatusText("Sending alert to emergency contacts.");
      await sendEmergencyRequest(command, parsed.intent);
    } catch (requestError) {
      console.error("[SAHAYAK_VOICE] emergency request failed", requestError);
      setVoiceStatus("Failed");
      setStatusText("Emergency alert failed to send.");
    }
  }

  async function startMediaRecording() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setError("This browser cannot record audio. Use Chrome or Edge for voice emergency commands.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaChunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size) mediaChunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          setVoiceStatus("Understanding");
          setStatusText("Transcribing your recording...");
          void transcribeEmergencyAudio(new Blob(mediaChunksRef.current, { type: recorder.mimeType })).then((response) => {
            if (!response.success || !response.data?.transcript) {
              setVoiceStatus("Failed");
              setError(response.message || "Speech transcription failed.");
              return;
            }
            setTranscript(response.data.transcript);
            void handleVoiceCommand(response.data.transcript);
          });
        };
        mediaRecorderRef.current = recorder;
        recorder.start();
        setVoiceStatus("Listening");
        setStatusText("Recording... press the microphone again to stop.");
      } catch {
        setError("Microphone permission is required for voice emergency commands.");
        setVoiceStatus("Failed");
      }
    }

  function stopRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }

  function startListening() {
    if (!enabled) {
      setError("Enable Emergency Voice Mode before using the microphone.");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      } else {
        void startMediaRecording();
      }
      return;
    }

    stopRecognition();
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.info("[SAHAYAK_VOICE] recognition started");
      setVoiceStatus("Listening");
      setStatusText("Listening for your command...");
      setError("");
    };

    recognition.onresult = (event: any) => {
      const results = Array.from(event.results || []) as any[];
      const finalResult = results.filter((result) => result.isFinal).map((result) => result[0]?.transcript || "").join(" ").trim();
      if (!finalResult) return;
      if (lastTranscriptRef.current === finalResult) return;
      lastTranscriptRef.current = finalResult;
      setTranscript(finalResult);
      console.info("[SAHAYAK_TRANSCRIPT]", { transcript: finalResult });
      void handleVoiceCommand(finalResult);
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    };

    recognition.onnomatch = () => {
      setVoiceStatus("Failed");
      setStatusText("No clear command detected. Please try again.");
    };

    recognition.onerror = (event: any) => {
      const errorMessage = event?.error ? `Speech recognition error: ${event.error}` : "Speech recognition failed.";
      console.error("[SAHAYAK_VOICE] recognition error", { error: event?.error || event });
      setVoiceStatus("Failed");
      setStatusText(errorMessage);
      setError(errorMessage);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (voiceStatus !== "Alert sent" && voiceStatus !== "Sending alert" && voiceStatus !== "Emergency detected") {
        setVoiceStatus("Ready");
        setStatusText("Waiting for a command.");
        setEmergencyId("");
        setSmsStatus("");
      }
      console.info("[SAHAYAK_VOICE] recognition ended");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setVoiceStatus("Failed");
      setStatusText("Voice recognition could not start. Please try again.");
      setError("Voice recognition could not start. Please try again.");
    }
  }

  useEffect(() => {
    if (!open) {
      stopRecognition();
      lastTranscriptRef.current = "";
      setVoiceStatus("Ready");
      setStatusText("Waiting for a command.");
    }
  }, [open]);

  return (
    <>
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
                    onClick={() => startListening()}
                    disabled={!enabled || busy}
                    aria-label="Start voice emergency capture"
                    className={`grid size-20 place-items-center rounded-full border-4 shadow-lg transition ${enabled ? "border-red-200 bg-red-600 text-white hover:bg-red-700" : "border-slate-200 bg-slate-200 text-slate-400"}`}
                  >
                    <Mic className="size-9" />
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

              <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <button type="button" onClick={() => setHelperOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Emergency Helpers</h3>
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
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-800">{helper.name}</p>
                              <p className="truncate text-xs text-slate-600">{maskPhone(helper.phone)}</p>
                            </div>
                            <button type="button" onClick={() => void removeHelper(helper._id)} className="rounded-md p-1.5 text-red-700 transition hover:bg-red-50" aria-label={`Delete ${helper.name}`}>
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-slate-200 bg-white p-2 text-xs text-slate-500">No emergency helpers saved yet.</p>
                    )}

                    <form onSubmit={addHelper} className="grid gap-2 pt-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Name" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-red-400" />
                      <input value={phone} onChange={(event) => setPhone(event.target.value)} required placeholder="+91 ..." className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-red-400" />
                      <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
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
