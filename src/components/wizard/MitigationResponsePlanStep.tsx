import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Send, Loader2 } from "lucide-react";

interface MitigationResponsePlanStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const MitigationResponsePlanStep = ({
  data,
  onNext,
  onBack,
}: MitigationResponsePlanStepProps) => {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileUploaded, setFileUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({
        title: "No file selected",
        description: "Please select a file to upload",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook/5a0ef151-1b7f-4b77-a1f2-de13e271a313/chat",
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) throw new Error("Upload failed");

      setFileUploaded(true);
      toast({
        title: "Success",
        description: "File uploaded successfully",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Error",
        description: "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSendQuestion = async () => {
    if (!question.trim()) return;

    const userMessage: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setSending(true);

    try {
      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook/5a0ef151-1b7f-4b77-a1f2-de13e271a313/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question: question }),
        }
      );

      if (!response.ok) throw new Error("Failed to send question");

      const data = await response.json();
      const assistantMessage: Message = {
        role: "assistant",
        content: data.answer || data.response || "No response received",
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Send question error:", error);
      toast({
        title: "Error",
        description: "Failed to send question",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({ mitigationResponsePlan: { fileUploaded, messages } });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Mitigation Response Plan</h2>
        <p className="text-muted-foreground">
          Upload your mitigation response plan document and ask questions about it
        </p>
      </div>

      {!fileUploaded ? (
        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Upload Document
              </label>
              <div className="flex gap-4 items-center">
                <Input
                  type="file"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx,.txt"
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={handleUpload}
                  disabled={!selectedFile || uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload
                    </>
                  )}
                </Button>
              </div>
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Ask Questions</h3>
              <span className="text-sm text-green-600">✓ Document uploaded</span>
            </div>

            <ScrollArea className="h-96 border rounded-lg p-4 bg-muted/30">
              {messages.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Start asking questions about your document
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
                        <p className="text-sm">{msg.content}</p>
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
                placeholder="Ask a question about your document..."
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
        </Card>
      )}

      <div className="flex gap-4">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={!fileUploaded}>
          Continue
        </Button>
      </div>
    </form>
  );
};
