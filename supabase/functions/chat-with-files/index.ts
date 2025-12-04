import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are a water systems analysis expert assistant. You have analyzed building drawings and created a monitoring chart for water systems.

Your role is to:
- Answer follow-up questions about the water systems analysis
- Explain specific entries in the monitoring chart
- Provide additional recommendations for sensor placement
- Clarify technical details about pipe systems, sensors, and monitoring
- Help users understand the analysis results

Be concise, technical, and helpful. Reference specific details from the analysis when answering questions.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, analysisContext, fileUris } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Gemini API key is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the conversation parts
    const parts: any[] = [
      { text: SYSTEM_PROMPT },
    ];

    // Add the analysis context if available
    if (analysisContext) {
      parts.push({ 
        text: `\n\nHere is the initial analysis that was performed:\n\n${analysisContext}\n\n---\n\nNow answer the user's follow-up questions based on this analysis.` 
      });
    }

    // Add file references if available (for multi-turn conversations with files)
    if (fileUris && Array.isArray(fileUris)) {
      for (const fileUri of fileUris) {
        parts.push({
          file_data: {
            file_uri: fileUri.uri,
            mime_type: fileUri.mimeType,
          },
        });
      }
    }

    // Convert messages to Gemini format
    const contents: any[] = [];
    
    // First message includes the system prompt and context
    const firstUserMsgIndex = messages.findIndex((m: Message) => m.role === "user");
    
    if (firstUserMsgIndex >= 0) {
      // Add all parts plus first user message
      contents.push({
        role: "user",
        parts: [...parts, { text: messages[firstUserMsgIndex].content }],
      });

      // Add remaining messages
      for (let i = firstUserMsgIndex + 1; i < messages.length; i++) {
        const msg = messages[i] as Message;
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    console.log(`Chat request with ${messages.length} messages`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: 4000,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to get AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      console.error("No content in Gemini response:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "No response received" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ response: content }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in chat-with-files:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
