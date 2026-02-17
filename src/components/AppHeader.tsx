import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { LogoDropdown } from "@/components/LogoDropdown";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Settings, FileText, BarChart3 } from "lucide-react";

interface AppHeaderProps {
  leftContent?: React.ReactNode;
}

export const AppHeader = ({ leftContent }: AppHeaderProps) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { getInitial } = useUserDisplayName();
  const [showProviderDialog, setShowProviderDialog] = useState(false);

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-card no-print">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <LogoDropdown />
            {leftContent}
          </div>
          <div className="flex items-center gap-6">
            <button
              onClick={() => navigate("/projects")}
              className={`hover:text-primary ${isActive("/projects") ? "text-primary font-medium" : "text-foreground"}`}
            >
              Projects
            </button>
            {isInternalUser && (
              <button
                onClick={() => setShowProviderDialog(true)}
                className={`hover:text-primary ${isActive("/solution-provider-portal") ? "text-primary font-medium" : "text-foreground"}`}
              >
                Solution Provider Portal
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="cursor-pointer">
                  <AvatarFallback>{getInitial()}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {isInternalUser && (
                  <>
                    <DropdownMenuItem onClick={() => navigate("/configuration")} className="cursor-pointer">
                      <Settings className="h-4 w-4 mr-2" />
                      Configuration
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/internal/analysis-queue")} className="cursor-pointer">
                      <FileText className="h-4 w-4 mr-2" />
                      Analysis Queue
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/logs")} className="cursor-pointer">
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Logs
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <ProviderSelectionDialog
        open={showProviderDialog}
        onOpenChange={setShowProviderDialog}
      />
    </>
  );
};
