import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Sparkles, User, Bot, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface DriveFilesChatProps {
  analysisResult: string;
  fileUris?: Array<{ uri: string; mimeType: string }>;
}

export const DriveFilesChat = ({ analysisResult, fileUris }: DriveFilesChatProps) => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    
    const newMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const response = await supabase.functions.invoke("chat-with-files", {
        body: {
          messages: newMessages,
          analysisContext: analysisResult,
          fileUris,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      if (response.data?.error) {
        throw new Error(response.data.error);
      }

      setMessages([...newMessages, { role: "assistant", content: response.data.response }]);
    } catch (error) {
      console.error("Chat error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to get response",
        variant: "destructive",
      });
      // Remove the user message if we failed
      setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t">
      {/* Collapsible Analysis Result */}
      <div className="space-y-2">
        <button
          onClick={() => setShowAnalysis(!showAnalysis)}
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors w-full text-left"
        >
          <Sparkles className="w-4 h-4 text-primary" />
          AI Analysis Result
          {showAnalysis ? (
            <ChevronUp className="w-4 h-4 ml-auto" />
          ) : (
            <ChevronDown className="w-4 h-4 ml-auto" />
          )}
        </button>
        
        {showAnalysis && (
          <ScrollArea className="h-[200px] rounded-lg border bg-muted/30 p-4">
            <pre className="text-xs whitespace-pre-wrap font-mono">
              {analysisResult}
            </pre>
          </ScrollArea>
        )}
      </div>

      {/* Chat Interface */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Bot className="w-4 h-4" />
          Ask Follow-up Questions
        </label>
        
        {/* Messages */}
        {messages.length > 0 && (
          <ScrollArea className="h-[250px] rounded-lg border bg-background p-3">
            <div ref={scrollRef} className="space-y-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <pre className="whitespace-pre-wrap font-sans text-sm">
                      {msg.content}
                    </pre>
                  </div>
                  {msg.role === "user" && (
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <User className="w-3.5 h-3.5 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-2 justify-start">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the analysis..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
        
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ask questions like "Which pipes need the most critical monitoring?" or "Explain the fire suppression system setup"
          </p>
        )}
      </div>
    </div>
  );
};
