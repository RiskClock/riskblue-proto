import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { normalizeFunctionError } from "@/lib/functionsError";

interface WadeMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

export function AskWadePanel({
  projectId,
  onClose,
  buildContext,
}: {
  projectId: string;
  onClose: () => void;
  buildContext: () => unknown;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<WadeMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
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
  }, [projectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  const persist = async (role: "user" | "assistant", content: string) => {
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("wade_chat_messages" as any).insert({
      project_id: projectId,
      user_id: auth?.user?.id ?? null,
      role,
      content,
    } as any);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const next: WadeMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setSending(true);
    void persist("user", text);

    try {
      const { data, error } = await supabase.functions.invoke("ask-wade", {
        body: {
          projectId,
          context: buildContext(),
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        },
      });
      if (error) throw await normalizeFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);

      const answer = (data as any).response as string;
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      void persist("assistant", answer);
    } catch (e: any) {
      toast({
        title: "Wade could not answer",
        description: e?.message || "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = async () => {
    const { error } = await supabase
      .from("wade_chat_messages" as any)
      .delete()
      .eq("project_id", projectId);
    if (error) {
      toast({ title: "Failed to clear chat", description: (error as any)?.message, variant: "destructive" });
      return;
    }
    setMessages([]);
    inputRef.current?.focus();
  };

  return (
    <div className="border rounded-md flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/20">
        <div className="text-sm font-semibold">Ask Wade</div>
        <div className="flex items-center gap-1">
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
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Close" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Ask about detections, classes and subtypes, floor plans, levels and units, or
              anything in this threat report. For example: "How many cold water instances are on
              Level 6?" or "Which pages have no detections?"
            </p>
          ) : (
            messages.map((m, i) => (
              <div key={m.id ?? i} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <div className="max-w-[90%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
                    {m.content}
                  </div>
                ) : (
                  <div className="text-sm leading-relaxed [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_table]:text-xs [&_code]:text-xs">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))
          )}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking...
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t p-2 flex items-end gap-2">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          rows={2}
          className="min-h-[44px] resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button size="icon" onClick={() => void send()} disabled={!input.trim() || sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
