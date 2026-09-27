"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Loader2, Send, Sparkles, X } from "lucide-react";
import { chatWithSahayak } from "@/lib/api";
import { emergencyHelplines, getEmergencyGuidance } from "@/lib/emergency-helplines";
import { getOfflineSahayakResponse } from "@/lib/offline-sahayak";
import EmergencyVoiceMode from "@/components/emergency-voice-mode";

type SahayakResponse = {
  message?: string;
  understanding?: { summary?: string };
  severity?: string;
  can_solve_myself?: boolean;
  solution_info?: { steps?: string[]; tools_materials?: string[]; estimated_time?: string; estimated_cost?: string };
  safety_guidance?: { precautions?: string[]; when_to_stop?: string };
  escalation?: { required?: boolean; contact?: string; reason?: string };
  prevention?: string[];
  helplines?: { name?: string; number?: string; purpose?: string }[];
  emergency?: boolean;
  emergencyScenario?: Parameters<typeof getEmergencyGuidance>[0];
};

type Message = { id: number; author: "user" | "sahayak"; text?: string; response?: SahayakResponse };
type View = "citizen" | "submit" | "challenges";

const quickActions: { label: string; view: View }[] = [
  { label: "Submit a Problem", view: "submit" },
  { label: "Browse Challenges", view: "challenges" },
  { label: "My Submissions", view: "citizen" },
];

function ResponseBody({ response }: { response: SahayakResponse }) {
  const [copiedNumber, setCopiedNumber] = useState("");

  if (response.emergency && response.emergencyScenario) {
    const emergency = getEmergencyGuidance(response.emergencyScenario);
    const copyNumber = (number: string) => {
      if (!navigator.clipboard) {
        console.error("Clipboard API is unavailable; use the visible number to copy it manually");
        return;
      }
      void navigator.clipboard.writeText(number).then(
        () => setCopiedNumber(number),
        (error: unknown) => console.error("Unable to copy emergency number", error),
      );
    };

    return (
      <div className="space-y-3 text-sm leading-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-base font-extrabold text-red-900">{emergency.icon} {emergency.title}</p>
          <p className="mt-1 text-xs text-red-800">Emergency guidance does not replace professional emergency services.</p>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          {emergency.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <div className="space-y-2">
          {emergency.contacts.map((contact) => (
            <div key={contact.number} className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 ${contact.primary ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
              <div className="min-w-0">
                <p className="font-bold text-slate-800">{contact.name}</p>
                <p className="text-xs text-slate-500">{contact.number}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <a href={`tel:${contact.number}`} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-red-800">
                  Call {contact.number}
                </a>
                <button type="button" onClick={() => copyNumber(contact.number)} className="rounded-lg border border-slate-300 px-2 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50" aria-label={`Copy ${contact.number}`}>
                  {copiedNumber === contact.number ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (response.message) {
    return <p dir="auto" className="text-sm leading-6">{response.message}</p>;
  }

  const sections = [
    ["What Sahayak understood", response.understanding?.summary],
    ["Next steps", response.solution_info?.steps],
    ["Safety", response.safety_guidance?.precautions],
    ["Stop and get help if", response.safety_guidance?.when_to_stop],
    ["When to get help", response.escalation?.contact],
    ["Prevention", response.prevention],
    ["Estimated time", response.solution_info?.estimated_time],
    ["Estimated cost", response.solution_info?.estimated_cost],
  ] as const;
  return (
    <div className="space-y-3 text-sm leading-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
          {response.severity || "Guidance"}
        </span>
        <span className="text-xs font-semibold text-slate-500">
          {response.can_solve_myself ? "Safe basic steps available" : "Professional help may be needed"}
        </span>
      </div>
      {sections.map(([title, content]) => {
        if (!content || (Array.isArray(content) && content.length === 0)) return null;
        return (
          <section key={title}>
            <p className="font-bold text-slate-800">{title}</p>
            {Array.isArray(content) ? (
              <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
                {content.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : <p className="mt-1 text-slate-600">{content}</p>}
          </section>
        );
      })}
      {response.helplines?.length ? (
        <section>
          <p className="font-bold text-slate-800">Verified helplines</p>
          <div className="mt-1 space-y-1 text-slate-600">
            {response.helplines.slice(0, 3).map((helpline) => (
              <p key={`${helpline.name}-${helpline.number}`}>
                {helpline.name}: <a className="font-bold text-emerald-800 underline" href={`tel:${helpline.number}`}>{helpline.number}</a>
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function SahayakChat({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [error, setError] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [offlineFallback, setOfflineFallback] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, author: "sahayak", text: "Hello! I am Sahayak. Tell me about a local problem or ask how the portal can help." },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    const updateOnlineState = () => {
      setIsOnline(navigator.onLine);
      if (navigator.onLine) setOfflineFallback(false);
    };
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  async function sendMessage(event?: React.FormEvent, preset?: string) {
    event?.preventDefault();
    const problem = (preset ?? input).trim();
    if (!problem || sending) return;
    setError("");
    if (!preset) setInput("");
    setMessages((current) => [...current, { id: Date.now(), author: "user", text: problem }]);
    setSending(true);
    const localResponse = getOfflineSahayakResponse(problem, language);
    const response = localResponse.emergency || !isOnline
      ? { success: true, data: localResponse }
      : await chatWithSahayak(problem, language);
    setSending(false);
    if (!response.success || !response.data) {
      setOfflineFallback(true);
      setMessages((current) => [...current, { id: Date.now() + 1, author: "sahayak", response: getOfflineSahayakResponse(problem, language) }]);
      return;
    }

    if ("offline" in response.data) setOfflineFallback(true);
    setMessages((current) => [...current, { id: Date.now() + 1, author: "sahayak", response: response.data }]);
  }

  return (
    <>
      <section className={`mobile-sahayak-window fixed inset-x-4 bottom-24 z-50 flex max-h-[min(680px,calc(100vh-7rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition duration-200 sm:inset-auto sm:bottom-24 sm:right-6 sm:w-[min(410px,calc(100vw-2rem))] ${isOpen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`} aria-label="Sahayak chat" aria-hidden={!isOpen} inert={!isOpen ? true : undefined}>
          <header className="flex items-start justify-between gap-2 bg-emerald-900 px-3 py-3 text-white sm:gap-3 sm:px-4 sm:py-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-400 text-emerald-950"><Bot className="size-5" /></span><div className="min-w-0"><h2 className="font-bold">Sahayak</h2><p className="break-words text-xs text-emerald-100">Your AI assistant for the Jharkhand Innovation Portal</p><p className="mt-1 text-xs font-semibold">{isOnline && !offlineFallback ? "🟢 Sahayak AI — Online" : "🟠 Sahayak — Offline Assistance"}</p></div></div>
            <div className="flex shrink-0 items-center gap-1"><label className="sr-only" htmlFor="sahayak-language">Language</label><select id="sahayak-language" value={language} onChange={(event) => setLanguage(event.target.value as "en" | "hi")} className="max-w-[84px] rounded-md border-0 bg-white/10 px-1 py-1 text-xs text-white outline-none [&>option]:text-slate-900"><option value="en">English</option><option value="hi">हिंदी</option></select><button onClick={() => setIsOpen(false)} aria-label="Close Sahayak" className="rounded-lg p-2 hover:bg-white/10"><X className="size-5" /></button></div>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4" aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.author === "user" ? "justify-end" : "justify-start"}`}>
                <div className={message.author === "user" ? "max-w-[85%] rounded-2xl rounded-br-md bg-emerald-800 px-3.5 py-2.5 text-sm leading-6 text-white" : "max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-slate-700 shadow-sm"}>
                  {message.text ? <p dir="auto">{message.text}</p> : <ResponseBody response={message.response!} />}
                </div>
              </div>
            ))}
            {sending ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Sahayak is thinking...</div> : null}
            <div ref={messagesEndRef} />
          </div>
          {error ? <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p> : null}
          <div className="border-t border-slate-200 bg-white p-3">
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {quickActions.map((action) => <button key={action.label} onClick={() => { setIsOpen(false); onNavigate(action.view); }} className="shrink-0 rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50">{action.label}</button>)}
              <button onClick={() => void sendMessage(undefined, "How does this portal work?")} disabled={sending} className="shrink-0 rounded-full border border-orange-200 px-3 py-1.5 text-xs font-bold text-orange-800 hover:bg-orange-50 disabled:opacity-50">How does this portal work?</button>
            </div>
            <button type="button" onClick={() => setShowDirectory((current) => !current)} className="mb-2 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-xs font-bold text-red-900">
              {showDirectory ? "Hide" : "Open"} offline national emergency helpline directory
            </button>
            {showDirectory ? (
              <div className="mb-2 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="px-1 pb-1 text-[11px] text-slate-500">Numbers are stored on this device. Availability and routing for some services may vary by state.</p>
                {emergencyHelplines.map((helpline) => (
                  <div key={helpline.number} className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs">
                    <span className="min-w-0"><strong>{helpline.number}</strong> <span className="text-slate-600">{helpline.name}</span></span>
                    <a href={`tel:${helpline.number}`} className="shrink-0 rounded bg-red-700 px-2 py-1 font-bold text-white">Call</a>
                  </div>
                ))}
              </div>
            ) : null}
            <EmergencyVoiceMode />
            <form onSubmit={sendMessage} className="flex items-end gap-2">
              <label className="sr-only" htmlFor="sahayak-input">Message Sahayak</label>
              <textarea id="sahayak-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} rows={1} disabled={sending} placeholder="Describe your problem..." className="min-h-10 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15 disabled:bg-slate-100" />
              <button type="submit" disabled={sending || !input.trim()} aria-label="Send message" className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-800 text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"><Send className="size-4" /></button>
            </form>
          </div>
      </section>
      <button onClick={() => setIsOpen((current) => !current)} aria-expanded={isOpen} aria-label={isOpen ? "Close Sahayak" : "Open Sahayak assistant"} className="mobile-sahayak-trigger fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-emerald-900 px-4 py-3 text-sm font-bold text-white shadow-xl transition hover:-translate-y-0.5 hover:bg-emerald-950 focus:outline-none focus:ring-4 focus:ring-emerald-700/25 sm:right-6"><Sparkles className="size-4 text-orange-300" />Sahayak<ChevronDown className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} /></button>
    </>
  );
}

export function OfflineHomepageSahayak() {
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [isOnline, setIsOnline] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  function sendOfflineMessage(event: React.FormEvent) {
    event.preventDefault();
    const problem = input.trim();
    if (!problem) return;
    setInput("");
    const response = getOfflineSahayakResponse(problem, language);
    setMessages((current) => [
      ...current,
      { id: Date.now(), author: "user", text: problem },
      { id: Date.now() + 1, author: "sahayak", response },
    ]);
  }

  if (isOnline) return null;

  return (
    <section className="mx-auto mt-8 w-full max-w-7xl rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm sm:p-6" aria-label="Offline Sahayak">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-extrabold text-orange-950">🟠 Offline Sahayak</p>
          <p className="mt-1 text-sm text-orange-900">Internet is unavailable, but Sahayak can still help.</p>
          <p className="mt-2 text-xs font-semibold text-orange-800">Emergency • Problems • Basic Guidance</p>
        </div>
        <label className="text-xs font-bold text-orange-950">
          Language
          <select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "hi")} className="ml-2 rounded-md border border-orange-300 bg-white px-2 py-1 text-xs">
            <option value="en">English</option>
            <option value="hi">हिंदी</option>
          </select>
        </label>
      </div>
      {messages.length > 0 ? (
        <div className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto rounded-xl border border-orange-100 bg-white p-3">
          {messages.map((message) => (
            <div key={message.id} className={message.author === "user" ? "ml-auto max-w-[88%] rounded-xl bg-emerald-800 px-3 py-2 text-sm text-white" : "max-w-[96%] rounded-xl border border-slate-200 bg-white p-3 text-slate-700"}>
              {message.text ? <p dir="auto">{message.text}</p> : <ResponseBody response={message.response!} />}
            </div>
          ))}
        </div>
      ) : null}
      <form onSubmit={sendOfflineMessage} className="mt-4 flex items-end gap-2">
        <label htmlFor="offline-sahayak-input" className="sr-only">Ask Offline Sahayak</label>
        <textarea id="offline-sahayak-input" value={input} onChange={(event) => setInput(event.target.value)} rows={2} placeholder="Describe your problem..." className="min-h-11 flex-1 resize-y rounded-xl border border-orange-300 bg-white text-black caret-black placeholder:text-gray-500 px-3 py-2.5 text-sm outline-none focus:border-orange-600 focus:text-black focus:ring-2 focus:ring-orange-600/20" />
        <button type="submit" disabled={!input.trim()} className="rounded-xl bg-orange-700 px-4 py-3 text-sm font-bold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50">Get Help</button>
      </form>
    </section>
  );
}