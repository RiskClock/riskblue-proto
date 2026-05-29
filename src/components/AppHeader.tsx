import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, Settings, FileText, BarChart3, Shield, Coins, Users, KeyRound, UserCog, LayoutGrid } from "lucide-react";
import riskBlueLogo from "@/assets/logo-riskblue.png";
import { useAccountType } from "@/hooks/useAccountType";
import { useCredits } from "@/hooks/useCredits";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { EditProfileModal } from "@/components/EditProfileModal";

interface AppHeaderProps {
  leftContent?: React.ReactNode;
}

export const AppHeader = ({ leftContent }: AppHeaderProps) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { getInitial, avatarUrl } = useUserDisplayName();
  const { isWMSV, loading: accountLoading } = useAccountType();
  const { balance: credits } = useCredits();
  const [buyOpen, setBuyOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

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
          {!accountLoading && (
            <span className="text-lg font-bold text-black">
              {isWMSV ? "Workbench" : "Portal"}
            </span>
          )}
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
                {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile photo" />}
                <AvatarFallback>{getInitial()}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => setBuyOpen(true)}
                className="cursor-pointer"
              >
                <Coins className="h-4 w-4 mr-2" />
                <span className="flex-1">Credits</span>
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                  {credits}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/controls")} className="cursor-pointer">
                <Shield className="h-4 w-4 mr-2" />
                Controls
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isInternalUser && (
                <>
                  <DropdownMenuItem onClick={() => navigate("/internal/users")} className="cursor-pointer">
                    <Users className="h-4 w-4 mr-2" />
                    User Management
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/configuration")} className="cursor-pointer">
                    <Settings className="h-4 w-4 mr-2" />
                    AWP Configuration
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/internal/analysis-queue")} className="cursor-pointer">
                    <FileText className="h-4 w-4 mr-2" />
                    Analysis Queue
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/internal/workbench")} className="cursor-pointer">
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    Workbench
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={() => navigate("/logs")} className="cursor-pointer">
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Logs
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => setEditProfileOpen(true)} className="cursor-pointer">
                <UserCog className="h-4 w-4 mr-2" />
                Edit Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setChangePasswordOpen(true)} className="cursor-pointer">
                <KeyRound className="h-4 w-4 mr-2" />
                Change Password
              </DropdownMenuItem>
              <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <BuyCreditsModal open={buyOpen} onOpenChange={setBuyOpen} />
      <ChangePasswordModal open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
      <EditProfileModal open={editProfileOpen} onOpenChange={setEditProfileOpen} />
    </header>
  );
};
