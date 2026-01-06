import { useEffect, useState } from "react";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

/**
 * OAuth Callback Page for popup-based Google Drive authentication.
 * This page receives the auth result and posts a message to the opener window.
 */
const OAuthCallback = () => {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Processing authentication...");

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const driveConnected = urlParams.get("drive_connected");
        const error = urlParams.get("error");

        if (error) {
          setStatus("error");
          setMessage(`Authentication failed: ${error}`);
          
          // Post error to opener
          if (window.opener) {
            window.opener.postMessage(
              { type: "google-oauth-callback", success: false, error },
              window.location.origin
            );
          }
          
          // Close after delay
          setTimeout(() => window.close(), 2000);
          return;
        }

        if (driveConnected === "true") {
          setStatus("success");
          setMessage("Connected successfully! This window will close...");
          
          // Post success to opener
          if (window.opener) {
            window.opener.postMessage(
              { type: "google-oauth-callback", success: true },
              window.location.origin
            );
          }
          
          // Close after brief delay
          setTimeout(() => window.close(), 1000);
        } else {
          setStatus("error");
          setMessage("No authentication result received.");
          setTimeout(() => window.close(), 2000);
        }
      } catch (err) {
        console.error("OAuth callback error:", err);
        setStatus("error");
        setMessage("An error occurred during authentication.");
        setTimeout(() => window.close(), 2000);
      }
    };

    handleCallback();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center p-8">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">{message}</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-foreground font-medium">{message}</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <p className="text-destructive">{message}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default OAuthCallback;
