import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Settings, FileText, BarChart3, Shield } from "lucide-react";
import riskBlueLogo from "@/assets/logo-riskblue.png";
import { useAccountType } from "@/hooks/useAccountType";

interface AppHeaderProps {
  leftContent?: React.ReactNode;
}

export const AppHeader = ({ leftContent }: AppHeaderProps) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { getInitial } = useUserDisplayName();
  const { isWMSV } = useAccountType();

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="sticky top-0 z-20 border-b bg-card no-print">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img
            src={riskBlueLogo}
            alt="RiskBlue"
            className="h-8 cursor-pointer"
            onClick={() => navigate("/projects")}
          />
          <span className="text-lg font-bold text-black">
            {isWMSV ? "Workbench" : "Contractor Portal"}
          </span>
          {leftContent}
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate("/projects")}
            className={`hover:text-primary ${isActive("/projects") ? "text-primary font-medium" : "text-foreground"}`}
          >
            Projects
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Avatar className="cursor-pointer">
                <AvatarFallback>{getInitial()}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {isWMSV && (
                <>
                  <DropdownMenuItem onClick={() => navigate("/controls")} className="cursor-pointer">
                    <Shield className="h-4 w-4 mr-2" />
                    Controls
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
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
  );
};
