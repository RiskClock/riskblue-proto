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

interface ActiveExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when user clicks "Cancel and Export Again". */
  onConfirm: () => void;
}

/**
 * Shown only when a project's analysis request is currently being exported
 * (status pending or processing) and the user clicks Export Analysis again.
 */
export function ActiveExportModal({
  open,
  onOpenChange,
  onConfirm,
}: ActiveExportModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Export already in progress</AlertDialogTitle>
          <AlertDialogDescription>
            An export for this project is already being generated. If the
            project contents have changed, you can cancel the current export
            and start a new one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Current Export</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            Cancel and Export Again
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
