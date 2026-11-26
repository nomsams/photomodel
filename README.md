# PhotoModel 3D

Build 3D models from photos, right in the browser. Import photos of an object, place them as cameras around it, draw and triangulate its shape, solve camera positions from matched points, check the model against every photo, and export it.

Plain HTML/CSS/JS with no build step. It is a static site, so GitHub Pages can serve it straight from `main`. three.js 0.170 is loaded from jsDelivr.

## Run locally
Open `index.html`, or serve the folder (`npx serve .`) and open the URL.

## Workflow (the step bar at the top)
1. **Photos:** upload photos of one object from different sides. They start out placed in a circle.
2. **Mark:** a full-screen page. In each photo, drag along the same 2–3 colour-coded **lines** and click the same **point**(s). You can start a line from either end.
   - The previous photo with its marks is shown alongside.
   - A filmstrip shows which photos are done.
   - Use `→` to move to the next photo.
3. **Place:** one click positions every photo (and the marked lines) from the marks. Each photo gets a fit error, and the dashed lines show where the solved shape lands in it.
4. **Fine-tune:** look through any photo and nudge it with the pad or the arrow keys (hold `Alt` for tiny steps).
5. **Model:** build on the result (points, lines, faces, extrude…), check it against every photo, and export.

Tip: a point that sticks out of the plane of your lines (e.g. a tail fin tip) makes placement much more reliable.
Feature definitions can be saved as a **feature set** and loaded into another project, so similar objects ("cousins") are marked the same way.

**Point clouds and Gaussian splats.** Dense reconstruction and splat training need a GPU pipeline that can't run in a web page, so bring them in from other tools:
- **Import → COLMAP** (`cameras.txt`, `images.txt`, `points3D.txt`) places every camera automatically, matching photos by file name, and loads the sparse cloud. Marked features are re-triangulated and the scene is aligned to the reference direction.
- **Import → Gaussian splat** (`.ply` 3DGS or `.splat`) shows the splat centres as coloured points you can snap to.

## Features
- **Photos as cameras.** FOV is read from the EXIF 35 mm focal length when the photo has one. Large photos are downscaled on import. Pose and FOV can be edited with numbers, a gizmo, or *Align* mode, where orbiting moves the camera until the photo lines up.
- **Photo view.** Look through any photo with it overlaid on the model (on top or behind, adjustable opacity). Zoom and pan the photo (wheel / right-drag), and use the magnifier loupe for precise clicks. Step between photos or jump to the nearest one.
- **Moving photo cameras.**
  - *Move to current view*: fly the 3D view to roughly where the photo was taken and drop the camera there.
  - A *Move camera* pad in photo view: orbit / slide, closer / farther, roll. Buttons repeat while held, and the arrow keys, PgUp/PgDn and `,` `.` do the same.
  - A movement-speed setting; hold `Alt` for 4× finer steps.
  - The photo panel can be collapsed and dragged out of the way.
- **Drawing on the object.** A line or face started on a face stays on that face's plane, even past its edges. *Plane from selection* sets the drawing plane from a face or 3+ points.
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
| `js/markview.js` | marking mode: feature chips, filmstrip, reference card, auto-solve, presets |
| `js/ui.js` | panels, properties, settings, palette, context menu, dialogs, shortcuts |

Camera convention: three.js / OpenGL. A camera looks down −Z with +Y up. `rot` is `[pitch, yaw, roll]` in degrees (Euler YXZ) and `fov` is the vertical field of view. Pins are normalised image coordinates (0–1, y down).
