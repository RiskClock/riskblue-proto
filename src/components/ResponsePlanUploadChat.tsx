import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ResponsePlanAnalysisAnimation } from "./ResponsePlanAnalysisAnimation";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ResponsePlanUploadChatProps {
  projectId: string;
  onDataExtracted?: (data: any) => void;
}

export const ResponsePlanUploadChat = ({ projectId, onDataExtracted }: ResponsePlanUploadChatProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setUploading(false);
    setAnalyzing(false);
    setUploadComplete(false);
    toast({
      title: "Upload cancelled",
      description: "The file upload has been stopped.",
    });
  };

  const handleUpload = async () => {
    if (!uploadedFile) return;

    abortControllerRef.current = new AbortController();

    setUploading(true);
    setAnalyzing(true);
    setUploadComplete(false);

    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append("projectId", projectId);

    try {
      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook/e2ac331c-7bba-4517-baa5-28d233d641ca",
        {
          method: "POST",
          body: formData,
          signal: abortControllerRef.current?.signal,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Upload failed:", errorText);
        throw new Error("Failed to upload file");
      }

      const data = await response.text();
      
      try {
        const parsedData = JSON.parse(data);
        if (onDataExtracted) {
          onDataExtracted(parsedData);
        }
        toast({
          title: "Success",
          description: "Response plan uploaded and analyzed successfully.",
        });
      } catch (e) {
        console.log("Response is not JSON, skipping auto-fill");
        toast({
          title: "File uploaded",
          description: "Response plan processed successfully",
        });
      }
      
      setUploadComplete(true);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error("Upload error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload file",
        variant: "destructive",
      });
      setAnalyzing(false);
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

      const data = await response.text();
      setMessages((prev) => prev.slice(0, -1).concat({ role: "assistant", content: data }));
    } catch (error) {
      console.error("Error sending question:", error);
      setMessages((prev) => prev.slice(0, -1).concat({ 
        role: "assistant", 
        content: "Sorry, I encountered an error processing your question." 
      }));
      toast({
        title: "Error",
        description: "Failed to send question. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-4">
        <div className="space-y-3">
          <label className="text-sm font-medium">Upload Mitigation Response Plan</label>
          
          <Input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
            accept=".pdf,.doc,.docx,.txt"
          />
          
          <div className="flex gap-2 items-center">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 border-2 border-dashed border-muted-foreground/30 rounded-lg p-4 hover:border-muted-foreground/50 hover:bg-muted/50 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted transition-colors">
                  {uploadedFile ? (
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="text-left flex-1">
                  {uploadedFile ? (
                    <>
                      <p className="text-sm font-medium text-foreground truncate">{uploadedFile.name}</p>
                      <p className="text-xs text-muted-foreground">Click to change file</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-foreground">Click to select document</p>
                      <p className="text-xs text-muted-foreground">Choose your response plan</p>
                    </>
                  )}
                </div>
              </div>
            </button>
            
            <Button 
              onClick={uploading ? handleStop : handleUpload} 
              disabled={!uploadedFile && !uploading}
              variant={uploading ? "destructive" : "default"}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Stop
                </>
              ) : (
                "Upload"
              )}
            </Button>
          </div>
        </div>

        {analyzing && (
          <ResponsePlanAnalysisAnimation
            fileName={uploadedFile?.name || ""}
            isComplete={uploadComplete}
          />
        )}
      </Card>

      {/* Chat UI underneath */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold">Ask Questions About Your Response Plan</h3>
        
        {messages.length > 0 && (
          <ScrollArea className="h-[400px] pr-4 border rounded-lg p-4 bg-muted/30">
            <div className="space-y-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !sending && handleSendQuestion()}
            placeholder="Ask about your mitigation response plan..."
            disabled={sending}
            className="flex-1"
          />
          <Button onClick={handleSendQuestion} disabled={sending || !question.trim()}>
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
};
