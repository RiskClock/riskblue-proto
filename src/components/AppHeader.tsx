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
import { LogOut, Settings, BarChart3, Shield, Coins, Users, KeyRound, UserCog, LayoutGrid, Info, FlaskConical, Building2, ArrowLeftRight } from "lucide-react";
import { useTenant, useMyTenants } from "@/contexts/TenantContext";
import { SwitchCompanyModal } from "@/components/SwitchCompanyModal";
import { TenantMembersModal } from "@/components/TenantMembersModal";
import { useBrandLogo } from "@/hooks/useBrandLogo";
import { APP_VERSION } from "@/lib/appVersion";
import { useUpdateAvailable } from "@/hooks/useVersionCheck";
import { preloadRoute, preloadRoutes, type RouteKey } from "@/lib/routePreload";


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
  const { logoUrl, isCompanyLogo, companyName } = useBrandLogo();

  const { balance: credits } = useCredits();
  const { tenant, tenantId, tenantPath, hasPermission } = useTenant();
  const { data: myTenants = [] } = useMyTenants();
  const [buyOpen, setBuyOpen] = useState(false);
  const [switchCompanyOpen, setSwitchCompanyOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const updateAvailable = useUpdateAvailable();


  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
  const isRefineryAdmin = (user?.email?.toLowerCase() ?? "") === "admin@riskclock.com";

  // Inside a company workspace credits come from the shared tenant pool and are
  // gated by the view_credits / buy_credits permission flags.
  const showCredits = tenantId ? hasPermission("view_credits") : true;
  const canBuyCredits = tenantId ? hasPermission("buy_credits") : true;
  const displayedCredits = tenantId ? (tenant?.credits_balance ?? 0) : credits;

  const isActive = (path: string) => location.pathname === path;

  // Close the menu first, then navigate on the next frame. Navigating
  // synchronously makes the first click stall while the lazily loaded page
  // chunk downloads and parses, which freezes the close animation.
  const runAfterMenuCloses = (fn: () => void) => {
    setMenuOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(fn));
  };

  const menuNavigate = (path: string) => runAfterMenuCloses(() => navigate(path));

  const menuItemProps = (route: RouteKey) => ({
    onPointerEnter: () => preloadRoute(route),
    onFocus: () => preloadRoute(route),
  });

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (!open) return;
    const keys: RouteKey[] = ["projects"];
    if (isInternalUser) {
      keys.push("companyManagement", "userManagement", "configuration", "workbench", "logs");
      if (isRefineryAdmin) keys.push("promptRefinery");
    } else if (tenantId && tenant?.role === "admin") {
      keys.push("userManagement");
    }
    preloadRoutes(keys);
  };

  return (
    <header className="sticky top-0 z-20 border-b bg-card no-print">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <img
            src={logoUrl}
            alt={isCompanyLogo ? `${companyName ?? "Company"} logo` : "RiskBlue"}
            className="h-10 w-auto max-w-none cursor-pointer shrink-0 object-contain object-left"
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
            onClick={() => navigate(tenantPath("/projects"))}
            className={`hover:text-primary ${isActive(tenantPath("/projects")) ? "text-primary font-medium" : "text-foreground"}`}
          >
            Projects
          </button>
          {showCredits && (
            <button
              onClick={() => setBuyOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
              title="Buy credits"
            >
              <Coins className="h-4 w-4" />
              <span>Credits: <span className="tabular-nums font-medium text-foreground">{displayedCredits}</span></span>
            </button>
          )}
          <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
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
              <DropdownMenuItem onClick={() => runAfterMenuCloses(() => setEditProfileOpen(true))} className="cursor-pointer">
                <UserCog className="h-4 w-4 mr-2" />
                Edit Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runAfterMenuCloses(() => setChangePasswordOpen(true))} className="cursor-pointer">
                <KeyRound className="h-4 w-4 mr-2" />
                Change Password
              </DropdownMenuItem>
              {isInternalUser && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => menuNavigate("/internal/companies")} className="cursor-pointer" {...menuItemProps("companyManagement")}>
                    <Building2 className="h-4 w-4 mr-2" />
                    Company Management
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => menuNavigate("/internal/users")} className="cursor-pointer" {...menuItemProps("userManagement")}>
                    <Users className="h-4 w-4 mr-2" />
                    User Management
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => menuNavigate("/configuration")} className="cursor-pointer" {...menuItemProps("configuration")}>
                    <Settings className="h-4 w-4 mr-2" />
                    App Configuration
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => menuNavigate("/workbench")} className="cursor-pointer" {...menuItemProps("workbench")}>
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    Workbench
                  </DropdownMenuItem>
                  {isRefineryAdmin && (
                    <DropdownMenuItem onClick={() => menuNavigate("/prompt-refinery")} className="cursor-pointer" {...menuItemProps("promptRefinery")}>
                      <FlaskConical className="h-4 w-4 mr-2" />
                      Prompt Refinery
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => menuNavigate("/logs")} className="cursor-pointer" {...menuItemProps("logs")}>
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Logs
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              {tenantId && !isInternalUser && tenant?.role === "admin" && (
                <DropdownMenuItem
                  onClick={() => menuNavigate(tenantPath("/users"))}
                  className="cursor-pointer"
                  {...menuItemProps("userManagement")}
                >
                  <Users className="h-4 w-4 mr-2" />
                  User Management
                </DropdownMenuItem>
              )}
              {(myTenants.length > 0 || isInternalUser) && (
                <DropdownMenuItem onClick={() => runAfterMenuCloses(() => setSwitchCompanyOpen(true))} className="cursor-pointer">
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Switch Company
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => runAfterMenuCloses(signOut)} className="cursor-pointer">
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </DropdownMenuItem>
              <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">
                Version {APP_VERSION}
              </div>
              {updateAvailable && (
                <DropdownMenuItem
                  onClick={() => window.location.reload()}
                  className="cursor-pointer text-xs text-primary focus:text-primary"
                >
                  Update available — reload
                </DropdownMenuItem>
              )}

            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <BuyCreditsModal open={buyOpen} onOpenChange={setBuyOpen} canBuyCredits={canBuyCredits} />
      <SwitchCompanyModal open={switchCompanyOpen} onOpenChange={setSwitchCompanyOpen} />
      {tenantId && tenant && (
        <TenantMembersModal
          tenantId={tenantId}
          tenantName={tenant.name}
          open={membersOpen}
          onOpenChange={setMembersOpen}
        />
      )}
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
