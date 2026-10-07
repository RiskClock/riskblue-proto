import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { GripVertical, Loader2, Minus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { normalizeFunctionError } from "@/lib/functionsError";
import { cropDrawingAt } from "@/lib/wadeSkills";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";

interface WadeMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

// Number of most recent turns sent to the model per request. The full history
// is still rendered and persisted.
const MAX_HISTORY_TURNS = 10;

/**
 * Pulls an action payload out of an assistant reply. Accepts a ```wade-actions
 * block, any other fenced block whose body is an actions payload, or a bare
 * {"actions":[...]} object the model wrote inline.
 */
function extractActions(text: string): { visible: string; actions: any[] } {
  const actions: any[] = [];
  const take = (raw: string) => {
    try {
      const parsed = JSON.parse(String(raw).trim());
      const list = Array.isArray(parsed) ? parsed : parsed?.actions;
      if (Array.isArray(list) && list.length > 0) {
        actions.push(...list);
        return true;
      }
    } catch {
      /* not an action payload */
    }
    return false;
  };

  let visible = text.replace(/```[a-zA-Z-]*\s*([\s\S]*?)```/g, (m, body) =>
    take(body) ? "" : m,
  );

  if (actions.length === 0) {
    const start = visible.search(/\{\s*"actions"/);
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < visible.length; i += 1) {
        const ch = visible[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            if (take(visible.slice(start, i + 1))) {
              visible = visible.slice(0, start) + visible.slice(i + 1);
            }
            break;
          }
        }
      }
    }
  }

  return { visible: visible.trim(), actions };
}


export function AskWadePanel({
  projectId,
  onClose,
  buildContext,
  persistHistory = true,
  title = "Ask Wade",
  emptyHint,
  onAssistantMessage,
  actionSpec,
  onActions,
  onMinimize,
  dragHandleProps,
  skills,
  calibration,
}: {
  projectId: string;
  onClose: () => void;
  buildContext: () => unknown | Promise<unknown>;
  /** When false, the transcript is session-only (no database reads/writes). */
  persistHistory?: boolean;
  title?: string;
  emptyHint?: string;
  /** Called with each assistant reply, for callers that extract content from it. */
  onAssistantMessage?: (content: string) => void;
  /** Extra system guidance describing the actions Wade may perform. */
  actionSpec?: string;
  /** Executes actions Wade requested; returns a markdown summary of what changed. */
  onActions?: (actions: any[]) => Promise<string | null>;
  /** When provided, a minimize button is shown in the header. */
  onMinimize?: () => void;
  /** Pointer handlers that make the header act as a drag handle. */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Skills the user can start manually from the panel. */
  skills?: { id: string; label: string; onRun: () => void; disabled?: boolean }[];
  /** Enables the in-chat Class Calibration skill. */
  calibration?: {
    classes: { name: string; label: string }[];
    disabled?: boolean;
    /** Bump `nonce` to start the flow (e.g. when Wade decides to run the skill). */
    request?: { nonce: number; cls?: string | null; note?: string | null } | null;
  };
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<WadeMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(persistHistory);
  const bottomRef = useRef<HTMLDivElement>(null);
  type Flow =
    | { step: "class" }
    | { step: "note"; cls: string; label: string }
    | { step: "pick"; cls: string; label: string; note: string }
    | { step: "running"; cls: string; label: string };
  const [flow, setFlow] = useState<Flow | null>(null);
  type Choice = { prompt: string; options: { value: string; label: string }[]; multi: boolean };
  const [choice, setChoice] = useState<Choice | null>(null);
  const [choiceValue, setChoiceValue] = useState<string[]>([]);
  const [classPick, setClassPick] = useState("");

  const say = async (role: "user" | "assistant", content: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, content }]);
    await persist(role, content);
  };

  const matchClass = (text: string) => {
    const list = calibration?.classes ?? [];
    const t = text.trim().toLowerCase();
    if (!t) return null;
    return (
      list.find((c) => c.name.toLowerCase() === t || c.label.toLowerCase() === t) ||
      list.find((c) => c.label.toLowerCase().includes(t) || c.name.toLowerCase().includes(t)) ||
      list.find((c) => t.includes(c.label.toLowerCase()) || t.includes(c.name.toLowerCase())) ||
      null
    );
  };

  const askForNote = (cls: string, label: string) => {
    setFlow({ step: "note", cls, label });
    void say("assistant", `Calibrating **${label}**. Describe how it appears on this project's drawings (symbols, hatches, labels), or type "skip".`);
  };

  const startCalibration = (cls?: string | null, note?: string | null) => {
    const match = cls ? matchClass(cls) : null;
    if (match && note) {
      setFlow({ step: "pick", cls: match.name, label: match.label, note });
      void say("assistant", `Calibrating **${match.label}**. Click an example of it on the drawing.`);
    } else if (match) {
      askForNote(match.name, match.label);
    } else {
      setFlow({ step: "class" });
      void say("assistant", "Class Calibration: which class do you want to calibrate? Pick it from the list below.");
    }
  };

  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    const r = calibration?.request;
    if (!r || r.nonce === lastNonce.current || loading) return;
    lastNonce.current = r.nonce;
    startCalibration(r.cls, r.note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibration?.request, loading]);

  const handleFlowInput = async (text: string) => {
    if (!flow) return;
    if (/^(cancel|stop)$/i.test(text.trim())) {
      setFlow(null);
      await say("user", text);
      await say("assistant", "Class Calibration cancelled.");
      return;
    }
    if (flow.step === "class") {
      await say("user", text);
      const m = matchClass(text);
      if (!m) {
        await say("assistant", `I couldn't find a class matching "${text}". Try again, or type "cancel".`);
        return;
      }
      askForNote(m.name, m.label);
    } else if (flow.step === "note") {
      await say("user", text);
      const note = /^skip$/i.test(text.trim()) ? "" : text;
      setFlow({ step: "pick", cls: flow.cls, label: flow.label, note });
      await say("assistant", `Now click an example of **${flow.label}** on the drawing.`);
    }
  };

  const runCalibration = async (f: Extract<Flow, { step: "pick" }>, image: string, coordinates: { x: number; y: number } | null) => {
    setFlow({ step: "running", cls: f.cls, label: f.label });
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: "Picked an example on the drawing." }]);
    try {
      const { data, error } = await supabase.functions.invoke("calibrate-class", {
        body: { projectId, class_id: f.cls, user_text_description: f.note, coordinates, imageBase64: image },
      });
      if (error) throw await normalizeFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      const prompt = String((data as any).current_prompt ?? "");
      await say(
        "assistant",
        `Saved a calibrated **${f.label}** prompt for this project. Risk Radar will use it from now on.\n\n\`\`\`text\n${prompt}\n\`\`\``,
      );
    } catch (e: any) {
      await say("assistant", `Calibration failed: ${e?.message || "unknown error"}`);
    } finally {
      setFlow(null);
    }
  };

  // Capture the next click on the drawing while picking.
  useEffect(() => {
    if (flow?.step !== "pick") return;
    const current = flow;
    let swallowUntil = 0;
    const onDown = (ev: PointerEvent) => {
      const surface = (ev.target as HTMLElement | null)?.closest?.("[data-doc-surface]");
      if (!surface) return;
      const img = surface.querySelector("img.pdf-canvas-element") as HTMLImageElement | null;
      if (!img) return;
      ev.preventDefault();
      ev.stopPropagation();
      swallowUntil = Date.now() + 800;
      const image = cropDrawingAt(img, ev.clientX, ev.clientY);
      if (!image) {
        toast({ title: "Could not read the drawing", description: "Try again once the drawing has loaded.", variant: "destructive" });
        return;
      }
      const rect = img.getBoundingClientRect();
      const coordinates = rect.width && rect.height && img.naturalWidth
        ? {
            x: Math.round((ev.clientX - rect.left) * (img.naturalWidth / rect.width)),
            y: Math.round((ev.clientY - rect.top) * (img.naturalHeight / rect.height)),
          }
        : null;
      void runCalibration(current, image, coordinates);
    };
    const swallow = (ev: Event) => {
      if (Date.now() < swallowUntil) { ev.preventDefault(); ev.stopPropagation(); }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", swallow, true);
    document.addEventListener("click", swallow, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      setTimeout(() => {
        document.removeEventListener("pointerup", swallow, true);
        document.removeEventListener("click", swallow, true);
      }, 900);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  useEffect(() => {
    if (!persistHistory) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("wade_chat_messages" as any)
        .select("id, role, content")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setMessages(((data as any[]) || []).map((r) => ({ id: r.id, role: r.role, content: r.content })));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, persistHistory]);


  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  // Log the whole Wade conversation as a single project activity when the
  // panel closes / unmounts (not one entry per message).
  const sessionCountRef = useRef(0);
  useEffect(() => {
    return () => {
      const count = sessionCountRef.current;
      if (count === 0 || !persistHistory) return;
      sessionCountRef.current = 0;
      void (async () => {
        try {
          const { data: auth } = await supabase.auth.getUser();
          const u = auth?.user;
          if (!u) return;
          const name =
            (u.user_metadata as any)?.full_name ||
            (u.user_metadata as any)?.name ||
            null;
          await supabase.from("project_audit_events" as any).insert({
            project_id: projectId,
            actor_user_id: u.id,
            actor_email: u.email ?? null,
            actor_name: name,
            entity_type: "wade_chat",
            entity_id: null,
            action: "session",
            summary: `Ask Wade session - ${count} message${count === 1 ? "" : "s"} sent`,
            details: { message_count: count },
          } as any);
        } catch (e) {
          console.warn("Failed to log Wade session activity", e);
        }
      })();
    };
  }, [projectId, persistHistory]);


  const persist = async (role: "user" | "assistant", content: string) => {
    if (!persistHistory) return;
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("wade_chat_messages" as any).insert({
      project_id: projectId,
      user_id: auth?.user?.id ?? null,
      role,
      content,
    } as any);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    if (flow) {
      if (flow.step === "class" || flow.step === "note") {
        setInput("");
        await handleFlowInput(text);
      }
      return;
    }
    const pendingId = crypto.randomUUID();
    const pendingMessage: WadeMessage = { id: pendingId, role: "user", content: text };
    setSending(true);
    setInput("");
    setMessages((prev) => [...prev, pendingMessage]);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      let session = sessionData.session;
      if (sessionError) throw sessionError;

      const expiresSoon = session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;
      if (expiresSoon) {
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        session = refreshed.session;
      }

      if (!session?.access_token) {
        throw new Error("Your session expired - please sign in again.");
      }

      const next: WadeMessage[] = [...messages, pendingMessage];
      // Sliding window: only the most recent turns are sent to the model. The
      // full transcript stays in the UI and in wade_chat_messages.
      const windowed = next.slice(-MAX_HISTORY_TURNS);
      const { data, error } = await supabase.functions.invoke("ask-wade", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          projectId,
          context: await buildContext(),
          messages: windowed.map((m) => ({ role: m.role, content: m.content })),
          actionSpec: onActions ? actionSpec : undefined,
        },
      });
      if (error) throw await normalizeFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);

      const raw = (data as any).response as string;
      const extracted = extractActions(raw);
      const visible = extracted.visible;
      const choiceAction = extracted.actions.find((a) => a?.type === "ask_user_choice");
      const actions = onActions ? extracted.actions.filter((a) => a?.type !== "ask_user_choice") : [];
      if (choiceAction && Array.isArray(choiceAction.options) && choiceAction.options.length > 0) {
        const opts = choiceAction.options
          .map((o: any) => (typeof o === "string" ? { value: o, label: o } : { value: String(o?.value ?? o?.label ?? ""), label: String(o?.label ?? o?.value ?? "") }))
          .filter((o: any) => o.value);
        if (opts.length) {
          setChoice({ prompt: String(choiceAction.prompt ?? "Choose an option"), options: opts, multi: !!choiceAction.multi });
          setChoiceValue([]);
        }
      }
      const answer = visible || (choiceAction ? String(choiceAction.prompt ?? "Choose an option.") : actions.length > 0 ? "Applying the requested changes..." : raw);

      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      onAssistantMessage?.(answer);
      await persist("user", text);
      await persist("assistant", answer);
      sessionCountRef.current += 1;

      if (onActions && actions.length > 0) {
        let recap: string | null = null;
        try {
          recap = await onActions(actions);
        } catch (actionErr: any) {
          recap = `I could not apply the changes: ${actionErr?.message || "unknown error"}`;
        }
        if (recap) {
          setMessages((prev) => [...prev, { role: "assistant", content: recap! }]);
          await persist("assistant", recap);
        }
      }
    } catch (e: any) {
      setMessages((prev) => prev.filter((message) => message.id !== pendingId));
      setInput((cur) => (cur.trim() ? cur : text));
      toast({
        title: "Wade could not answer",
        description: e?.message || "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const clearChat = async () => {
    if (!persistHistory) {
      setMessages([]);
      return;
    }
    const { error } = await supabase
      .from("wade_chat_messages" as any)
      .delete()
      .eq("project_id", projectId);
    if (error) {
      toast({ title: "Failed to clear chat", description: (error as any)?.message, variant: "destructive" });
      return;
    }
    setMessages([]);
  };

  return (
    <div className="border rounded-md flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b px-3 py-2 bg-muted/20">
        {dragHandleProps ? (
          <div
            {...dragHandleProps}
            className="flex items-center self-stretch cursor-move text-muted-foreground shrink-0"
            title="Drag to move"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        ) : null}
        <div className="text-sm font-semibold shrink-0">{title}</div>
        {dragHandleProps ? (
          <div {...dragHandleProps} className="flex-1 self-stretch cursor-move" title="Drag to move" />
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Clear conversation"
            onClick={clearChat}
            disabled={messages.length === 0 || sending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {onMinimize && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Minimize" onClick={onMinimize}>
              <Minus className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Close" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Conversation className="min-h-0">
        <ConversationContent className="gap-3 p-3">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {emptyHint ?? `Ask about detections, classes and subtypes, floor plans, levels and units, or
              anything in this threat report. For example: "How many cold water instances are on
              Level 6?" or "Which pages have no detections?"`}
            </p>
          ) : (
            messages.map((m, i) => (
              <Message key={m.id ?? i} from={m.role}>
                <MessageContent className={m.role === "user" ? "!bg-primary !text-primary-foreground px-3 py-2" : "px-0 py-0"}>
                  {m.role === "user" ? m.content : <MessageResponse>{m.content}</MessageResponse>}
                </MessageContent>
              </Message>
            ))
          )}
          {sending && (
            <Message from="assistant">
              <MessageContent className="flex-row items-center gap-2 px-0 py-0">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Working...</span>
              </MessageContent>
            </Message>
          )}
          <div ref={bottomRef} />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {choice && !flow && (
        <div className="border-t px-3 py-2 space-y-2 bg-muted/30">
          <div className="text-xs font-medium">{choice.prompt}</div>
          {choice.multi ? (
            <div className="flex flex-wrap gap-1.5">
              {choice.options.map((o) => {
                const on = choiceValue.includes(o.value);
                return (
                  <Button key={o.value} type="button" size="sm" variant={on ? "default" : "outline"} className="h-7 text-xs"
                    onClick={() => setChoiceValue((v) => (on ? v.filter((x) => x !== o.value) : [...v, o.value]))}>
                    {o.label}
                  </Button>
                );
              })}
            </div>
          ) : (
            <Select value={choiceValue[0] ?? ""} onValueChange={(v) => setChoiceValue([v])}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select an option" /></SelectTrigger>
              <SelectContent>
                {choice.options.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setChoice(null)}>Dismiss</Button>
            <Button type="button" size="sm" className="h-7 text-xs" disabled={choiceValue.length === 0 || sending}
              onClick={() => {
                const labels = choice.options.filter((o) => choiceValue.includes(o.value)).map((o) => o.label);
                setChoice(null);
                void send(labels.join(", "));
              }}>
              Confirm
            </Button>
          </div>
        </div>
      )}
      {flow?.step === "class" && calibration && (
        <div className="border-t px-3 py-2 flex items-center gap-2 bg-muted/30">
          <Select value={classPick} onValueChange={setClassPick}>
            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Select a class to calibrate" /></SelectTrigger>
            <SelectContent>
              {calibration.classes.map((c) => <SelectItem key={c.name} value={c.name} className="text-xs">{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" className="h-8 text-xs" disabled={!classPick}
            onClick={() => {
              const c = calibration.classes.find((x) => x.name === classPick);
              setClassPick("");
              if (c) void (async () => { await say("user", c.label); askForNote(c.name, c.label); })();
            }}>
            Confirm
          </Button>
        </div>
      )}
      {flow && (
        <div className="border-t px-3 py-2 flex items-center gap-2 text-xs bg-muted/30">
          {flow.step === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          <span className="flex-1">
            {flow.step === "class" && "Class Calibration: pick a class above or type its name."}
            {flow.step === "note" && `Describe ${flow.label}, or type "skip".`}
            {flow.step === "pick" && `Click an example of ${flow.label} on the drawing.`}
            {flow.step === "running" && `Calibrating ${flow.label}...`}
          </span>
          {flow.step !== "running" && (
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setFlow(null); void say("assistant", "Class Calibration cancelled."); }}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {((skills && skills.length > 0) || calibration) && !flow && (
        <div className="border-t px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">Skills:</span>
          {calibration && (
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => startCalibration()} disabled={calibration.disabled || sending}>
              Class Calibration
            </Button>
          )}
          {(skills ?? []).map((sk) => (
            <Button key={sk.id} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={sk.onRun} disabled={sk.disabled || sending}>
              {sk.label}
            </Button>
          ))}
        </div>
      )}
      <div className="border-t p-2">
        <PromptInput
          className="[&_[data-slot=input-group]]:relative [&_[data-slot=input-group]]:!flex-row"
          onSubmit={() => void send()}
        >
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={flow?.step === "class" ? "Type a class name..." : flow?.step === "note" ? "Describe the class, or type skip..." : "Ask a question..."}
            rows={1}
            className="min-h-9 max-h-24 py-2 pl-3 pr-11 text-sm"
          />
          <PromptInputFooter className="absolute bottom-1 right-1 w-auto justify-end p-0">
            <PromptInputSubmit
              className="h-7 w-7"
              status={sending ? "submitted" : "ready"}
              disabled={!input.trim() || sending || flow?.step === "pick" || flow?.step === "running"}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
