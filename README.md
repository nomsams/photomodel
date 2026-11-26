# PhotoModel 3D

Build 3D models from photos, right in the browser. Import photos of an object, place them as cameras around it, draw and triangulate its shape, solve camera positions from matched points, check the model against every photo, and export it.

Plain HTML/CSS/JS with no build step. It is a static site, so GitHub Pages can serve it straight from `main`. three.js 0.170 is loaded from jsDelivr.

## Run locally
Open `index.html`, or serve the folder (`npx serve .`) and open the URL.

## Features
- **Photos as cameras.** FOV is read from the EXIF 35 mm focal length when the photo has one. Large photos are downscaled on import. Pose and FOV can be edited with numbers, a gizmo, or *Align* mode, where orbiting moves the camera until the photo lines up.
- **Photo view.** Look through any photo with it overlaid on the model (on top or behind, adjustable opacity). Zoom and pan the photo (wheel / right-drag), and use the magnifier loupe for precise clicks. Step between photos or jump to the nearest one.
- **Pins & solving.** Pin model points where they appear in a photo. With 4+ pins, **Solve** finds that camera's position (6+ pins also gives the FOV). Pins show their reprojection error, and you can drag them to adjust. *Refine all* re-solves every camera and point together.
- **Triangulate.** Click the same feature in 2+ photos to get an exact 3D point. The clicks are kept as pins.
- **Modelling.**
  - Points, lines and faces. Drawing snaps to points, line midpoints, lines (splitting them), faces, a point cloud, and the grid or work plane.
  - Axis lock while drawing.
  - Extrude, mirror, duplicate, merge, split, flip.
  - Box select and named, coloured objects.
  - Set the real-world scale from one line of known length.
- **Workflow.**
  - Undo/redo.
  - Command palette (`Ctrl K`) and right-click context menus.
  - Autosave in the browser (IndexedDB).
  - Save/open project files with the photos embedded.
  - An unsaved-changes indicator.
  - Light and dark themes with accent colours.
  - Responsive layout for small screens.
- **Import / export.**
  - Import photos, point clouds (`.ply .xyz .txt .csv .pts`) and OBJ.
  - Export OBJ (grouped by object), GLB (with cameras), STL, PLY points, camera poses + pins (JSON), and PNG screenshots.
- **Demo project.** A rendered house with one deliberately misplaced camera to try *Solve* on.

Press `?` in the app for the full shortcut list.

## Code layout
| File | Purpose |
|---|---|
| `js/core.js` | state, selection, undo/redo, model operations, camera projection math |
| `js/solve.js` | camera resection (Levenberg–Marquardt), triangulation, refine-all |
| `js/viewport.js` | three.js scene, rendering, picking, photo view + zoom, gizmo, orientation widget |
| `js/photoview.js` | pin layer and loupe |
| `js/tools.js` | select / point / line / face / triangulate / pin tools, snapping, box select |
| `js/io.js` | import (with EXIF), save/open, autosave, exports |
| `js/demo.js` | demo project generator |
| `js/ui.js` | panels, properties, settings, palette, context menu, dialogs, shortcuts |

Camera convention: three.js / OpenGL. A camera looks down −Z with +Y up. `rot` is `[pitch, yaw, roll]` in degrees (Euler YXZ) and `fov` is the vertical field of view. Pins are normalised image coordinates (0–1, y down).
