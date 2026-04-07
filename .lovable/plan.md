
Investigated the Procore dialog and the screenshot. The bug is not just scroll overflow.

## What’s actually wrong

There are two layout problems:

1. The dialog is still too narrow for this content
   - `src/components/wizard/ProcoreConnectionDialog.tsx` uses `DialogContent className="max-w-md"`.
   - That width is too small for:
     - long project names + address
     - nested folder indentation
     - the right-side Select/Selected action

2. The tree row layout does not reserve/shrink space correctly
   - In `src/components/wizard/ProcoreFolderTree.tsx`, each row is:
     - icon/button area
     - folder name span with `truncate flex-1`
     - Select button
   - In flex layouts, truncation usually also needs `min-w-0` on the flexible text region or wrapper.
   - Without that, the text block can refuse to shrink properly, which causes the action button to get pushed/clipped even if the container scrolls.

## Implementation plan

### 1. Widen the Procore connection dialog
File: `src/components/wizard/ProcoreConnectionDialog.tsx`

- Change the dialog from `max-w-md` to a wider responsive width, such as:
  - `max-w-2xl w-[min(92vw,56rem)]`
- This gives enough room for:
  - two-line project labels
  - nested folder rows
  - right-aligned Select button

### 2. Fix row sizing in the folder tree
File: `src/components/wizard/ProcoreFolderTree.tsx`

- Make each folder row use a layout that can shrink safely:
  - add `w-full` to the row
  - wrap the folder icon + label in a `min-w-0 flex-1 flex items-center ...`
  - add `min-w-0` to the text container/span
- Keep the Select button as `shrink-0` so it remains fully visible.

Recommended structure:
```text
[row]
  [toggle]
  [content min-w-0 flex-1]
    [folder icon]
    [label truncate]
  [select button shrink-0]
```

### 3. Preserve horizontal scrolling as a fallback
File: `src/components/wizard/ProcoreConnectionDialog.tsx`

- Keep the folder container scrollable with `overflow-auto`.
- Add `min-w-0` safeguards around parent wrappers if needed so the tree respects the dialog width instead of overflowing unpredictably.

### 4. Improve the project dropdown label wrapping
File: `src/components/wizard/ProcoreConnectionDialog.tsx`

- The selected project trigger is also visually cramped in the screenshot.
- Keep the dropdown content as-is, but make sure the trigger/value presentation does not force awkward overflow.
- If needed, simplify the selected trigger text to project name only while keeping address in the dropdown list.

## Expected result

After these changes:
- the Select button will remain fully visible
- nested folder rows will truncate correctly instead of pushing content out
- the dialog will better fit Procore project/folder content
- horizontal scrolling will only be a fallback, not the primary fix

## Files to update

- `src/components/wizard/ProcoreConnectionDialog.tsx`
- `src/components/wizard/ProcoreFolderTree.tsx`

## Technical details

Root cause summary:
```text
Current issue =
  narrow modal width
  + recursive indentation
  + flex child missing min-w-0
  + fixed-size action button on the right

Result:
  row cannot shrink correctly
  -> action button gets clipped/pushed outside visible area
```
