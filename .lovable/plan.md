

# Use Proper Icons for Google Drive, Procore, and SharePoint

## Changes

### 1. Copy SharePoint logo to project
Copy the uploaded `sharepoint.png` to `public/icons/icon_sharepoint.png` to match existing icon convention.

### 2. Update `CreateAnalysisModal.tsx`
- Replace `HardDrive` icon for Google Drive with `<img src="/icons/icon_googledrive.png" className="w-4 h-4" />`
- Replace `HardDrive` icon for Procore with `<img src="/icons/icon_procore.png" className="w-4 h-4" />`
- Replace OneDrive button with SharePoint: `<img src="/icons/icon_sharepoint.png" className="w-4 h-4" />` + "SharePoint (coming soon)"
- Remove unused `HardDrive` and `Cloud` imports from lucide-react

### 3. Update `AnalysisRequestDetail.tsx`
- Same icon replacements for all three buttons
- OneDrive → SharePoint (coming soon)
- Remove unused `HardDrive` and `Cloud` imports

## Files to update

| File | Change |
|---|---|
| `public/icons/icon_sharepoint.png` | Copy from uploaded file |
| `src/components/analysis/CreateAnalysisModal.tsx` | Use img icons, rename OneDrive → SharePoint |
| `src/pages/AnalysisRequestDetail.tsx` | Same icon and label changes |

