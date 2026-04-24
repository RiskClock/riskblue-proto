import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ExportConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastExportAt: string | Date | null;
  lastExportStatus?: string | null;
  onConfirm: () => void;
  loading?: boolean;
}

export function ExportConfirmationModal({
  open,
  onOpenChange,
  lastExportAt,
  lastExportStatus,
  onConfirm,
  loading = false,
}: ExportConfirmationModalProps) {
  const formattedDate = lastExportAt
    ? format(new Date(lastExportAt), "MMM d, yyyy 'at' h:mm a")
    : null;

  const statusNote = (() => {
    if (lastExportStatus === "pending" || lastExportStatus === "processing") {
      return "That export is still being generated.";
    }
    if (lastExportStatus === "failed") {
      return "That export failed.";
    }
    return null;
  })();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Export this analysis again?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {formattedDate && (
                <p>An export was last requested on {formattedDate}.</p>
              )}
              {statusNote && <p>{statusNote}</p>}
              <p>
                Generating another export may take several minutes. Do you want
                to export again?
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting…
              </>
            ) : (
              "Export Again"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
