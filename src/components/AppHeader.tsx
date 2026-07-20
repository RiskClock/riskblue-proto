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
import { LogOut, Settings, BarChart3, Shield, Coins, Users, KeyRound, UserCog, LayoutGrid, Info } from "lucide-react";
import riskBlueLogo from "@/assets/logo-riskblue.png";

import { useCredits } from "@/hooks/useCredits";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { EditProfileModal } from "@/components/EditProfileModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AppHeaderProps {
  leftContent?: React.ReactNode;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  infoTitle?: string;
  infoContent?: React.ReactNode;
}

export const AppHeader = ({ leftContent, title, actions, infoTitle, infoContent }: AppHeaderProps) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { getInitial, avatarUrl, displayName } = useUserDisplayName();

  const { balance: credits } = useCredits();
  const [buyOpen, setBuyOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="sticky top-0 z-20 border-b bg-card no-print">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <img
            src={riskBlueLogo}
            alt="RiskBlue"
            className="h-8 cursor-pointer shrink-0"
            onClick={() => navigate("/projects")}
          />
          {title && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-6 w-px bg-border shrink-0" aria-hidden />
              <div className="text-lg font-semibold text-foreground truncate">{title}</div>
              {infoContent && (
                <button
                  type="button"
                  onClick={() => setInfoOpen(true)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="More information"
                >
                  <Info className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          {leftContent}
        </div>
        <div className="flex items-center gap-6 shrink-0">
          {actions}
          <button
            onClick={() => navigate("/projects")}
            className={`hover:text-primary ${isActive("/projects") ? "text-primary font-medium" : "text-foreground"}`}
          >
            Projects
          </button>
          <button
            onClick={() => setBuyOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Coins className="h-4 w-4" />
            <span>Credits: <span className="tabular-nums font-medium text-foreground">{credits}</span></span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Avatar className="cursor-pointer">
                {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile photo" />}
                <AvatarFallback>{getInitial()}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {(displayName || user?.email) && (
                <>
                  {displayName && (
                    <div className="px-2 py-1.5 text-sm truncate" title={displayName}>
                      {displayName}
                    </div>
                  )}
                  {user?.email && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground truncate" title={user.email}>
                      {user.email}
                    </div>
                  )}
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
              {isInternalUser && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/internal/users")} className="cursor-pointer">
                    <Users className="h-4 w-4 mr-2" />
                    User Management
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/configuration")} className="cursor-pointer">
                    <Settings className="h-4 w-4 mr-2" />
                    App Configuration
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/workbench")} className="cursor-pointer">
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    Workbench
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/logs")} className="cursor-pointer">
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Logs
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
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
      {infoContent && (
        <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{infoTitle ?? "About"}</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-2">{infoContent}</div>
          </DialogContent>
        </Dialog>
      )}
    </header>
  );
};
