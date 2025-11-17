import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface ControlConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controlName: string;
  projectId: string;
  userName: string;
}

export const ControlConversationDialog = ({
  open,
  onOpenChange,
  controlName,
  projectId,
  userName
}: ControlConversationDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");

  // Fetch comments for this control
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['control-comments', projectId, controlName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('control_comments' as any)
        .select('*')
        .eq('project_id', projectId)
        .eq('control_name', controlName)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: open && !!projectId && !!controlName
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async (comment: string) => {
      const { data, error } = await supabase
        .from('control_comments' as any)
        .insert({
          project_id: projectId,
          control_name: controlName,
          user_name: userName,
          comment
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-comments', projectId, controlName] });
      setNewComment("");
      toast({
        title: "Comment added",
        description: "Your comment has been posted."
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to add comment.",
        variant: "destructive"
      });
      console.error('Error adding comment:', error);
    }
  });

  const handleSubmit = () => {
    if (!newComment.trim()) {
      toast({
        title: "Empty comment",
        description: "Please enter a comment.",
        variant: "destructive"
      });
      return;
    }
    addCommentMutation.mutate(newComment);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Discussion: {controlName}</DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-col h-full space-y-4">
          <ScrollArea className="flex-1 h-[400px] pr-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No comments yet. Start the conversation!
              </div>
            ) : (
              <div className="space-y-4">
                {comments.map((comment) => (
                  <div key={comment.id} className="p-4 rounded-lg bg-muted/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{comment.user_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(comment.created_at), 'MMM d, yyyy h:mm a')}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{comment.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="space-y-2">
            <Textarea
              placeholder="Add a comment or ask a question..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
            />
            <Button 
              onClick={handleSubmit} 
              className="w-full"
              disabled={addCommentMutation.isPending}
            >
              {addCommentMutation.isPending ? "Posting..." : "Post Comment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
