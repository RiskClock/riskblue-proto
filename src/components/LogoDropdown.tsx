import { useNavigate } from "react-router-dom";
import riskClockLogo from "@/assets/logo-riskclock.png";

export function LogoDropdown() {
  const navigate = useNavigate();

  const handleLogoClick = () => {
    navigate("/projects");
  };

  return (
    <div
      className="flex items-center cursor-pointer"
      onClick={handleLogoClick}
    >
      <img src={riskClockLogo} alt="RiskClock" className="h-8" />
    </div>
  );
}
