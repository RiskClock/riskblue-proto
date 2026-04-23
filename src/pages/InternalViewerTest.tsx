/**
 * Internal-only QA harness for the shared DrawingViewer / FileViewerModal.
 *
 * This route exists to validate the migrated FileViewerModal in any preview
 * session, *without* requiring a connected Google Drive account. It feeds the
 * modal a `sourceOverride` pointing at a real PDF in the `uploaded-drawings`
 * Supabase storage bucket.
 *
 * Route: /internal/viewer-test (gated to @riskclock.com users)
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppHeader } from "@/components/AppHeader";
import { FileViewerModal } from "@/components/wizard/FileViewerModal";
import type { DocumentSourceDescriptor } from "@/components/viewer";

interface TestCase {
  id: string;
  label: string;
  description: string;
  fileName: string;
  source: DocumentSourceDescriptor;
  detections: Array<{
    lineMonitored: string;
    lineCode: string;
    systemType: string;
    coordinates: [number, number, number, number];
  }>;
}

// A small library of known-good preview files. All paths come from the
// `uploaded-drawings` bucket (private; signed via useDocumentSource).
const TEST_CASES: TestCase[] = [
  {
    id: "lower-level",
    label: "Multi-page PDF — Lower Level",
    description: "Single-page architectural PDF, no overlays. Validates basic pan/zoom.",
    fileName: "A2.01-LOWER-LEVEL-Rev.18.pdf",
    source: {
      kind: "supabase-storage",
      bucket: "uploaded-drawings",
      path: "6ef932bd-c679-4703-a90a-ff4654b755af/9e95996e-5189-42c6-88a8-7fde5d0c46a9/A2.01-LOWER-LEVEL-Rev.18.pdf",
      mimeType: "application/pdf",
    },
    detections: [],
  },
  {
    id: "ground-floor-overlays",
    label: "PDF with normalized overlays — Ground Floor",
    description:
      "Validates overlay alignment. Three normalized [x,y,w,h] boxes drawn on page 1.",
    fileName: "A2.02-GROUND-FLOOR-Rev.19.pdf",
    source: {
      kind: "supabase-storage",
      bucket: "uploaded-drawings",
      path: "6ef932bd-c679-4703-a90a-ff4654b755af/9e95996e-5189-42c6-88a8-7fde5d0c46a9/A2.02-GROUND-FLOOR-Rev.19.pdf",
      mimeType: "application/pdf",
    },
    detections: [
      {
        lineMonitored: "Domestic Cold Water",
        lineCode: "DCW-1",
        systemType: "Pipe (cold)",
        coordinates: [0.18, 0.22, 0.18, 0.12],
      },
      {
        lineMonitored: "Sanitary",
        lineCode: "SAN-2",
        systemType: "Drain",
        coordinates: [0.55, 0.45, 0.14, 0.08],
      },
      {
        lineMonitored: "Hot Water Return",
        lineCode: "HWR-3",
        systemType: "Pipe (hot)",
        coordinates: [0.7, 0.7, 0.12, 0.1],
      },
    ],
  },
];

export default function InternalViewerTest() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState<TestCase | null>(null);

  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  useEffect(() => {
    if (user && !isInternal) navigate("/projects", { replace: true });
  }, [user, isInternal, navigate]);

  if (!isInternal) return null;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Drawing Viewer — QA Harness" />

      <div className="container mx-auto py-8 max-w-3xl">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">FileViewerModal test cases</h2>
          <p className="text-sm text-muted-foreground">
            Each entry opens FileViewerModal against a real PDF in the
            <code className="mx-1 px-1 rounded bg-muted">uploaded-drawings</code>
            bucket via <code className="px-1 rounded bg-muted">sourceOverride</code>,
            bypassing Google Drive auth. Use these to validate wheel zoom,
            trackpad pinch, drag-pan, toolbar zoom, page navigation, and overlay
            alignment.
          </p>
        </div>

        <div className="space-y-3">
          {TEST_CASES.map((tc) => (
            <Card key={tc.id}>
              <CardHeader>
                <CardTitle className="text-base">{tc.label}</CardTitle>
                <CardDescription>{tc.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground truncate">
                  {tc.fileName}
                </div>
                <Button onClick={() => setActive(tc)}>Open in FileViewerModal</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {active && (
        <FileViewerModal
          isOpen={!!active}
          onClose={() => setActive(null)}
          fileId={active.id}
          fileName={active.fileName}
          mimeType="application/pdf"
          accessToken="" // unused — sourceOverride takes precedence
          detections={active.detections}
          sourceOverride={active.source}
        />
      )}
    </div>
  );
}
