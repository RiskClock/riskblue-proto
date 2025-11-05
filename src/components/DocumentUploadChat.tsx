import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Send, Loader2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface DocumentUploadChatProps {
  projectId: string;
}

export const DocumentUploadChat = ({ projectId }: DocumentUploadChatProps) => {
  const { toast } = useToast();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("projectId", projectId);

    try {
      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook-test/e2fe8425-b13f-46a9-b7c6-064c5425cf06",
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Upload failed:", errorText);
        throw new Error("Failed to upload file");
      }

      const data = await response.json();
      setUploadedFile(file);
      toast({
        title: "File uploaded",
        description: "You can now ask questions about the document",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSendQuestion = async () => {
    if (!question.trim() || !uploadedFile) return;

    const userMessage: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setSending(true);

    const loadingMessage: Message = { role: "assistant", content: "Thinking..." };
    setMessages((prev) => [...prev, loadingMessage]);

    try {
      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook-test/e2fe8425-b13f-46a9-b7c6-064c5425cf06",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question, projectId }),
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
    <Card className="p-6 space-y-4 mb-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">Upload Document</label>
        <div className="flex gap-2">
          <Input
            type="file"
            onChange={handleFileUpload}
            disabled={uploading}
            className="flex-1"
          />
          {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
        </div>
        {uploadedFile && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="w-4 h-4" />
            <span>{uploadedFile.name}</span>
          </div>
        )}
      </div>

      {uploadedFile && (
        <div className="space-y-4 pt-4 border-t">
          <label className="text-sm font-medium">Ask Questions</label>
          <ScrollArea className="h-[300px] border rounded-lg p-4 bg-muted/30">
            {messages.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Ask questions about the uploaded document
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
      )}
    </Card>
  );
};
