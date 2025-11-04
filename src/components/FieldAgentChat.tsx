import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface FieldAgentChatProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export const FieldAgentChat = ({ open, onClose, projectId }: FieldAgentChatProps) => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);

  const handleSendQuestion = async () => {
    if (!question.trim()) return;

    const userMessage: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setSending(true);

    const loadingMessage: Message = { role: "assistant", content: "Thinking..." };
    setMessages((prev) => [...prev, loadingMessage]);

    try {
      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook/e2ac331c-7bba-4517-baa5-28d233d641ca",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question: question, projectId }),
        }
      );

      if (!response.ok) throw new Error("Failed to send question");

      const data = await response.json();
      
      let answerContent = "";
      if (data.output) {
        answerContent = data.output;
      } else if (data.answer) {
        answerContent = data.answer;
      } else if (data.response) {
        answerContent = data.response;
      } else if (data.message && data.message !== "Workflow was started") {
        answerContent = data.message;
      } else {
        answerContent = "Response received but no answer found";
      }

      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: "assistant",
          content: answerContent,
        };
        return newMessages;
      });
    } catch (error) {
      console.error("Send question error:", error);
      setMessages((prev) => prev.slice(0, -1));
      toast({
        title: "Error",
        description: "Failed to get response",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Field Agent Chat</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 flex flex-col h-[60vh]">
          <ScrollArea className="flex-1 border rounded-lg p-4 bg-muted/30">
            {messages.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Ask the Field Agent anything about this project
              </p>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-card border"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendQuestion();
                }
              }}
              disabled={sending}
            />
            <Button
              type="button"
              onClick={handleSendQuestion}
              disabled={!question.trim() || sending}
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
